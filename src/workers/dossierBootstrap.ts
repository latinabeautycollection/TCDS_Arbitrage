import 'dotenv/config';
import { Pool } from 'pg';
import { createWorker } from '../queues/bullmq';
import { logger } from '../lib/logger';
import { DOSSIER_QUEUE, type DossierJob } from '../domains/forensic/casefiles/jobs/dossierJobs';
import { createDossierProcessor } from '../domains/forensic/casefiles/workers/dossierWorker';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: Number(process.env.FORENSIC_WORKER_PG_POOL_MAX ?? 5),
});
const worker = createWorker<DossierJob>(DOSSIER_QUEUE, createDossierProcessor(pool));
worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err: err instanceof Error ? err.message : String(err) }, 'dossier job failed'));
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'dossier worker shutting down');
  try { await worker.close(); await pool.end(); } finally { process.exit(0); }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
logger.info({ queue: DOSSIER_QUEUE }, 'dossier worker started');
