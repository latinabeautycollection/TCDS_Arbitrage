import 'dotenv/config';
import { Pool } from 'pg';
import { createWorker } from '../queues/bullmq';
import { logger } from '../lib/logger';
import { RECOVERY_QUEUE, type RecoveryJob } from '../domains/forensic/claims/jobs/recoveryJobs';
import { createRecoveryProcessor } from '../domains/forensic/claims/workers/recoveryWorker';

// Domain 7E.2 — dispute recovery / reconciliation worker. Consumes `domain7-recovery`
// { type:'BUILD_PACKAGE'|'RECONCILE', entityId, tenantKey, correlationId }.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: Number(process.env.FORENSIC_WORKER_PG_POOL_MAX ?? 5),
});

const worker = createWorker<RecoveryJob>(RECOVERY_QUEUE, createRecoveryProcessor(pool));
worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err: err instanceof Error ? err.message : String(err) }, 'recovery job failed'));

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'recovery worker shutting down');
  try { await worker.close(); await pool.end(); } finally { process.exit(0); }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

logger.info({ queue: RECOVERY_QUEUE }, 'recovery worker started');
