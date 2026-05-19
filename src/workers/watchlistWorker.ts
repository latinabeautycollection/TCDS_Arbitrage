import crypto from 'node:crypto';
import { Pool } from 'pg';
import { createLogger, serializeError } from '../services/logger';
import { Prong2Repository } from '../repositories/prong2Repository';
import { keywordFingerprint } from '../services/prong2Scoring';
import { deriveWatchlistIdentity } from '../services/identity/watchlistIdentity';
import { incCounter, setGauge } from '../services/prong2Metrics';
import type {
  Prong2WorkerStatus,
  WatchlistHeartbeatDetails,
  WorkerHeartbeatWriteInput,
} from '../contracts/prong2WorkerHealth';

interface Config {
  workerName: string;
  workerInstanceId: string;
  loopDelayMs: number;
  idleSleepMs: number;
  heartbeatIntervalMs: number;
  batchSize: number;
  claimTtlSeconds: number;
  minimumWatchScore: number;
  minimumProfitUsd: number;
  minimumDemandScore: number;
}

const config: Config = {
  workerName: env('WATCHLIST_WORKER_NAME', 'watchlist-worker'),
  workerInstanceId: env('WATCHLIST_WORKER_INSTANCE_ID', crypto.randomUUID()),
  loopDelayMs: intEnv('WATCHLIST_WORKER_LOOP_DELAY_MS', 1000),
  idleSleepMs: intEnv('WATCHLIST_WORKER_IDLE_SLEEP_MS', 30000),
  heartbeatIntervalMs: intEnv('WATCHLIST_WORKER_HEARTBEAT_INTERVAL_MS', 30000),
  batchSize: intEnv('WATCHLIST_WORKER_BATCH_SIZE', 25),
  claimTtlSeconds: intEnv('WATCHLIST_WORKER_CLAIM_TTL_SECONDS', 300),
  minimumWatchScore: floatEnv('WATCHLIST_WORKER_MIN_WATCH_SCORE', 0.55),
  minimumProfitUsd: floatEnv('WATCHLIST_WORKER_MIN_PROFIT_USD', 25),
  minimumDemandScore: floatEnv('WATCHLIST_WORKER_MIN_DEMAND_SCORE', 0.35),
};

const logger = createLogger({
  serviceName: env('APP_SERVICE_NAME', 'arb-system-api'),
  staticBindings: {
    component: 'watchlistWorker',
    workerName: config.workerName,
    workerInstanceId: config.workerInstanceId,
  },
});

const pool = new Pool({
  connectionString: requiredEnv('DATABASE_URL'),
  max: intEnv('PG_POOL_MAX', 10),
  idleTimeoutMillis: intEnv('PG_IDLE_TIMEOUT_MS', 30000),
  connectionTimeoutMillis: intEnv('PG_CONNECTION_TIMEOUT_MS', 10000),
  statement_timeout: intEnv('PG_STATEMENT_TIMEOUT_MS', 30000),
  query_timeout: intEnv('PG_QUERY_TIMEOUT_MS', 30000),
  application_name: `${config.workerName}:${config.workerInstanceId}`,
  ssl: boolEnv('PG_SSL_ENABLED', true) ? { rejectUnauthorized: false } : false,
} as Record<string, unknown>);

const repository = new Prong2Repository(pool, logger);

