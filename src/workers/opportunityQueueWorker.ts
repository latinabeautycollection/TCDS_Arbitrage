import crypto from 'node:crypto';
import { Pool } from 'pg';
import { createLogger, serializeError } from '../services/logger';
import { Prong2Repository } from '../repositories/prong2Repository';
import { computeMatchScore } from '../services/prong2Matching';
import { deriveCandidateIdentity } from '../services/identity/candidateIdentity';
import { deriveWatchlistIdentity } from '../services/identity/watchlistIdentity';
import { computeIdentityMatchScore } from '../services/identity/identityMatchScoring';
import { buildIdentityMatchDiagnostics } from '../services/identity/identityMatchDiagnostics';
import { incCounter, setGauge } from '../services/prong2Metrics';
import type {
  OpportunityQueueHeartbeatDetails,
  Prong2WorkerStatus,
  WorkerHeartbeatWriteInput,
} from '../contracts/prong2WorkerHealth';

interface Config {
  workerName: string;
  workerInstanceId: string;
  loopDelayMs: number;
  idleSleepMs: number;
  heartbeatIntervalMs: number;
  listingSeedBatchSize: number;
  candidateBatchSize: number;
  watchlistBatchSize: number;
  claimTtlSeconds: number;
  minimumMatchScore: number;
}

const config: Config = {
  workerName: env('OPPORTUNITY_QUEUE_WORKER_NAME', 'opportunity-queue-worker'),
  workerInstanceId: env('OPPORTUNITY_QUEUE_WORKER_INSTANCE_ID', crypto.randomUUID()),
  loopDelayMs: intEnv('OPPORTUNITY_QUEUE_WORKER_LOOP_DELAY_MS', 1000),
  idleSleepMs: intEnv('OPPORTUNITY_QUEUE_WORKER_IDLE_SLEEP_MS', 30000),
  heartbeatIntervalMs: intEnv('OPPORTUNITY_QUEUE_WORKER_HEARTBEAT_INTERVAL_MS', 30000),
  listingSeedBatchSize: intEnv('OPPORTUNITY_QUEUE_WORKER_LISTING_SEED_BATCH_SIZE', 100),
  candidateBatchSize: intEnv('OPPORTUNITY_QUEUE_WORKER_CANDIDATE_BATCH_SIZE', 50),
  watchlistBatchSize: intEnv('OPPORTUNITY_QUEUE_WORKER_WATCHLIST_BATCH_SIZE', 100),
  claimTtlSeconds: intEnv('OPPORTUNITY_QUEUE_WORKER_CLAIM_TTL_SECONDS', 300),
  minimumMatchScore: floatEnv('OPPORTUNITY_QUEUE_WORKER_MIN_MATCH_SCORE', 0.52),
};

