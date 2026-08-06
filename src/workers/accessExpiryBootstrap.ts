import 'dotenv/config';
import { hostname } from 'node:os';
import { Pool } from 'pg';
import type { Job } from 'bullmq';
import { createWorker } from '../queues/bullmq';
import { logger } from '../lib/logger';
import { createAccessExpiryWorker } from '../domains/forensic/access/workers/accessExpiryWorker';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: Number(process.env.FORENSIC_WORKER_PG_POOL_MAX ?? 5) });
const factory = { create<T>(queue: string, processor: (job: Job<T>) => Promise<unknown>) { return createWorker<T>(queue, async (job) => { await processor(job); }); } };
const workerPrincipal = { tenantKey: 'TCDS', userId: undefined, authSessionId: undefined, assuranceLevel: 'AAL2', permissions: [] };
const worker = createAccessExpiryWorker(factory as never, pool, workerPrincipal as never, `${hostname()}:${process.pid}`);
async function shutdown(sig: string): Promise<void> { logger.info({ sig }, 'access expiry worker stopping'); try { await worker.close(); await pool.end(); } finally { process.exit(0); } }
process.on('SIGTERM', () => void shutdown('SIGTERM')); process.on('SIGINT', () => void shutdown('SIGINT'));
logger.info({ queue: 'domain7-access-expiry' }, 'access expiry worker started');
