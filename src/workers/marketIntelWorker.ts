import crypto from 'node:crypto';
import { Pool } from 'pg';
import { createEbayClient } from '../services/ebayClient';
import { createLogger, serializeError } from '../services/logger';
import { EbayScopes } from '../services/ebayScopes';
import { Prong2Repository } from '../repositories/prong2Repository';
import { scoreFamilies, type ScoreFamiliesResult } from '../services/prong2Scoring';
import { incCounter, setGauge } from '../services/prong2Metrics';
import type {
  MarketIntelHeartbeatDetails,
  Prong2WorkerStatus,
  WorkerHeartbeatWriteInput,
} from '../contracts/prong2WorkerHealth';

interface Config {
  workerName: string;
  workerInstanceId: string;
  loopDelayMs: number;
  idleSleepMs: number;
  heartbeatIntervalMs: number;
  strategyBatchSize: number;
}

interface StrategyFilterShape {
  minPriceUsd: number | null;
  maxPriceUsd: number | null;
  minDemandScore: number | null;
  minPredictedProfitUsd: number | null;
  minMarginPct: number | null;
}

const config: Config = {
  workerName: env('MARKET_INTEL_WORKER_NAME', 'market-intel-worker'),
  workerInstanceId: env('MARKET_INTEL_WORKER_INSTANCE_ID', crypto.randomUUID()),
  loopDelayMs: intEnv('MARKET_INTEL_WORKER_LOOP_DELAY_MS', 1000),
  idleSleepMs: intEnv('MARKET_INTEL_WORKER_IDLE_SLEEP_MS', 30000),
  heartbeatIntervalMs: intEnv('MARKET_INTEL_WORKER_HEARTBEAT_INTERVAL_MS', 30000),
  strategyBatchSize: intEnv('MARKET_INTEL_WORKER_STRATEGY_BATCH_SIZE', 5),
};

