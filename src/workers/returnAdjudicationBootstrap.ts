import 'dotenv/config';
import { Pool } from 'pg';
import { createWorker } from '../queues/bullmq';
import { logger } from '../lib/logger';
import { RETURN_ADJUDICATION_QUEUE, type ReturnAdjudicationJob } from '../domains/forensic/returns/jobs/returnAdjudicationJobs';
import { createReturnAdjudicationProcessor } from '../domains/forensic/returns/workers/returnAdjudicationWorker';

// Domain 7D.2 — return fraud adjudication worker. Consumes `domain7-return-adjudication`
// { type:'ASSESS'|'EVALUATE', linkId, tenantKey, correlationId }.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: Number(process.env.FORENSIC_WORKER_PG_POOL_MAX ?? 5),
});

const worker = createWorker<ReturnAdjudicationJob>(RETURN_ADJUDICATION_QUEUE, createReturnAdjudicationProcessor(pool));
worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err: err instanceof Error ? err.message : String(err) }, 'return adjudication job failed'));

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'return adjudication worker shutting down');
  try { await worker.close(); await pool.end(); } finally { process.exit(0); }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

logger.info({ queue: RETURN_ADJUDICATION_QUEUE }, 'return adjudication worker started');
