import 'dotenv/config';
import { Pool } from 'pg';
import { createWorker } from '../queues/bullmq';
import { logger } from '../lib/logger';
import { ASSURANCE_QUEUE, type AssuranceJob } from '../domains/forensic/assurance/jobs/assuranceJobs';
import { createAssuranceProcessor } from '../domains/forensic/assurance/workers/assuranceWorker';

// Domain 7G.1 — continuous forensic assurance worker. Consumes `domain7-assurance`
// { type:'EVALUATE_CONTROL'|'GENERATE_ROLLUP', ... }.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: Number(process.env.FORENSIC_WORKER_PG_POOL_MAX ?? 5),
});

const assuranceProcessor = createAssuranceProcessor(pool);
const worker = createWorker<AssuranceJob>(ASSURANCE_QUEUE, async (job) => { await assuranceProcessor(job); });
worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err: err instanceof Error ? err.message : String(err) }, 'assurance job failed'));

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'assurance worker shutting down');
  try { await worker.close(); await pool.end(); } finally { process.exit(0); }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

logger.info({ queue: ASSURANCE_QUEUE }, 'assurance worker started');
