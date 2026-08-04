import 'dotenv/config';
import { Pool } from 'pg';
import { createWorker } from '../queues/bullmq';
import { logger } from '../lib/logger';
import { CLAIMS_QUEUE, type ClaimsJob } from '../domains/forensic/claims/jobs/claimsJobs';
import { createClaimsProcessor } from '../domains/forensic/claims/workers/claimsWorker';

// Domain 7E.1 — claims filing-readiness worker. Consumes `domain7-claims`
// { type:'EVALUATE_READINESS', claimCaseLinkId, tenantKey, correlationId }.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: Number(process.env.FORENSIC_WORKER_PG_POOL_MAX ?? 5),
});

const worker = createWorker<ClaimsJob>(CLAIMS_QUEUE, createClaimsProcessor(pool));
worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err: err instanceof Error ? err.message : String(err) }, 'claims job failed'));

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'claims worker shutting down');
  try { await worker.close(); await pool.end(); } finally { process.exit(0); }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

logger.info({ queue: CLAIMS_QUEUE }, 'claims worker started');
