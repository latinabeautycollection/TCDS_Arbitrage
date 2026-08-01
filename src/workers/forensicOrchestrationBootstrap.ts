import 'dotenv/config';
import { Pool } from 'pg';
import { Queue, Worker } from 'bullmq';
import { redisConnection } from '../queues/bullmq';
import { logger as pino } from '../lib/logger';
import type { ForensicLogger, ManifestBuildJob } from '../domains/forensic/models/orchestrationTypes';
import { ManifestBuilderService } from '../domains/forensic/services/manifestBuilderService';
import { ForensicManifestWorkerProcessor, registerForensicWorkerEvents } from '../domains/forensic/workers/forensicManifestWorker';
import { ForensicOutboxDispatcher } from '../domains/forensic/workers/forensicOutboxDispatcher';
import { ForensicOrchestrationQueue, FORENSIC_ORCHESTRATION_QUEUE } from '../domains/forensic/jobs/forensicOrchestrationQueue';

// Domain 7 Slice 7A.3 — orchestration worker host: builds sealed manifests off the
// domain7-forensic-orchestration queue, and periodically drains the forensic outbox
// (request_manifest_build writes an outbox row -> dispatcher enqueues -> manifest worker builds).

const flog: ForensicLogger = {
  info: (m, c) => pino.info(c ?? {}, m),
  warn: (m, c) => pino.warn(c ?? {}, m),
  error: (m, c) => pino.error(c ?? {}, m),
};

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: Number(process.env.FORENSIC_ORCH_PG_POOL_MAX ?? 5),
});

const bullQueue = new Queue<ManifestBuildJob>(FORENSIC_ORCHESTRATION_QUEUE, { connection: redisConnection });
const orchQueue = new ForensicOrchestrationQueue(bullQueue);

const workerInstanceId = process.env.FORENSIC_ORCH_WORKER_INSTANCE_ID ?? `forensic-orchestration-1`;
const builder = new ManifestBuilderService(pool, flog);
const processor = new ForensicManifestWorkerProcessor(builder, flog, workerInstanceId);
const worker = new Worker<ManifestBuildJob>(
  FORENSIC_ORCHESTRATION_QUEUE,
  (job) => processor.process(job),
  { connection: redisConnection, concurrency: Number(process.env.FORENSIC_ORCH_CONCURRENCY ?? 2) },
);
registerForensicWorkerEvents(worker, flog);

const dispatcher = new ForensicOutboxDispatcher(pool, orchQueue, flog);
const dispatchTimer = setInterval(() => {
  void dispatcher.dispatchBatch(50).catch((err) =>
    flog.error('forensic outbox dispatch tick failed', { error: err instanceof Error ? err.message : String(err) }),
  );
}, Number(process.env.FORENSIC_OUTBOX_DISPATCH_MS ?? 15000));

flog.info('forensic orchestration runtime started', { queue: FORENSIC_ORCHESTRATION_QUEUE, workerInstanceId });

async function shutdown(signal: string): Promise<void> {
  flog.info('forensic orchestration runtime shutting down', { signal });
  clearInterval(dispatchTimer);
  try {
    await worker.close();
    await bullQueue.close();
    await pool.end();
  } catch (err) {
    flog.error('forensic orchestration shutdown error', { error: err instanceof Error ? err.message : String(err) });
  } finally {
    process.exit(0);
  }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
