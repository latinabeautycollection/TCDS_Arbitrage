import crypto from 'node:crypto';
import { Pool } from 'pg';
import { createLogger, serializeError } from '../services/logger';
import { CapitalSafetyRepository } from '../repositories/capitalSafetyRepository';
import { evaluateCompGrounding } from '../services/capitalSafetyScoring';

const config = {
  workerName: env('PRONG2_COMP_GROUNDING_WORKER_NAME', 'prong2-comp-set-grounding-worker'),
  workerInstanceId: env('PRONG2_COMP_GROUNDING_WORKER_INSTANCE_ID', crypto.randomUUID()),
  loopDelayMs: intEnv('PRONG2_COMP_GROUNDING_LOOP_DELAY_MS', 1000),
  idleSleepMs: intEnv('PRONG2_COMP_GROUNDING_IDLE_SLEEP_MS', 30000),
  heartbeatIntervalMs: intEnv('PRONG2_COMP_GROUNDING_HEARTBEAT_INTERVAL_MS', 30000),
  batchSize: intEnv('PRONG2_COMP_GROUNDING_BATCH_SIZE', 50),
};
const logger = createLogger({ serviceName: env('APP_SERVICE_NAME', 'arb-system-api'), staticBindings: { component: 'prong2CompSetGroundingWorker', workerName: config.workerName, workerInstanceId: config.workerInstanceId } });
const pool = new Pool({ connectionString: requiredEnv('DATABASE_URL'), max: intEnv('PG_POOL_MAX', 10), idleTimeoutMillis: intEnv('PG_IDLE_TIMEOUT_MS', 30000), connectionTimeoutMillis: intEnv('PG_CONNECTION_TIMEOUT_MS', 10000), statement_timeout: intEnv('PG_STATEMENT_TIMEOUT_MS', 30000), query_timeout: intEnv('PG_QUERY_TIMEOUT_MS', 30000), application_name: `${config.workerName}:${config.workerInstanceId}`, ssl: boolEnv('PG_SSL_ENABLED', true) ? { rejectUnauthorized: false } : false } as Record<string, unknown>);
const repository = new CapitalSafetyRepository(pool, logger);

export async function runProng2CompSetGroundingWorker(signal?: AbortSignal): Promise<void> {
  let running = true;
  let lastHeartbeat = 0;
  const stop = (): void => { running = false; logger.warn('stop requested', { operation: 'runProng2CompSetGroundingWorker' }); };
  signal?.addEventListener('abort', stop);
  await heartbeat('starting', { phase: 'boot' });
  try {
    while (running) {
      if (Date.now() - lastHeartbeat >= config.heartbeatIntervalMs) {
        await heartbeat('running', { phase: 'grounding_candidates' });
        lastHeartbeat = Date.now();
      }
      const candidates = await repository.getGroundingCandidates(config.batchSize);
      if (candidates.length === 0) { await sleep(config.idleSleepMs); continue; }
      for (const candidate of candidates) {
        if (!running) break;
        try {
          await heartbeat('processing', { phase: 'comp_grounding', listingId: candidate.listingId, candidateId: candidate.candidateId });
          const result = evaluateCompGrounding(candidate);
          await repository.insertCompGrounding(candidate, result);
          logger.info('comp grounding assessed', { operation: 'runProng2CompSetGroundingWorker', listingId: candidate.listingId, candidateId: candidate.candidateId, groundingScore: result.groundingScore, groundingStatus: result.groundingStatus, reasonCodes: result.reasonCodes });
          await sleep(config.loopDelayMs);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          await repository.insertDeadLetter({ workerName: config.workerName, entityType: 'candidate', entityId: String(candidate.candidateId ?? candidate.listingId), failureCode: 'COMP_GROUNDING_FAILED', failureMessage: msg, payload: { candidate, error: serializeError(error) } });
          logger.error('comp grounding failed', { operation: 'runProng2CompSetGroundingWorker', candidate, error: serializeError(error) });
        }
      }
    }
  } finally {
    signal?.removeEventListener('abort', stop);
    await heartbeat('stopped', { phase: 'shutdown' });
    await pool.end();
  }
}
async function heartbeat(status: string, details: Record<string, unknown>): Promise<void> { await repository.writeHeartbeat({ workerName: config.workerName, workerInstanceId: config.workerInstanceId, status, details }); }
function requiredEnv(name: string): string { const v = process.env[name]?.trim(); if (!v) throw new Error(`Missing required environment variable: ${name}`); return v; }
function env(name: string, fallback: string): string { return process.env[name]?.trim() || fallback; }
function intEnv(name: string, fallback: number): number { const n = Number.parseInt(process.env[name] ?? '', 10); return Number.isFinite(n) ? n : fallback; }
function boolEnv(name: string, fallback: boolean): boolean { const raw = process.env[name]; return raw ? ['1','true','yes','on'].includes(raw.trim().toLowerCase()) : fallback; }
function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }
if (require.main === module) { const ac = new AbortController(); process.on('SIGINT', () => ac.abort()); process.on('SIGTERM', () => ac.abort()); runProng2CompSetGroundingWorker(ac.signal).catch((error) => { logger.error('prong2 comp grounding worker crashed', { operation: 'processExit', error: serializeError(error) }); process.exit(1); }); }
