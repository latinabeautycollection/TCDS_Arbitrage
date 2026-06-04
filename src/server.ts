import express from 'express';
import { Pool } from 'pg';
import { env } from './config/env';
import healthRoutes from './routes/health';
import ebayAuthRoutes from './routes/ebayAuth';
import upsAuthRoutes from './routes/upsAuth';
import shipengineWebhookRoutes from './routes/shipengineWebhooks';
import ebayProbeRoutes from './routes/ebayProbe';
import { createProng2HealthRouter } from './routes/prong2HealthRoutes';
import { createLogger, serializeError } from './services/logger';
import { JobStore } from './services/jobStore';
import { HealthService } from './services/healthService';
import { MetricsService } from './services/metricsService';
import { createMetricsRouter } from './routes/metrics';

const logger = createLogger({
  serviceName: process.env.APP_SERVICE_NAME ?? 'arb-system-api',
  staticBindings: { component: 'server' },
});

const pool = new Pool({
  connectionString: requiredEnv('DATABASE_URL'),
  max: intEnv('PG_POOL_MAX', 10),
  idleTimeoutMillis: intEnv('PG_IDLE_TIMEOUT_MS', 30000),
  connectionTimeoutMillis: intEnv('PG_CONNECTION_TIMEOUT_MS', 10000),
  statement_timeout: intEnv('PG_STATEMENT_TIMEOUT_MS', 30000),
  query_timeout: intEnv('PG_QUERY_TIMEOUT_MS', 30000),
  application_name: `${process.env.APP_SERVICE_NAME ?? 'arb-system-api'}:server`,
  ssl: boolEnv('PG_SSL_ENABLED', true) ? { rejectUnauthorized: false } : false,
} as Record<string, unknown>);

const jobStore = new JobStore(pool);

const healthService = new HealthService(jobStore, logger, {
  compWorkerFreshnessSeconds: intEnv('HEALTH_COMP_WORKER_FRESHNESS_SECONDS', 120),
  retryWorkerFreshnessSeconds: intEnv('HEALTH_RETRY_WORKER_FRESHNESS_SECONDS', 180),
  backlogWarnThreshold: intEnv('HEALTH_BACKLOG_WARN_THRESHOLD', 50),
  backlogFailThreshold: intEnv('HEALTH_BACKLOG_FAIL_THRESHOLD', 250),
  deadLetterWarnThreshold: intEnv('HEALTH_DEAD_LETTER_WARN_THRESHOLD', 10),
  deadLetterFailThreshold: intEnv('HEALTH_DEAD_LETTER_FAIL_THRESHOLD', 50),
  staleProcessingMinutes: intEnv('HEALTH_STALE_PROCESSING_MINUTES', 120),
});

const metricsService = new MetricsService(jobStore, logger, {
  staleProcessingMinutes: intEnv('HEALTH_STALE_PROCESSING_MINUTES', 120),
});

const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

app.get('/health', async (_req, res) => {
  try {
    const snapshot = await healthService.buildHealthSnapshot();
    res.status(snapshot.overallStatus === 'fail' ? 503 : 200).json({
      status: snapshot.overallStatus,
      service: process.env.APP_SERVICE_NAME ?? 'arb-system-api',
      version: process.env.APP_VERSION ?? 'unknown',
      environment: process.env.NODE_ENV ?? 'development',
      generatedAt: snapshot.generatedAt,
      checks: snapshot.checks,
    });
  } catch (error) {
    logger.error('health endpoint failed', {
      operation: 'GET /health',
      error: serializeError(error),
    });

    res.status(503).json({
      status: 'fail',
      service: process.env.APP_SERVICE_NAME ?? 'arb-system-api',
      version: process.env.APP_VERSION ?? 'unknown',
      environment: process.env.NODE_ENV ?? 'development',
      generatedAt: new Date().toISOString(),
      error: 'health_check_failed',
    });
  }
});

