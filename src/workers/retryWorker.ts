import crypto from 'node:crypto';
import { Pool } from 'pg';
import { createLogger, type Logger, serializeError } from '../services/logger';
import {
  JobStore,
  type RetryCandidate,
  type WorkerHeartbeatStatus,
} from '../services/jobStore';

interface RetryWorkerConfig {
  workerName: string;
  workerInstanceId: string;
  applicationName: string;
  idleSleepMs: number;
  loopDelayMs: number;
  heartbeatIntervalMs: number;
  lockTtlSeconds: number;
  maxAttempts: number;
  maxThrottleAttempts: number;
  staleRetryMinutes: number;
  retryBatchSize: number;
}

interface WorkerRunOptions {
  once?: boolean;
  signal?: AbortSignal;
  pool?: Pool;
  logger?: Logger;
}

type RetryDisposition =
  | 'reset_to_pending'
  | 'dead_letter'
  | 'skip';

const config: RetryWorkerConfig = {
  workerName: getEnv('RETRY_WORKER_NAME', 'retry-worker'),
  workerInstanceId: getEnv('RETRY_WORKER_INSTANCE_ID', crypto.randomUUID()),
  applicationName: getEnv('APP_SERVICE_NAME', 'arb-system-api'),
  idleSleepMs: getIntEnv('RETRY_WORKER_IDLE_SLEEP_MS', 15000),
  loopDelayMs: getIntEnv('RETRY_WORKER_LOOP_DELAY_MS', 1000),
  heartbeatIntervalMs: getIntEnv('RETRY_WORKER_HEARTBEAT_INTERVAL_MS', 30000),
  lockTtlSeconds: getIntEnv('RETRY_WORKER_LOCK_TTL_SECONDS', 900),
  maxAttempts: getIntEnv('COMP_WORKER_MAX_ATTEMPTS', 5),
  maxThrottleAttempts: getIntEnv('COMP_WORKER_MAX_THROTTLE_ATTEMPTS', 10),
  staleRetryMinutes: getIntEnv('RETRY_WORKER_STALE_RETRY_MINUTES', 120),
  retryBatchSize: getIntEnv('RETRY_WORKER_BATCH_SIZE', 25),
};

export async function runRetryWorker(options: WorkerRunOptions = {}): Promise<void> {
  const logger =
    options.logger ??
    createLogger({
      serviceName: config.applicationName,
      staticBindings: {
        component: 'retryWorker',
        workerName: config.workerName,
        workerInstanceId: config.workerInstanceId,
      },
    });

  const pool = options.pool ?? createPool();
  const jobStore = new JobStore(pool);

  let keepRunning = true;
  let lastHeartbeatAt = 0;

  const stop = (): void => {
    keepRunning = false;
    logger.warn('retry worker stop requested', {
      operation: 'workerLoop',
    });
  };

  options.signal?.addEventListener('abort', stop);

  await safeHeartbeat(jobStore, logger, 'starting', { phase: 'boot' });

  try {
    while (keepRunning) {
      try {
        if (Date.now() - lastHeartbeatAt >= config.heartbeatIntervalMs) {
          await safeHeartbeat(jobStore, logger, 'running', {
            phase: 'claiming_or_idle',
          });
          lastHeartbeatAt = Date.now();
        }

        const reclaimed = await jobStore.reclaimStaleProcessingLocks(
          config.staleRetryMinutes,
        );

        if (reclaimed > 0) {
          logger.warn('reclaimed stale processing locks', {
            operation: 'reclaimStaleProcessingLocks',
            reclaimedCount: reclaimed,
          });
        }

        const claimed = await jobStore.claimRetryCandidates(
          config.lockTtlSeconds,
          config.retryBatchSize,
          config.workerInstanceId,
        );

        if (claimed.length === 0) {
          if (options.once) break;
          await sleep(config.idleSleepMs);
          continue;
        }

        await safeHeartbeat(jobStore, logger, 'processing', {
          phase: 'processing_batch',
          batchSize: claimed.length,
        });

        for (const candidate of claimed) {
          try {
            await processRetryCandidate(jobStore, logger, candidate);
          } catch (error) {
            logger.error('retry candidate processing failure', {
              operation: 'processRetryCandidate',
              listingId: candidate.id,
              listingExternalId: candidate.listingExternalId ?? undefined,
              error: serializeError(error),
            });
          }
        }

        if (options.once) break;
        await sleep(config.loopDelayMs);
      } catch (error) {
        logger.error('retry worker loop failure', {
          operation: 'workerLoop',
          error: serializeError(error),
        });

        await safeHeartbeat(jobStore, logger, 'degraded', {
          phase: 'loop_error',
          error: serializeError(error),
        });

        if (options.once) throw error;
        await sleep(Math.max(config.loopDelayMs, 5000));
      }
    }
  } finally {
    options.signal?.removeEventListener('abort', stop);

    await safeHeartbeat(jobStore, logger, 'stopped', {
      phase: 'shutdown',
    });

    if (!options.pool) {
      await pool.end();
    }
  }
}

