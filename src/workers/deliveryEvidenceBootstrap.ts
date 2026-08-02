import 'dotenv/config';
import { Pool } from 'pg';
import { createWorker } from '../queues/bullmq';
import { logger } from '../lib/logger';
import { DELIVERY_EVIDENCE_QUEUE, type DeliveryJob } from '../domains/forensic/delivery/jobs/deliveryEvidenceJobs';
import { createDeliveryProcessor } from '../domains/forensic/delivery/workers/deliveryEvidenceWorker';

// Domain 7C.2 — delivery evidence worker. Consumes `domain7-delivery-evidence`
// { type:'ATTEST_TRACKING'|'ASSESS', linkId, tenantKey, eventId?, correlationId }.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: Number(process.env.FORENSIC_WORKER_PG_POOL_MAX ?? 5),
});

const worker = createWorker<DeliveryJob>(DELIVERY_EVIDENCE_QUEUE, createDeliveryProcessor(pool));
worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err: err instanceof Error ? err.message : String(err) }, 'delivery evidence job failed'));

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'delivery evidence worker shutting down');
  try { await worker.close(); await pool.end(); } finally { process.exit(0); }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

logger.info({ queue: DELIVERY_EVIDENCE_QUEUE }, 'delivery evidence worker started');