app.get('/ready', async (_req, res) => {
  try {
    const snapshot = await healthService.buildReadinessSnapshot();

    res.status(snapshot.ready ? 200 : 503).json({
      ready: snapshot.ready,
      service: process.env.APP_SERVICE_NAME ?? 'arb-system-api',
      version: process.env.APP_VERSION ?? 'unknown',
      environment: process.env.NODE_ENV ?? 'development',
      generatedAt: snapshot.generatedAt,
      checks: snapshot.checks,
    });
  } catch (error) {
    logger.error('ready endpoint failed', {
      operation: 'GET /ready',
      error: serializeError(error),
    });

    res.status(503).json({
      ready: false,
      service: process.env.APP_SERVICE_NAME ?? 'arb-system-api',
      version: process.env.APP_VERSION ?? 'unknown',
      environment: process.env.NODE_ENV ?? 'development',
      generatedAt: new Date().toISOString(),
      error: 'readiness_check_failed',
    });
  }
});

/**
 * ============================================================================
 * API Route Mounts — Final Production Layout
 * ----------------------------------------------------------------------------
 * Ownership / intent:
 *   - Root-level /health, /ready, /metrics remain owned by Prong 1
 *   - Prong 2 health/readiness/metrics are isolated under /prong2
 *
 * This prevents route collisions between:
 *   - Prong 1 preflight probes
 *   - Prong 2 worker/readiness probes
 *
 * Resulting endpoint layout:
 *   Prong 1:
 *     GET /health
 *     GET /ready
 *     GET /metrics
 *
 *   Prong 2:
 *     GET /prong2/health
 *     GET /prong2/ready
 *     GET /prong2/metrics
 * ============================================================================
 */

function mountApiRoutes(input: {
  app: import('express').Express;
  pool: Pool;
  metricsService: typeof metricsService;
  logger: typeof logger;
}): void {
  const { app, pool, metricsService, logger } = input;

  // --------------------------------------------------------------------------
  // Prong 1 — Root-owned system metrics and API health surfaces
  // --------------------------------------------------------------------------
  app.use(createMetricsRouter({ metricsService, logger }));
  app.use(healthRoutes);
  app.use(ebayAuthRoutes);
  app.use(upsAuthRoutes);
  app.use(shipengineWebhookRoutes);
  app.use(ebayProbeRoutes);

  // --------------------------------------------------------------------------
  // Prong 2 — Namespaced worker/readiness/metrics surfaces
  // Must remain mounted under /prong2 so root health endpoints do not collide
  // with the Prong 2 readiness/metrics router.
  // --------------------------------------------------------------------------
  app.use('/prong2', createProng2HealthRouter({ pool }));
}

mountApiRoutes({
  app,
  pool,
  metricsService,
  logger,
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('unhandled express error', {
    operation: 'expressErrorHandler',
    error: serializeError(err),
  });

  res.status(500).json({
    ok: false,
    error: err instanceof Error ? err.message : 'Internal server error',
  });
});

const host = '127.0.0.1';
const port = env.PORT;
const server = app.listen(port, host, () => {
  logger.info('arb-api running', {
    operation: 'listen',
    host,
    port,
  });
});

async function shutdown(signal: string): Promise<void> {
  logger.warn('shutdown requested', { operation: 'shutdown', signal });

  server.close(async (closeErr) => {
    if (closeErr) {
      logger.error('server close error', {
        operation: 'shutdown',
        error: serializeError(closeErr),
      });
      process.exit(1);
      return;
    }

    try {
      await pool.end();
      logger.info('shutdown complete', { operation: 'shutdown' });
      process.exit(0);
    } catch (poolErr) {
      logger.error('pool close error', {
        operation: 'shutdown',
        error: serializeError(poolErr),
      });
      process.exit(1);
    }
  });

  setTimeout(() => {
    logger.error('forced shutdown due to timeout', { operation: 'shutdown' });
    process.exit(1);
  }, 15_000).unref();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}
