import 'dotenv/config';
import { Pool } from 'pg';
import type { RedisOptions } from 'ioredis';
import { env } from '../config/env';
import { createLogger } from '../services/logger';
import { loadForensicStorageEnv } from '../domains/forensic/config/forensicStorageEnv';
import { CloudflareR2Provider } from '../domains/forensic/providers/cloudflareR2Provider';
import { ClamAvScanner } from '../domains/forensic/providers/clamAvScanner';
import { ForensicStorageRepository } from '../domains/forensic/repositories/forensicStorageRepository';
import { ArtifactVerificationService } from '../domains/forensic/services/artifactVerificationService';
import { createForensicStorageWorker } from '../domains/forensic/workers/forensicStorageWorker';

// Domain 7 Slice 7A.2 — runnable bootstrap for the forensic storage worker.
// The package ships factories/classes only; this composes them against the repo's
// real Pool/logger/Redis. pm2 runs the compiled dist/workers/forensicStorageWorker.js.

const logger = createLogger({
  serviceName: 'forensic-storage-worker',
  staticBindings: { component: 'worker' },
});

// Fails fast in production if the malware scanner is not real (by design).
const fenv = loadForensicStorageEnv();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: Number(process.env.FORENSIC_WORKER_PG_POOL_MAX ?? 5),
});

const repo = new ForensicStorageRepository(pool);
const storage = new CloudflareR2Provider(fenv.R2_ACCOUNT_ID, fenv.R2_ACCESS_KEY_ID, fenv.R2_SECRET_ACCESS_KEY);
const scanner = new ClamAvScanner(fenv.CLAMAV_HOST, fenv.CLAMAV_PORT);
const verification = new ArtifactVerificationService(
  repo,
  storage,
  scanner,
  fenv.FORENSIC_VERIFICATION_CLAIM_SECONDS,
  fenv.FORENSIC_QUARANTINE_PREFIX,
);

const connection: RedisOptions = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
};

const worker = createForensicStorageWorker({
  connection,
  verification,
  concurrency: Number(process.env.FORENSIC_WORKER_CONCURRENCY ?? 1),
});

worker.on('ready', () => logger.info('forensic storage worker ready', { queue: 'domain7-forensic-storage', scanner: fenv.MALWARE_SCANNER_MODE }));
worker.on('error', (err) => logger.error('forensic storage worker error', { error: err instanceof Error ? err.message : String(err) }));
worker.on('failed', (job, err) => logger.error('forensic storage job failed', { jobId: job?.id, error: err instanceof Error ? err.message : String(err) }));

async function shutdown(signal: string): Promise<void> {
  logger.info('forensic storage worker shutting down', { signal });
  try {
    await worker.close();
    await pool.end();
  } catch (err) {
    logger.error('forensic storage worker shutdown error', { error: err instanceof Error ? err.message : String(err) });
  } finally {
    process.exit(0);
  }
}
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });

logger.info('forensic storage worker started', { queue: 'domain7-forensic-storage', concurrency: Number(process.env.FORENSIC_WORKER_CONCURRENCY ?? 1) });