const logger = createLogger({
  serviceName: env('APP_SERVICE_NAME', 'arb-system-api'),
  staticBindings: {
    component: 'marketIntelWorker',
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
const ebayClient = createEbayClient({ logger });

export async function runMarketIntelWorker(signal?: AbortSignal): Promise<void> {
  let keepRunning = true;
  let lastHeartbeatAt = 0;

  const stop = (): void => {
    keepRunning = false;
    logger.warn('stop requested', { operation: 'runMarketIntelWorker' });
  };

  signal?.addEventListener('abort', stop);

  await writeHeartbeat('starting', { phase: 'boot' });

  try {
    while (keepRunning) {
      if (Date.now() - lastHeartbeatAt >= config.heartbeatIntervalMs) {
        await writeHeartbeat('running', { phase: 'polling_strategies' });
        lastHeartbeatAt = Date.now();
      }

      const strategies = await repository.getActiveStrategies(config.strategyBatchSize);

      if (strategies.length === 0) {
        await sleep(config.idleSleepMs);
        continue;
      }

      for (const strategy of strategies) {
        if (!keepRunning) break;

        const locked = await repository.tryAdvisoryLockStrategy(strategy.id);
        if (!locked) continue;

        const correlationId = crypto.randomUUID();
        const query = buildStrategyQuery(
          strategy.categoryName,
          strategy.includeKeywords,
          strategy.excludeKeywords,
        );

        let runId: number | null = null;

        try {
          await writeHeartbeat('processing', {
            phase: 'market_pull',
            strategyId: strategy.id,
            categoryKey: strategy.categoryKey,
            query,
            correlationId,
          });

          runId = await repository.createMarketIntelRun({
            strategyId: strategy.id,
            requestedProductCount: strategy.maxProductsPerRun,
            apiSource: 'browse',
            correlationId,
          });

          const searchParams = {
            query,
            limit: strategy.maxProductsPerRun,
            correlationId,
            tokenMode: 'application' as const,
            requiredScopes: [EbayScopes.PUBLIC],
            categoryIds: strategy.ebayCategoryId ? [strategy.ebayCategoryId] : undefined,
          };

          const [sold, active] = await Promise.all([
            ebayClient.searchSoldItems(searchParams),
            ebayClient.searchActiveItems(searchParams),
          ]);

          const families = scoreFamilies({
            categoryKey: strategy.categoryKey,
            soldItems: sold.itemSummaries,
            activeItems: active.itemSummaries,
          }).families.filter((family) => filterFamilyByStrategy(strategy, family));

          const snapshotId = await repository.createSnapshot({
            runId,
            strategyId: strategy.id,
            categoryKey: strategy.categoryKey,
            ebayCategoryId: strategy.ebayCategoryId,
            queryContext: {
              query,
              strategyId: strategy.id,
              categoryKey: strategy.categoryKey,
              includeKeywords: strategy.includeKeywords,
              excludeKeywords: strategy.excludeKeywords,
            },
            itemCount: sold.itemSummaries.length + active.itemSummaries.length,
            avgPriceUsd: average(
              families.flatMap((family) => [...family.soldPrices, ...family.activePrices]),
            ),
            medianPriceUsd: families.length > 0 ? families[0]!.score.soldMedian : null,
            rawPayload: { sold, active },
          });

          await repository.insertSnapshotProducts({
            runId,
            snapshotId,
            strategyId: strategy.id,
            families,
          });

          await repository.completeMarketIntelRun({
            runId,
            receivedProductCount: families.length,
          });

          incCounter('market_strategies_processed');
          incCounter('families_scored', families.length);
          setGauge('latest_market_family_count', families.length);

          logger.info('market intel strategy completed', {
            operation: 'runMarketIntelWorker',
            strategyId: strategy.id,
            categoryKey: strategy.categoryKey,
            familyCount: families.length,
            query,
            correlationId,
            runId,
          });

          await sleep(config.loopDelayMs);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);

          incCounter('market_runs_failed');
          incCounter('worker_failures');

          if (runId !== null) {
            await repository.failMarketIntelRun({
              runId,
              errorCode: 'MARKET_PULL_FAILED',
              errorMessage,
            });
          }

          await writeHeartbeat('degraded', {
            phase: 'error',
            strategyId: strategy.id,
            categoryKey: strategy.categoryKey,
            query,
            runId: runId ?? undefined,
            correlationId,
            errorCode: 'MARKET_PULL_FAILED',
            errorMessage,
          });

          await repository.insertDeadLetter({
            workerName: config.workerName,
            entityType: 'strategy',
            entityId: String(strategy.id),
            failureCode: 'MARKET_PULL_FAILED',
            failureMessage: errorMessage,
            payload: {
              strategyId: strategy.id,
              categoryKey: strategy.categoryKey,
              query,
              correlationId,
              runId,
            },
          });

          logger.error('market intel strategy failed', {
            operation: 'runMarketIntelWorker',
            strategyId: strategy.id,
            categoryKey: strategy.categoryKey,
            query,
            correlationId,
            runId,
            error: serializeError(error),
          });
        } finally {
          await repository.releaseAdvisoryLockStrategy(strategy.id);
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
  details: MarketIntelHeartbeatDetails,
): Promise<void> {
  const payload: WorkerHeartbeatWriteInput<MarketIntelHeartbeatDetails> = {
    workerName: config.workerName,
    workerInstanceId: config.workerInstanceId,
    status,
    details,
  };

  await repository.writeHeartbeat(payload);
}

function buildStrategyQuery(
  categoryName: string,
  includeKeywords: string[],
  excludeKeywords: string[],
): string {
  const positive = [categoryName, ...includeKeywords].filter(Boolean).join(' ');
  const negative = excludeKeywords.map((keyword) => `-${keyword}`).join(' ');
  return normalizeWhitespace(`${positive} ${negative}`);
}

const CERTIFICATION_MODE = process.env.PRONG2_CERTIFICATION_MODE === 'true';
const RELAXED_MIN_DEMAND = Number(process.env.PRONG2_RELAXED_MIN_DEMAND_SCORE ?? '0.10');
const RELAXED_MIN_PROFIT = Number(process.env.PRONG2_RELAXED_MIN_PROFIT_USD ?? '5');
const RELAXED_MIN_MARGIN = Number(process.env.PRONG2_RELAXED_MIN_MARGIN_PCT ?? '0.05');
const MIN_FAMILY_SOLD_COUNT = Number(process.env.PRONG2_MIN_FAMILY_SOLD_COUNT ?? '3');

function filterFamilyByStrategy(
  strategy: StrategyFilterShape,
  family: ScoreFamiliesResult['families'][number],
): boolean {
  const sale = family.score.predictedSalePriceUsd;
  const profit = family.score.predictedProfitUsd;
  const margin = family.score.predictedMarginPct;
  const demand = family.score.demandScore;

  const minDemand = CERTIFICATION_MODE ? RELAXED_MIN_DEMAND : (strategy.minDemandScore ?? 0);
  const minProfit = CERTIFICATION_MODE ? RELAXED_MIN_PROFIT : (strategy.minPredictedProfitUsd ?? 0);
  const minMargin = CERTIFICATION_MODE ? RELAXED_MIN_MARGIN : (strategy.minMarginPct ?? 0);
  const minSold = CERTIFICATION_MODE ? MIN_FAMILY_SOLD_COUNT : 3;

  if (strategy.minPriceUsd !== null && sale !== null && sale < strategy.minPriceUsd) return false;
  if (strategy.maxPriceUsd !== null && sale !== null && sale > strategy.maxPriceUsd) return false;
  if (demand < minDemand) return false;
  if ((profit ?? Number.NEGATIVE_INFINITY) < minProfit) return false;
  if ((margin ?? Number.NEGATIVE_INFINITY) < minMargin) return false;

  return family.score.soldCount >= minSold;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length, 2);
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function round(value: number, places = 2): number {
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

  runMarketIntelWorker(abortController.signal).catch((error) => {
    logger.error('market intel worker crashed', {
      operation: 'processExit',
      error: serializeError(error),
    });
    process.exit(1);
  });
}
