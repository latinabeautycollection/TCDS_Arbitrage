import { Pool } from 'pg';
import { CategoryRecoveryRepository } from '../repositories/categoryRecoveryRepository';

async function main(): Promise<void> {
  const processRunId = process.argv[2];
  if (!processRunId) {
    throw new Error('Usage: node dist/scripts/rollbackCategoryRecovery.js <process_run_id>');
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2, ssl: { rejectUnauthorized: false } });
  const repo = new CategoryRecoveryRepository();
  const actorId = `category-recovery-rollback-${processRunId}`;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await repo.rollbackRecovery(client, processRunId, actorId, 'categoryRecoveryWorker');
    await client.query('COMMIT');
    process.stdout.write(`${JSON.stringify({
      level: 'info',
      msg: 'category recovery rollback completed',
      processRunId,
      rolledBackItems: result.rolled_back_items,
      ts: new Date().toISOString(),
    })}\n`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    level: 'error',
    msg: 'category recovery rollback failed',
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    ts: new Date().toISOString(),
  })}\n`);
  process.exitCode = 1;
});
