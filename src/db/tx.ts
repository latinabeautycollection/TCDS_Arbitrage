import { PoolClient } from 'pg';
import { pool } from './pool';

export async function withTx<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {
      // ignore rollback errors; original error is more important
    }
    throw error;
  } finally {
    client.release();
  }
}
