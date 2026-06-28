/* src/workers/capitalAllocationWorker.ts
 * Domain 2 — Capital Allocation Worker
 * Hardened to surface BUY handoff counts and preserve Domain 1 execution states.
 */

import crypto from 'node:crypto';
import { Pool } from 'pg';
import { createLogger, serializeError } from '../services/logger';
import { CapitalAllocationRepository } from '../repositories/capitalAllocationRepository';
import { allocateCapital } from '../services/capitalAllocationEngine';

const workerName = process.env.CAPITAL_ALLOCATION_WORKER_NAME || 'capital-allocation-worker';
const workerInstanceId = process.env.CAPITAL_ALLOCATION_WORKER_INSTANCE_ID || crypto.randomUUID();
const intervalMs = positiveInt(process.env.CAPITAL_ALLOCATION_INTERVAL_MS, 300000);
const batchSize = positiveInt(process.env.CAPITAL_ALLOCATION_BATCH_SIZE, 500);
const pgPoolMax = positiveInt(process.env.PG_POOL_MAX, 10);

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required for capital allocation worker');
}

const logger = createLogger({
  serviceName: process.env.APP_SERVICE_NAME || 'arb-system-api',
  staticBindings: { component: 'capitalAllocationWorker', workerName, workerInstanceId },
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: pgPoolMax,
  ssl: process.env.PG_SSL_ENABLED === 'false' ? false : { rejectUnauthorized: false },
} as Record<string, unknown>);

const repository = new CapitalAllocationRepository(pool);

let shuttingDown = false;
let inFlight = false;

async function executeOnce(): Promise<void> {
  if (inFlight) {
    logger.warn('capital allocation skipped because previous run is still active', { operation: 'executeOnce' });
    return;
  }

  inFlight = true;

  const startedAt = Date.now();
  const runCorrelationId = crypto.randomUUID();

  try {
    await safeHeartbeat('processing', { phase: 'capital_allocation', runCorrelationId, batchSize });

    const policy = await repository.getPolicy();
    const opportunities = await repository.getBuyQualified(batchSize, policy.mode);

    const sourceSummary = summarizeSource(opportunities);

    const result = allocateCapital({ policy, opportunities });

    const runId = await repository.persistRun({
      mode: policy.mode,
      policy,
      opportunities,
      result,
    });

    const durationMs = Date.now() - startedAt;

    logger.info('capital allocation completed', {
      operation: 'executeOnce',
      runId,
      runCorrelationId,
      mode: policy.mode,
      policyVersion: policy.policyVersion,
      candidateCount: opportunities.length,
      allocatedCapitalUsd: result.allocatedCapitalUsd,
      remainingCapitalUsd: result.remainingCapitalUsd,
      allocatedCount: result.allocatedCount,
      purchaseQueueEligibleCount: result.purchaseQueueEligibleCount,
      blockedCount: result.blockedCount,
      reviewRequiredCount: result.reviewRequiredCount,
      bidMonitorCount: result.bidMonitorCount,
      sourceSummary,
      durationMs,
    });

    await safeHeartbeat('running', {
      phase: 'sleeping',
      runId,
      runCorrelationId,
      mode: policy.mode,
      policyVersion: policy.policyVersion,
      candidateCount: opportunities.length,
      allocatedCapitalUsd: result.allocatedCapitalUsd,
      remainingCapitalUsd: result.remainingCapitalUsd,
      allocatedCount: result.allocatedCount,
      purchaseQueueEligibleCount: result.purchaseQueueEligibleCount,
      blockedCount: result.blockedCount,
      reviewRequiredCount: result.reviewRequiredCount,
      bidMonitorCount: result.bidMonitorCount,
      sourceSummary,
      durationMs,
      nextRunInMs: intervalMs,
    });
  } catch (error) {
    const serialized = serializeError(error);

    logger.error('capital allocation execution failed', {
      operation: 'executeOnce',
      runCorrelationId,
      error: serialized,
    });

    await safeHeartbeat('degraded', { phase: 'error', runCorrelationId, error: serialized });

    await safeDeadLetter({
      workerName,
      failureCode: 'CAPITAL_ALLOCATION_EXECUTION_FAILED',
      failureMessage: error instanceof Error ? error.message : String(error),
      payloadJson: { workerInstanceId, runCorrelationId, batchSize, intervalMs, error: serialized },
    });
  } finally {
    inFlight = false;
  }
}

async function main(): Promise<void> {
  logger.info('capital allocation worker starting', {
    operation: 'main',
    workerName,
    workerInstanceId,
    intervalMs,
    batchSize,
    pgPoolMax,
  });

  process.on('SIGINT', requestShutdown);
  process.on('SIGTERM', requestShutdown);

  await safeHeartbeat('starting', { phase: 'boot', intervalMs, batchSize });
  await verifyDatabase();

  while (!shuttingDown) {
    const loopStartedAt = Date.now();
    await executeOnce();

    const elapsedMs = Date.now() - loopStartedAt;
    const sleepMs = Math.max(1000, intervalMs - elapsedMs);

    if (!shuttingDown) await sleepInterruptible(sleepMs);
  }

  await shutdownCleanly();
}

