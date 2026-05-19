import { Pool, PoolClient } from 'pg';
import 'dotenv/config';

// --- Safety guard: never let integration tests touch production ---
const PROD_HOST = process.env.PROD_DB_HOST ?? 'PROD_HOST_NOT_SET';
const testHost = process.env.TEST_PGHOST;

if (!testHost) {
  throw new Error(
    'TEST_PGHOST is not set. Refusing to run integration tests without explicit test DB config.',
  );
}
if (testHost === PROD_HOST || testHost === process.env.PGHOST) {
  throw new Error(
    `TEST_PGHOST (${testHost}) matches production host. Refusing to run integration tests against production.`,
  );
}

// --- Build a dedicated test pool (does NOT import production pool) ---
const testPool = new Pool({
  host: testHost,
  port: parseInt(process.env.TEST_PGPORT ?? '5432', 10),
  user: process.env.TEST_PGUSER,
  password: process.env.TEST_PGPASSWORD,
  database: process.env.TEST_PGDATABASE,
  ssl:
    (process.env.TEST_PGSSLMODE ?? 'require') === 'require'
      ? { rejectUnauthorized: false }
      : undefined,
  max: 4,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 5_000,
  application_name: 'arb-integration-tests',
});

// Re-export as `pool` so existing test imports of { pool } keep working
export { testPool as pool };

export async function getTestClient(): Promise<PoolClient> {
  return testPool.connect();
}

export async function resetTestSchema(): Promise<void> {
  await testPool.query(`truncate table
    arb.phase_summary_events,
    arb.product_journal,
    arb.db_mutation_ledger,
    arb.service_call_ledger,
    arb.entity_claim_ledger,
    arb.dead_letter,
    arb.replay_requests,
    arb.queue_idempotency,
    arb.learning_features,
    arb.pricing_evidence,
    arb.shipping_evidence,
    arb.listing_evidence,
    arb.forensic_events,
    arb.process_steps,
    arb.worker_heartbeats,
    arb.opportunity_queue
    restart identity cascade
  `);
}

// Integration tests import this — scoped to forensic-chain tables only
export async function resetForensicTables(): Promise<void> {
  await testPool.query(`truncate table
    arb.forensic_events,
    arb.queue_idempotency,
    arb.listing_evidence,
    arb.shipping_evidence,
    arb.pricing_evidence,
    arb.learning_features,
    arb.process_steps
    restart identity cascade
  `);
}

export async function withTestTx<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await testPool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('rollback');
    return result;
  } finally {
    client.release();
  }
}

export async function closeTestDb(): Promise<void> {
  await testPool.end();
}

export const TEST_SCHEMA = process.env.TEST_DB_RESET_SCHEMA ?? 'arb';
