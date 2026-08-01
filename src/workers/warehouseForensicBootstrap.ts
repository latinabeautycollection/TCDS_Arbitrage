import 'dotenv/config';
import { Pool } from 'pg';
import type { Queue, Worker, Job } from 'bullmq';
import { createQueue, createWorker } from '../queues/bullmq';
import { logger } from '../lib/logger';
import { createWarehouseForensicQueueRuntime } from '../domains/forensic/warehouse/jobs/createWarehouseForensicQueue';

// Domain 7B — warehouse-forensic queue worker host (standalone pm2 process; individual-worker model).
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: Number(process.env.WFORENSIC_PG_POOL_MAX ?? 5),
});

const runtime = createWarehouseForensicQueueRuntime(pool, {
  createQueue: <T>(name: string): Queue<T> => createQueue(name) as unknown as Queue<T>,
  createWorker: <T>(name: string, processor: (job: Job<T>) => Promise<void>): Worker<T> =>
    createWorker<T>(name, processor),
});

logger.info({ queue: runtime.queue.name }, 'warehouse forensic runtime started');

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'warehouse forensic runtime shutting down');
  try {
    await runtime.worker.close();
    await runtime.queue.close();
    await pool.end();
  } catch (err) {
    logger.error({ err }, 'warehouse forensic shutdown error');
  } finally {
    process.exit(0);
  }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