function requestShutdown(): void {
  shuttingDown = true;
  logger.info('capital allocation worker shutdown requested', {
    operation: 'requestShutdown',
    workerName,
    workerInstanceId,
  });
}

async function verifyDatabase(): Promise<void> {
  await pool.query('select 1');

  await pool.query(`
    do $$
    begin
      if to_regclass('arb.capital_allocation_policy') is null then raise exception 'missing table arb.capital_allocation_policy'; end if;
      if to_regclass('arb.capital_allocation_runs') is null then raise exception 'missing table arb.capital_allocation_runs'; end if;
      if to_regclass('arb.capital_allocation_items') is null then raise exception 'missing table arb.capital_allocation_items'; end if;
      if to_regclass('arb.capital_allocation_dead_letter') is null then raise exception 'missing table arb.capital_allocation_dead_letter'; end if;
      if to_regclass('arb.v_domain2_buy_qualified_source') is null and to_regclass('arb.decisions') is null then
        raise exception 'missing Domain 2 source view and fallback decisions table';
      end if;
      if to_regclass('arb.worker_heartbeats') is null then raise exception 'missing table arb.worker_heartbeats'; end if;
      if to_regclass('arb.decisions') is null then raise exception 'missing table arb.decisions'; end if;
    end $$;
  `);

  await pool.query(`
    do $$
    begin
      if not exists (
        select 1 from information_schema.columns
        where table_schema = 'arb' and table_name = 'capital_allocation_policy' and column_name = 'mode'
      ) then raise exception 'missing column arb.capital_allocation_policy.mode'; end if;

      if not exists (
        select 1 from information_schema.columns
        where table_schema = 'arb' and table_name = 'capital_allocation_policy' and column_name = 'require_capital_safety'
      ) then raise exception 'missing column arb.capital_allocation_policy.require_capital_safety'; end if;

      if not exists (
        select 1 from information_schema.columns
        where table_schema = 'arb' and table_name = 'decisions' and column_name = 'listing_id'
      ) then raise exception 'missing column arb.decisions.listing_id'; end if;

      if not exists (
        select 1 from information_schema.columns
        where table_schema = 'arb' and table_name = 'decisions' and column_name = 'decision'
      ) then raise exception 'missing column arb.decisions.decision'; end if;
    end $$;
  `);

  const sourceCheck = await pool.query(`
    select
      (select to_regclass('arb.v_domain2_buy_qualified_source') is not null)::bool as has_source_view,
      (select count(*)::int from arb.decisions where decision::text ilike 'BUY%') as buy_decisions_total
  `);

  logger.info('capital allocation database verification passed', {
    operation: 'verifyDatabase',
    source: sourceCheck.rows[0] ?? {},
  });
}

function summarizeSource(opportunities: Array<{ executionStatus?: string | null; purchaseQueueStatus?: string | null }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const op of opportunities) {
    const key = String(op.executionStatus ?? 'UNKNOWN');
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

async function shutdownCleanly(): Promise<void> {
  const shutdownStartedAt = Date.now();

  while (inFlight && Date.now() - shutdownStartedAt < 30000) {
    await sleep(500);
  }

  await safeHeartbeat('stopped', { phase: 'shutdown', waitedForInFlight: inFlight });
  await pool.end();

  logger.info('capital allocation worker stopped', {
    operation: 'shutdownCleanly',
    workerName,
    workerInstanceId,
  });
}

async function safeHeartbeat(status: string, details: Record<string, unknown>): Promise<void> {
  try {
    await repository.writeHeartbeat(workerName, workerInstanceId, status, details);
  } catch (error) {
    logger.error('failed to write capital allocation heartbeat', {
      operation: 'safeHeartbeat',
      status,
      error: serializeError(error),
    });
  }
}

async function safeDeadLetter(input: {
  workerName: string;
  failureCode: string;
  failureMessage: string;
  payloadJson: unknown;
}): Promise<void> {
  try {
    await repository.deadLetter(input);
  } catch (error) {
    logger.error('failed to write capital allocation dead letter', {
      operation: 'safeDeadLetter',
      error: serializeError(error),
    });
  }
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sleepInterruptible(ms: number): Promise<void> {
  const stepMs = 1000;
  let remaining = ms;

  while (!shuttingDown && remaining > 0) {
    const current = Math.min(stepMs, remaining);
    await sleep(current);
    remaining -= current;
  }
}

main().catch(async (error) => {
  logger.error('capital allocation worker crashed', {
    operation: 'processExit',
    error: serializeError(error),
  });

  await safeDeadLetter({
    workerName,
    failureCode: 'CAPITAL_ALLOCATION_WORKER_CRASHED',
    failureMessage: error instanceof Error ? error.message : String(error),
    payloadJson: { workerInstanceId, error: serializeError(error) },
  });

  await safeHeartbeat('failed', { phase: 'crashed', error: serializeError(error) });
  await pool.end().catch(() => undefined);
  process.exit(1);
});
