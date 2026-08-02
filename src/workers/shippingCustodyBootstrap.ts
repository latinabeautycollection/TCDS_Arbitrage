import 'dotenv/config';
import { Pool } from 'pg';
import { createWorker } from '../queues/bullmq';
import { logger } from '../lib/logger';
import { SHIPPING_CUSTODY_QUEUE, type ShippingCustodyJob } from '../domains/forensic/shipping/jobs/shippingCustodyJobs';
import { createShippingCustodyProcessor } from '../domains/forensic/shipping/workers/shippingCustodyWorker';

// Domain 7C.1 — shipping custody gate worker. Consumes `domain7-shipping-custody`
// { type:'EVALUATE_GATE', linkId, tenantKey, correlationId }.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: Number(process.env.FORENSIC_WORKER_PG_POOL_MAX ?? 5),
});

const worker = createWorker<ShippingCustodyJob>(SHIPPING_CUSTODY_QUEUE, createShippingCustodyProcessor(pool));
worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err: err instanceof Error ? err.message : String(err) }, 'shipping custody job failed'));

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'shipping custody worker shutting down');
  try { await worker.close(); await pool.end(); } finally { process.exit(0); }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

logger.info({ queue: SHIPPING_CUSTODY_QUEUE }, 'shipping custody worker started');
