import 'dotenv/config';
import { Pool } from 'pg';
import type { Job } from 'bullmq';
import { createWorker } from '../queues/bullmq';
import { logger } from '../lib/logger';
import { createOperationsModule } from '../domains/forensic/operations/integration/operationsModule';
import { registerOperationsWorkers } from '../domains/forensic/operations/workers/operationsWorkers';

// Domain 7J.2 operations command-center workers (SLA monitor + command snapshot).
// Idle until a scheduler enqueues jobs; runtime needs a provisioned service-account principal.
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: Number(process.env.FORENSIC_WORKER_PG_POOL_MAX ?? 5) });
const { service } = createOperationsModule(pool);
const factory = { create<T>(name: string, handler: (job: Job<T>) => Promise<unknown>) { return createWorker<T>(name, async (job) => { await handler(job); }); } };
const resolver = { async resolve(_processRunId: string) {
  return { tenantKey: 'TCDS', userId: '00000000-0000-0000-0000-000000000000', authSessionId: '00000000-0000-0000-0000-000000000000', assuranceLevel: 'AAL2' as const, permissions: ['forensic.operations.view', 'forensic.operations.sla.evaluate'] };
} };
const workers = registerOperationsWorkers(factory as never, resolver as never, service) as Array<{ close(): Promise<void> }>;
async function shutdown(sig: string): Promise<void> { logger.info({ sig }, 'operations workers stopping'); try { await Promise.all(workers.map(w => w.close())); await pool.end(); } finally { process.exit(0); } }
process.on('SIGTERM', () => void shutdown('SIGTERM')); process.on('SIGINT', () => void shutdown('SIGINT'));
logger.info('operations command-center workers started');