export async function runWatchlistWorker(signal?: AbortSignal): Promise<void> {
  let keepRunning = true;
  let lastHeartbeatAt = 0;

  const stop = (): void => {
    keepRunning = false;
    logger.warn('stop requested', { operation: 'runWatchlistWorker' });
  };

  signal?.addEventListener('abort', stop);

  await writeHeartbeat('starting', { phase: 'boot' });

  try {
    while (keepRunning) {
      if (Date.now() - lastHeartbeatAt >= config.heartbeatIntervalMs) {
        await writeHeartbeat('running', { phase: 'claiming_snapshot_products' });
        lastHeartbeatAt = Date.now();
      }

      const claimed = await repository.claimSnapshotProducts({
        workerId: config.workerInstanceId,
        batchSize: config.batchSize,
        claimTtlSeconds: config.claimTtlSeconds,
      });

      if (claimed.length === 0) {
        await sleep(config.idleSleepMs);
        continue;
      }

      for (const product of claimed) {
        if (!keepRunning) break;

        try {
          await writeHeartbeat('processing', {
            phase: 'watchlist_evaluation',
            snapshotProductId: product.id,
            familyKey: product.familyKey,
            claimToken: product.claimToken,
          });

          const shouldAccept =
            (product.overallWatchScore ?? 0) >= config.minimumWatchScore &&
            (product.predictedProfitUsd ?? 0) >= config.minimumProfitUsd &&
            (product.demandScore ?? 0) >= config.minimumDemandScore;

          if (!shouldAccept) {
            await repository.rejectClaimedSnapshotProduct({
              snapshotProductId: product.id,
              claimToken: product.claimToken,
              rejectionReasonCode: 'below_watch_threshold',
            });

            incCounter('families_rejected');

            logger.info('snapshot product rejected for watchlist', {
              operation: 'runWatchlistWorker',
              snapshotProductId: product.id,
              familyKey: product.familyKey,
              rejectionReasonCode: 'below_watch_threshold',
            });

            continue;
          }

          await repository.upsertWatchlistFromClaimedProduct({
            snapshotProduct: product,
            keywordFingerprint: keywordFingerprint(
              [
                product.familyKey,
                product.familyName,
                product.brand ?? '',
                product.modelFamily ?? '',
              ].filter(Boolean),
            ),
            activationReason: {
              snapshotProductId: product.id,
              snapshotId: product.snapshotId,
              familyKey: product.familyKey,
              overallWatchScore: product.overallWatchScore,
              predictedProfitUsd: product.predictedProfitUsd,
              demandScore: product.demandScore,
            },
          });

          incCounter('families_promoted');
          setGauge('latest_watchlist_promotions', 1);

          // ── Derive + persist watchlist identity ──────────────────────
          const watchlistIdentity = deriveWatchlistIdentity({
            categoryKey: product.categoryKey,
            familyName: product.familyName,
            brand: product.brand,
            modelFamily: product.modelFamily,
            rawPayloadJson: product.rawPayloadJson,
          });

          const watchlistRow = await repository.getActiveWatchlist(1);
          const exact = watchlistRow.find((row) => row.familyKey === product.familyKey);
          if (exact) {
            await repository.updateWatchlistIdentity({
              watchlistId: exact.id,
              identity: watchlistIdentity,
            });
          }

          logger.info('snapshot product promoted to watchlist', {
            operation: 'runWatchlistWorker',
            snapshotProductId: product.id,
            familyKey: product.familyKey,
            overallWatchScore: product.overallWatchScore,
          });

          await sleep(config.loopDelayMs);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);

          incCounter('worker_failures');

          await writeHeartbeat('degraded', {
            phase: 'error',
            snapshotProductId: product.id,
            familyKey: product.familyKey,
            claimToken: product.claimToken,
            errorCode: 'WATCHLIST_PROMOTION_FAILED',
            errorMessage,
          });

          await repository.insertDeadLetter({
            workerName: config.workerName,
            entityType: 'snapshot_product',
            entityId: String(product.id),
            failureCode: 'WATCHLIST_PROMOTION_FAILED',
            failureMessage: errorMessage,
            payload: {
              snapshotProductId: product.id,
              familyKey: product.familyKey,
              claimToken: product.claimToken,
            },
          });

          logger.error('watchlist worker failed on snapshot product', {
            operation: 'runWatchlistWorker',
            snapshotProductId: product.id,
            familyKey: product.familyKey,
            error: serializeError(error),
          });
        }
      }
    }
  } finally {
    signal?.removeEventListener('abort', stop);
    await writeHeartbeat('stopped', { phase: 'shutdown' });
    await pool.end();
  }
}

async function writeHeartbeat(
  status: Prong2WorkerStatus,
  details: WatchlistHeartbeatDetails,
): Promise<void> {
  const payload: WorkerHeartbeatWriteInput<WatchlistHeartbeatDetails> = {
    workerName: config.workerName,
    workerInstanceId: config.workerInstanceId,
    status,
    details,
  };

  await repository.writeHeartbeat(payload);
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function env(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function floatEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (require.main === module) {
  const abortController = new AbortController();
  process.on('SIGINT', () => abortController.abort());
  process.on('SIGTERM', () => abortController.abort());

  runWatchlistWorker(abortController.signal).catch((error) => {
    logger.error('watchlist worker crashed', {
      operation: 'processExit',
      error: serializeError(error),
    });
    process.exit(1);
  });
}
