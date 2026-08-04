import 'dotenv/config';
import { Pool } from 'pg';
import { createWorker } from '../queues/bullmq';
import { logger } from '../lib/logger';
import { LEGAL_HOLD_QUEUE, type LegalHoldJob } from '../domains/forensic/casefiles/jobs/legalHoldJobs';
import { createLegalHoldProcessor } from '../domains/forensic/casefiles/workers/legalHoldWorker';

// Domain 7F.1 — legal hold scope/preservation worker. Consumes `domain7-legal-hold`
// { type:'MATERIALIZE_SCOPE'|'VERIFY_HOLD', entityId, tenantKey, correlationId }.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: Number(process.env.FORENSIC_WORKER_PG_POOL_MAX ?? 5),
});

const worker = createWorker<LegalHoldJob>(LEGAL_HOLD_QUEUE, createLegalHoldProcessor(pool));
worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err: err instanceof Error ? err.message : String(err) }, 'legal hold job failed'));

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'legal hold worker shutting down');
  try { await worker.close(); await pool.end(); } finally { process.exit(0); }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

logger.info({ queue: LEGAL_HOLD_QUEUE }, 'legal hold worker started');
