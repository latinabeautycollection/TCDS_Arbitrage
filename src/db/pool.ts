import { Pool, PoolConfig } from 'pg';
import { env } from '../config/env';
import { logger } from '../lib/logger';

const ssl =
  env.PGSSLMODE === 'require'
    ? { rejectUnauthorized: false }
    : undefined;

const config: PoolConfig = {
  host: env.PGHOST,
  port: env.PGPORT,
  database: env.PGDATABASE,
  user: env.PGUSER,
  password: env.PGPASSWORD,
  ssl,
  max: env.PG_POOL_MAX,
  idleTimeoutMillis: env.PG_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: env.PG_CONNECTION_TIMEOUT_MS,
  application_name: env.APP_NAME
};

export const pool = new Pool(config);

pool.on('connect', () => {
  logger.debug('postgres pool client connected');
});

pool.on('error', (err) => {
  logger.error({ err }, 'postgres pool error');
});

export async function healthcheckDb() {
  const start = Date.now();
  const result = await pool.query('select 1 as ok');
  return {
    ok: result.rows[0]?.ok === 1,
    latencyMs: Date.now() - start
  };
}
