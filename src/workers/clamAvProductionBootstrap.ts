import 'dotenv/config';
import { logger } from '../lib/logger';
import { redisConnection } from '../queues/bullmq';
import { pool } from '../db/pool';
import { createClamAvProductionRuntime } from '../domains/forensic/malware/integration/createClamAvProductionRuntime';
import { clamAvEnvironmentSchema } from '../domains/forensic/malware/integration/clamAvEnvironment';

// Standalone host for the Domain 7 ClamAV production runtime (malware-scan + storage-isolation workers).
// Mirrors the official workerBootstrap patch (our repo runs workers as individual pm2 processes).
// clamAvEnvironmentSchema is .strict(): project only the schema's keys before parsing process.env.
function projectEnv(): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const key of Object.keys(clamAvEnvironmentSchema.shape)) out[key] = process.env[key];
  return out;
}

async function main(): Promise<void> {
  const env = clamAvEnvironmentSchema.parse(projectEnv());
  const runtime = createClamAvProductionRuntime({ pool, redisConnection, logger, env });

  const readiness = await runtime.readiness.check();
  if (!readiness.ready) {
    throw new Error(`ClamAV production readiness failed: ${JSON.stringify(readiness.details)}`);
  }
  logger.info({ workers: runtime.workers.map((w) => w.name) }, 'clamav production runtime started');

  // STOPGAP: the package writes forensic.storage_isolation_commands rows but never enqueues a
  // domain7-storage-isolation job, so quarantined sources would never be revoked. Poll for PENDING
  // commands and enqueue one trigger each (the isolation worker ignores job data and claims via
  // SKIP LOCKED). Flagged to Anthony to fix at source (isolationQueue.add after completeInfected).
  const isolationQueue = runtime.queues.find((q) => q.name === 'domain7-storage-isolation');
  const drainTimer = setInterval(() => {
    void (async () => {
      try {
        if (!isolationQueue) return;
        const { rows } = await pool.query(
          `SELECT count(*)::int AS n FROM forensic.storage_isolation_commands WHERE status='PENDING'`,
        );
        const n: number = rows[0]?.n ?? 0;
        for (let i = 0; i < n; i++) await isolationQueue.add('drain', {});
        if (n > 0) logger.info({ pending: n }, 'enqueued storage-isolation drain triggers');
      } catch (err) {
        logger.error({ err }, 'storage-isolation drain poll failed');
      }
    })();
  }, 15000);

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'clamav production runtime shutting down');
    clearInterval(drainTimer);
    try { await runtime.close(); } finally { process.exit(0); }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void main().catch((err) => {
  logger.error({ err }, 'clamav production runtime failed to start');
  process.exit(1);
});