async function processRetryCandidate(
  jobStore: JobStore,
  logger: Logger,
  candidate: RetryCandidate,
): Promise<void> {
  const correlationId = crypto.randomUUID();
  const listingLogger = logger.child({
    correlationId,
    listingId: candidate.id,
    listingExternalId: candidate.listingExternalId ?? undefined,
  });

  const failureClass = normalizeFailureClass(candidate.compLastErrorClass);
  const disposition = decideRetryDisposition(candidate, failureClass);

  listingLogger.info('processing retry candidate', {
    operation: 'processRetryCandidate',
    compAttempts: candidate.compAttempts,
    compLastError: candidate.compLastError,
    compLastErrorClass: candidate.compLastErrorClass,
    normalizedFailureClass: failureClass,
    disposition,
  });

  if (disposition === 'skip') {
    listingLogger.warn('retry candidate skipped due to missing retry signal', {
      operation: 'processRetryCandidate',
    });
    return;
  }

  if (disposition === 'dead_letter') {
    await jobStore.markListingTerminal(candidate.id, {
      terminalState: 'dead_letter',
      failureReason: buildTerminalFailureReason(candidate, failureClass),
      failureClass: buildTerminalFailureClass(failureClass),
      meta: {
        compAttempts: candidate.compAttempts,
        compLastError: candidate.compLastError,
        compLastErrorClass: candidate.compLastErrorClass,
        normalizedFailureClass: failureClass,
        retryWorkerCorrelationId: correlationId,
        retryWorkerDecision: 'dead_letter',
      },
    });

    listingLogger.warn('retry candidate moved to dead letter', {
      operation: 'processRetryCandidate',
      normalizedFailureClass: failureClass,
    });
    return;
  }

  const recovered = await jobStore.resetListingToPending(candidate.id);

  listingLogger.info('retry candidate reset to pending', {
    operation: 'processRetryCandidate',
    recovered,
    normalizedFailureClass: failureClass,
  });
}

function decideRetryDisposition(
  candidate: RetryCandidate,
  failureClass: NormalizedFailureClass,
): RetryDisposition {
  const attempts = coerceNonNegativeInt(candidate.compAttempts);

  if (failureClass === 'INVALID_INPUT' || failureClass === 'AUTH') {
    return 'dead_letter';
  }

  if (failureClass === 'THROTTLED') {
    if (attempts >= config.maxThrottleAttempts) {
      return 'dead_letter';
    }
    return 'reset_to_pending';
  }

  if (attempts >= config.maxAttempts) {
    return 'dead_letter';
  }

  if (
    failureClass === 'TIMEOUT' ||
    failureClass === 'NETWORK' ||
    failureClass === 'DB_CONCURRENCY' ||
    failureClass === 'SERVER' ||
    failureClass === 'UNKNOWN' ||
    failureClass === 'UNCLASSIFIED'
  ) {
    return 'reset_to_pending';
  }

  return 'reset_to_pending';
}

type NormalizedFailureClass =
  | 'THROTTLED'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'DB_CONCURRENCY'
  | 'INVALID_INPUT'
  | 'AUTH'
  | 'SERVER'
  | 'UNKNOWN'
  | 'UNCLASSIFIED';