const logger = createLogger({
  serviceName: env('APP_SERVICE_NAME', 'arb-system-api'),
  staticBindings: {
    component: 'opportunityQueueWorker',
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

export async function runOpportunityQueueWorker(signal?: AbortSignal): Promise<void> {
  let keepRunning = true;
  let lastHeartbeatAt = 0;

  const stop = (): void => {
    keepRunning = false;
    logger.warn('stop requested', { operation: 'runOpportunityQueueWorker' });
  };

  signal?.addEventListener('abort', stop);

  await writeHeartbeat('starting', { phase: 'boot' });

  try {
    while (keepRunning) {
      if (Date.now() - lastHeartbeatAt >= config.heartbeatIntervalMs) {
        await writeHeartbeat('running', { phase: 'claiming_candidates' });
        lastHeartbeatAt = Date.now();
      }

      const seeded = await repository.ensureCandidatesFromListings(config.listingSeedBatchSize);
      if (seeded > 0) incCounter('candidates_seeded', seeded);

      const [watchlist, candidates] = await Promise.all([
        repository.getActiveWatchlist(config.watchlistBatchSize),
        repository.claimCandidates({
          workerId: config.workerInstanceId,
          batchSize: config.candidateBatchSize,
          claimTtlSeconds: config.claimTtlSeconds,
        }),
      ]);

      if (watchlist.length === 0 || candidates.length === 0) {
        await sleep(config.idleSleepMs);
        continue;
      }

      for (const candidate of candidates) {
        if (!keepRunning) break;

        try {
          await writeHeartbeat('processing', {
            phase: 'candidate_matching',
            candidateId: candidate.candidateId,
            listingId: Number(candidate.listingId),
            claimToken: candidate.claimToken,
          });

          const candidateIdentity = deriveCandidateIdentity({
            categoryKey: candidate.categoryKey,
            title: candidate.title,
            normalizedTitle: candidate.normalizedTitle,
            brand: candidate.brand,
            model: candidate.model,
          });

          await repository.updateCandidateIdentity({
            candidateId: candidate.candidateId,
            identity: candidateIdentity,
          });

          const narrowedWatchlist = await repository.getNarrowedActiveWatchlist({
            categoryKey: candidateIdentity.categoryKey,
            normalizedBrand: candidateIdentity.normalizedBrand,
            normalizedProductType: candidateIdentity.normalizedProductType,
            limit: config.watchlistBatchSize,
          });

          if (narrowedWatchlist.length === 0) {
            await repository.saveCandidateBestMatch({
              candidateId: candidate.candidateId,
              bestWatchlistId: null,
              bestMatchScore: null,
              bestMatchReasonJson: {
                summary: { reason: 'no_narrowed_watchlist_candidates' },
                candidateIdentity,
              },
              finalStatus: 'no_match',
            });
            continue;
          }

          const candidateTotalCost =
            (candidate.currentPrice ?? 0) + (candidate.inboundShippingUsd ?? 0);

          let best:
            | {
                watchlistId: number;
                familyKey: string;
                familyName: string;
                score: ReturnType<typeof computeIdentityMatchScore>;
                diagnostics: ReturnType<typeof buildIdentityMatchDiagnostics>;
                priorityScore: number;
                predictedProfitUsd: number | null;
              }
            | null = null;

          for (const entry of narrowedWatchlist) {
            const watchlistIdentity = entry.identityJson && typeof entry.identityJson === 'object'
              ? ({
                  categoryKey: entry.categoryKey,
                  normalizedBrand: entry.normalizedBrand ?? null,
                  normalizedProductType: entry.normalizedProductType ?? null,
                  normalizedModelFamily: entry.normalizedModelFamily ?? null,
                  normalizedModelToken: entry.normalizedModelToken ?? null,
                  normalizedGeneration: entry.normalizedGeneration ?? null,
                  normalizedVariant: entry.normalizedVariant ?? null,
                  normalizedStorage: entry.normalizedStorage ?? null,
                  normalizedColor: entry.normalizedColor ?? null,
                  normalizedPlatform: entry.normalizedPlatform ?? null,
                  canonicalProductKey: entry.canonicalProductKey ?? null,
                  identityConfidence: entry.identityConfidence ?? 0,
                  isAccessory: entry.isAccessory ?? false,
                  isBundle: entry.isBundle ?? false,
                  rawTokens: [],
                  matchedSignals: [],
                })
              : deriveWatchlistIdentity({
                  categoryKey: entry.categoryKey,
                  familyName: entry.familyName,
                  brand: entry.brand,
                  modelFamily: entry.modelFamily,
                });

            const score = computeIdentityMatchScore({
              candidate: candidateIdentity,
              watchlist: watchlistIdentity,
              candidateTitle: candidate.normalizedTitle ?? candidate.title,
              watchlistFamilyName: entry.familyName,
              candidateTotalCost,
              predictedBuyCostUsd: entry.predictedBuyCostUsd ?? null,
            });

            const diagnostics = buildIdentityMatchDiagnostics({
              candidateIdentity,
              watchlistIdentity,
              score,
              narrowedBy: {
                category: candidateIdentity.categoryKey === entry.categoryKey,
                brand: !candidateIdentity.normalizedBrand || !watchlistIdentity.normalizedBrand
                  ? false
                  : candidateIdentity.normalizedBrand === watchlistIdentity.normalizedBrand,
                productType: !candidateIdentity.normalizedProductType || !watchlistIdentity.normalizedProductType
                  ? false
                  : candidateIdentity.normalizedProductType === watchlistIdentity.normalizedProductType,
                accessoryCompatibility: candidateIdentity.isAccessory === watchlistIdentity.isAccessory,
                bundleCompatibility: candidateIdentity.isBundle === watchlistIdentity.isBundle,
              },
            });

            const priorityScore = Math.round(
              (score.finalScore * 0.65 + (entry.overallWatchScore ?? 0) * 0.35) * 10000,
            ) / 10000;

            if (!best || score.finalScore > best.score.finalScore) {
              best = {
                watchlistId: entry.id,
                familyKey: entry.familyKey,
                familyName: entry.familyName,
                score,
                diagnostics,
                priorityScore,
                predictedProfitUsd: entry.predictedProfitUsd ?? null,
              };
            }
          }

          if (!best) {
            await repository.saveCandidateBestMatch({
              candidateId: candidate.candidateId,
              bestWatchlistId: null,
              bestMatchScore: null,
              bestMatchReasonJson: {
                summary: { reason: 'no_best_match_computed' },
                candidateIdentity,
              },
              finalStatus: 'no_match',
            });
            continue;
          }

          const shouldQueue =
            best.score.matchClass === 'exact_match' ||
            best.score.matchClass === 'strong_family_match' ||
            best.score.matchClass === 'probable_match' ||
            best.score.matchClass === 'weak_match';

          await repository.saveCandidateBestMatch({
            candidateId: candidate.candidateId,
            bestWatchlistId: best.watchlistId,
            bestMatchScore: best.score.finalScore,
            bestMatchReasonJson: {
              summary: {
                reason: shouldQueue ? 'candidate_queued' : 'match_below_queue_class',
                familyKey: best.familyKey,
                familyName: best.familyName,
                matchClass: best.score.matchClass,
              },
              diagnostics: best.diagnostics,
            },
            finalStatus: shouldQueue ? 'matched' : 'no_match',
          });

          if (!shouldQueue) {
            continue;
          }

          const inserted = await repository.queueOpportunityIdempotent({
            candidate,
            watchlistId: best.watchlistId,
            matchScore: best.score.finalScore,
            priorityScore: best.priorityScore,
            reasonJson: {
              familyKey: best.familyKey,
              familyName: best.familyName,
              matchClass: best.score.matchClass,
              matchScore: best.score.finalScore,
              predictedProfitUsd: best.predictedProfitUsd,
              diagnostics: best.diagnostics,
            },
          });

          if (inserted) {
            incCounter('opportunities_queued');
          }

          incCounter('candidates_matched');

          logger.info('candidate processed with identity matching', {
            operation: 'runOpportunityQueueWorker',
            candidateId: candidate.candidateId,
            listingId: candidate.listingId,
            familyKey: best.familyKey,
            watchlistId: best.watchlistId,
            matchScore: best.score.finalScore,
            matchClass: best.score.matchClass,
            priorityScore: best.priorityScore,
            inserted,
          });


          await sleep(config.loopDelayMs);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);

          incCounter('worker_failures');

          await repository.markCandidateRetryNeeded({
            candidateId: candidate.candidateId,
            claimToken: candidate.claimToken,
            detail: errorMessage,
          });

          await writeHeartbeat('degraded', {
            phase: 'error',
            candidateId: candidate.candidateId,
            listingId: Number(candidate.listingId),
            claimToken: candidate.claimToken,
            errorCode: 'OPPORTUNITY_MATCH_FAILED',
            errorMessage,
          });

          await repository.insertDeadLetter({
            workerName: config.workerName,
            entityType: 'candidate',
            entityId: String(candidate.candidateId),
            failureCode: 'OPPORTUNITY_MATCH_FAILED',
            failureMessage: errorMessage,
            payload: {
              candidateId: candidate.candidateId,
              listingId: candidate.listingId,
              claimToken: candidate.claimToken,
            },
          });

          logger.error('opportunity queue worker failed on candidate', {
            operation: 'runOpportunityQueueWorker',
            candidateId: candidate.candidateId,
            listingId: candidate.listingId,
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
  details: OpportunityQueueHeartbeatDetails,
): Promise<void> {
  const payload: WorkerHeartbeatWriteInput<OpportunityQueueHeartbeatDetails> = {
    workerName: config.workerName,
    workerInstanceId: config.workerInstanceId,
    status,
    details,
  };

  await repository.writeHeartbeat(payload);
}

function round(value: number, places = 4): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
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

  runOpportunityQueueWorker(abortController.signal).catch((error) => {
    logger.error('opportunity queue worker crashed', {
      operation: 'processExit',
      error: serializeError(error),
    });
    process.exit(1);
  });
}
