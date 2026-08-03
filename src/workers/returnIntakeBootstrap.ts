import 'dotenv/config';
import { Pool } from 'pg';
import { createWorker } from '../queues/bullmq';
import { logger } from '../lib/logger';
import { RETURN_INTAKE_QUEUE, type ReturnIntakeJob } from '../domains/forensic/returns/jobs/returnIntakeJobs';
import { createReturnIntakeProcessor } from '../domains/forensic/returns/workers/returnIntakeWorker';

// Domain 7D.1 — return intake gate worker. Consumes `domain7-return-intake`
// { type:'EVALUATE_GATE', linkId, tenantKey, correlationId }.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: Number(process.env.FORENSIC_WORKER_PG_POOL_MAX ?? 5),
});

const worker = createWorker<ReturnIntakeJob>(RETURN_INTAKE_QUEUE, createReturnIntakeProcessor(pool));
worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err: err instanceof Error ? err.message : String(err) }, 'return intake job failed'));

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'return intake worker shutting down');
  try { await worker.close(); await pool.end(); } finally { process.exit(0); }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

logger.info({ queue: RETURN_INTAKE_QUEUE }, 'return intake worker started');
