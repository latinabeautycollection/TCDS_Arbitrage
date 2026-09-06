import fs from 'node:fs';
import { Pool, type PoolConfig } from 'pg';

export function buildDomain11lPoolConfig(applicationName: string): PoolConfig {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');

  const production =
    process.env.NODE_ENV === 'production' ||
    process.env.DOMAIN11L_CERTIFICATION_MODE === '1';
  const sslEnabled = process.env.PG_SSL_ENABLED !== 'false';

  if (production && !sslEnabled) {
    throw new Error('DOMAIN11L_DATABASE_TLS_REQUIRED');
  }

  let ssl: PoolConfig['ssl'] = false;
  if (sslEnabled) {
    const caFile = process.env.PG_SSL_CA_FILE?.trim();
    if (!caFile) {
      throw new Error('DOMAIN11L_DATABASE_TRUST_CA_REQUIRED');
    }
    const ca = fs.readFileSync(caFile, 'utf8');
    ssl = { ca, rejectUnauthorized: true };
  }

  return {
    connectionString,
    max: Number(process.env.DOMAIN11L_VALIDITY_POOL_MAX ?? 2),
    application_name: applicationName,
    ssl,
  };
}

export function createDomain11lPool(applicationName: string): Pool {
  return new Pool(buildDomain11lPoolConfig(applicationName));
}
