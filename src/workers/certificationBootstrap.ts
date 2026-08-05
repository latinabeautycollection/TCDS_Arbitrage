import 'dotenv/config';
import { Pool } from 'pg';
import { createWorker } from '../queues/bullmq';
import { logger } from '../lib/logger';
import { CERTIFICATION_QUEUE, type CertificationJob } from '../domains/forensic/assurance/jobs/certificationJobs';
import { createCertificationProcessor } from '../domains/forensic/assurance/workers/certificationWorker';

// Domain 7G.2 — certification campaign evidence-collection worker. Consumes `domain7-certification`.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: Number(process.env.FORENSIC_WORKER_PG_POOL_MAX ?? 5),
});

const certificationProcessor = createCertificationProcessor(pool);
const worker = createWorker<CertificationJob>(CERTIFICATION_QUEUE, async (job) => { await certificationProcessor(job); });
worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err: err instanceof Error ? err.message : String(err) }, 'certification job failed'));

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'certification worker shutting down');
  try { await worker.close(); await pool.end(); } finally { process.exit(0); }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

logger.info({ queue: CERTIFICATION_QUEUE }, 'certification worker started');
