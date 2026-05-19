import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),

  APP_NAME: z.string().default('arb-system'),
  APP_VERSION: z.string().default('1.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  PGHOST: z.string().min(1),
  PGPORT: z.coerce.number().int().positive().default(5432),
  PGDATABASE: z.string().min(1),
  PGUSER: z.string().min(1),
  PGPASSWORD: z.string().min(1),
  PGSSLMODE: z.enum(['disable', 'require']).default('disable'),
  PG_POOL_MAX: z.coerce.number().int().positive().default(20),
  PG_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  PG_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),

  REDIS_HOST: z.string().min(1),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.coerce.number().int().min(0).default(0),
  BULLMQ_PREFIX: z.string().default('arb'),

  WORKER_CONCURRENCY_DEFAULT: z.coerce.number().int().positive().default(5),
  WORKER_LOCK_DURATION_MS: z.coerce.number().int().positive().default(120000),
  WORKER_STALLED_INTERVAL_MS: z.coerce.number().int().positive().default(30000),
  WORKER_MAX_STALLED_COUNT: z.coerce.number().int().positive().default(2),

  PRECHECK_STALE_CANDIDATE_CLAIM_MINUTES: z.coerce.number().int().positive().default(15),
  PRECHECK_STALE_MARKET_CLAIM_MINUTES: z.coerce.number().int().positive().default(15),
  PRECHECK_STALE_JOB_LOCK_MINUTES: z.coerce.number().int().positive().default(15),
  PRECHECK_STALE_PROCESS_STEP_CLAIM_MINUTES: z.coerce.number().int().positive().default(15),
  PRECHECK_STALE_WORKER_HEARTBEAT_MINUTES: z.coerce.number().int().positive().default(5),
  PRECHECK_RECENT_FAILED_RUN_HOURS: z.coerce.number().int().positive().default(24),

  TEST_DB_RESET_SCHEMA: z.string().default('arb'),
  TEST_REDIS_PREFIX: z.string().default('arb-test'),    PORT: z.coerce.number().int().positive().default(3101),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  APP_BASE_URL: z.string().url(),
  EBAY_ACCEPTED_URL: z.string().url(),
  EBAY_DECLINED_URL: z.string().url(),

  EBAY_PROD_CLIENT_ID: z.string().min(1),
  EBAY_PROD_CLIENT_SECRET: z.string().min(1),
  EBAY_PROD_RUNAME: z.string().min(1),
  EBAY_PROD_AUTH_URL: z.string().url(),
  EBAY_PROD_TOKEN_URL: z.string().url(),
  EBAY_PROD_BASE_URL: z.string().url(),
  EBAY_PROD_SCOPES: z.string().min(1),

  EBAY_SANDBOX_CLIENT_ID: z.string().min(1),
  EBAY_SANDBOX_CLIENT_SECRET: z.string().min(1),
  EBAY_SANDBOX_RUNAME: z.string().min(1),
  EBAY_SANDBOX_AUTH_URL: z.string().url(),
  EBAY_SANDBOX_TOKEN_URL: z.string().url(),
  EBAY_SANDBOX_BASE_URL: z.string().url(),
  EBAY_SANDBOX_SCOPES: z.string().min(1),

  EBAY_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  EBAY_MAX_RETRIES: z.coerce.number().int().positive().default(3),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const formatted = parsed.error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${formatted}`);
}

export const env = parsed.data;
export type Env = typeof env;