function normalizeFailureClass(value: string | null | undefined): NormalizedFailureClass {
  const normalized = (value ?? '').trim().toUpperCase();

  switch (normalized) {
    case 'THROTTLED':
    case 'RATE_LIMIT':
    case '429':
      return 'THROTTLED';
    case 'TIMEOUT':
      return 'TIMEOUT';
    case 'NETWORK':
      return 'NETWORK';
    case 'DB_CONCURRENCY':
    case 'DEADLOCK':
    case 'SERIALIZATION':
      return 'DB_CONCURRENCY';
    case 'INVALID_INPUT':
    case 'CLIENT':
      return 'INVALID_INPUT';
    case 'AUTH':
    case 'TOKEN':
    case 'SCOPE':
      return 'AUTH';
    case 'SERVER':
      return 'SERVER';
    case 'UNKNOWN':
      return 'UNKNOWN';
    default:
      return 'UNCLASSIFIED';
  }
}

function buildTerminalFailureReason(
  candidate: RetryCandidate,
  failureClass: NormalizedFailureClass,
): string {
  const attempts = coerceNonNegativeInt(candidate.compAttempts);

  if (failureClass === 'THROTTLED') {
    return 'retry_exhausted_throttled_requests';
  }

  if (failureClass === 'AUTH') {
    return 'retry_blocked_auth_failure';
  }

  if (failureClass === 'INVALID_INPUT') {
    return 'retry_blocked_invalid_input';
  }

  return `retry_attempt_limit_reached_after_${attempts}_attempts`;
}

function buildTerminalFailureClass(
  failureClass: NormalizedFailureClass,
): string {
  switch (failureClass) {
    case 'THROTTLED':
      return 'RETRY_EXHAUSTED_THROTTLED';
    case 'AUTH':
      return 'RETRY_BLOCKED_AUTH';
    case 'INVALID_INPUT':
      return 'RETRY_BLOCKED_INVALID_INPUT';
    case 'TIMEOUT':
      return 'RETRY_EXHAUSTED_TIMEOUT';
    case 'NETWORK':
      return 'RETRY_EXHAUSTED_NETWORK';
    case 'DB_CONCURRENCY':
      return 'RETRY_EXHAUSTED_DB_CONCURRENCY';
    case 'SERVER':
      return 'RETRY_EXHAUSTED_SERVER';
    case 'UNKNOWN':
    case 'UNCLASSIFIED':
    default:
      return 'RETRY_EXHAUSTED';
  }
}

async function safeHeartbeat(
  jobStore: JobStore,
  logger: Logger,
  status: WorkerHeartbeatStatus,
  details: Record<string, unknown>,
): Promise<void> {
  try {
    await jobStore.writeWorkerHeartbeat(
      config.workerName,
      config.workerInstanceId,
      status,
      details,
    );
  } catch (error) {
    logger.warn('failed to write retry worker heartbeat', {
      operation: 'safeHeartbeat',
      error: serializeError(error),
    });
  }
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error('Missing DATABASE_URL');
  }

  return new Pool({
    connectionString,
    max: getIntEnv('PG_POOL_MAX', 10),
    idleTimeoutMillis: getIntEnv('PG_IDLE_TIMEOUT_MS', 30000),
    connectionTimeoutMillis: getIntEnv('PG_CONNECTION_TIMEOUT_MS', 10000),
    statement_timeout: getIntEnv('PG_STATEMENT_TIMEOUT_MS', 30000),
    query_timeout: getIntEnv('PG_QUERY_TIMEOUT_MS', 30000),
    application_name: `${config.workerName}:${config.workerInstanceId}`,
    ssl: getBoolEnv('PG_SSL_ENABLED', true)
      ? { rejectUnauthorized: false }
      : false,
  } as Record<string, unknown>);
}

function coerceNonNegativeInt(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.floor(parsed);
}

function getEnv(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function getIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getBoolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (require.main === module) {
  const logger = createLogger({
    serviceName: config.applicationName,
    staticBindings: {
      component: 'retryWorker',
      workerName: config.workerName,
      workerInstanceId: config.workerInstanceId,
    },
  });

  const abortController = new AbortController();

  const shutdown = (signal: string): void => {
    logger.warn('signal received, shutting down', {
      operation: 'processSignal',
      signal,
    });
    abortController.abort();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  runRetryWorker({
    signal: abortController.signal,
    logger,
  })
    .then(() => {
      logger.info('retry worker exited cleanly', {
        operation: 'processExit',
      });
      process.exit(0);
    })
    .catch((error) => {
      logger.error('retry worker exited with fatal error', {
        operation: 'processExit',
        error: serializeError(error),
      });
      process.exit(1);
    });
}
