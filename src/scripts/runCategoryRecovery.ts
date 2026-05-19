import { Pool } from 'pg';
import { CategoryRecoveryWorker } from '../workers/categoryRecoveryWorker';

async function main(): Promise<void> {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: Number(process.env.PG_POOL_MAX ?? 4),
    statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS ?? 120000),
  });

  try {
    const worker = new CategoryRecoveryWorker(pool);
    await worker.execute();
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    level: 'error',
    msg: 'category recovery failed',
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    ts: new Date().toISOString(),
  })}\n`);
  process.exitCode = 1;
});
