import { Router, type Request, type Response } from 'express';
import type { Pool } from 'pg';
import { Prong2HealthRepository } from '../repositories/prong2HealthRepository';
import {
  evaluateProng2Readiness,
  type BacklogThresholds,
  type WorkerReadinessRule,
} from '../services/prong2Readiness';

export function createProng2HealthRouter(input: { pool: Pool }): Router {
  const router = Router();
  const repository = new Prong2HealthRepository(input.pool);

  const workerRules: WorkerReadinessRule[] = [
    {
      workerName:
        process.env.MARKET_INTEL_WORKER_NAME?.trim() || 'market-intel-worker',
      maxHeartbeatAgeSeconds: intEnv(
        'MARKET_INTEL_WORKER_MAX_HEARTBEAT_AGE_SECONDS',
        180,
      ),
      minHealthyInstances: intEnv(
        'MARKET_INTEL_WORKER_MIN_HEALTHY_INSTANCES',
        1,
      ),
      requiredStatuses: ['running', 'processing'],
    },
    {
      workerName: process.env.WATCHLIST_WORKER_NAME?.trim() || 'watchlist-worker',
      maxHeartbeatAgeSeconds: intEnv(
        'WATCHLIST_WORKER_MAX_HEARTBEAT_AGE_SECONDS',
        180,
      ),
      minHealthyInstances: intEnv(
        'WATCHLIST_WORKER_MIN_HEALTHY_INSTANCES',
        1,
      ),
      requiredStatuses: ['running', 'processing'],
    },
    {
      workerName:
        process.env.OPPORTUNITY_QUEUE_WORKER_NAME?.trim() ||
        'opportunity-queue-worker',
      maxHeartbeatAgeSeconds: intEnv(
        'OPPORTUNITY_QUEUE_WORKER_MAX_HEARTBEAT_AGE_SECONDS',
        180,
      ),
      minHealthyInstances: intEnv(
        'OPPORTUNITY_QUEUE_WORKER_MIN_HEALTHY_INSTANCES',
        1,
      ),
      requiredStatuses: ['running', 'processing'],
    },
  ];

  const thresholds: BacklogThresholds = {
    maxPendingCandidates: intEnv('PRONG2_MAX_PENDING_CANDIDATES', 5000),
    maxOldestPendingCandidateAgeSeconds: intEnv(
      'PRONG2_MAX_OLDEST_PENDING_CANDIDATE_AGE_SECONDS',
      1800,
    ),
    maxRetryNeededCandidates: intEnv('PRONG2_MAX_RETRY_NEEDED_CANDIDATES', 500),
    maxOldestRetryNeededAgeSeconds: intEnv(
      'PRONG2_MAX_OLDEST_RETRY_NEEDED_AGE_SECONDS',
      3600,
    ),
    maxQueuedOpportunities: intEnv('PRONG2_MAX_QUEUED_OPPORTUNITIES', 2000),
    maxOldestQueuedOpportunityAgeSeconds: intEnv(
      'PRONG2_MAX_OLDEST_QUEUED_OPPORTUNITY_AGE_SECONDS',
      3600,
    ),
    maxReviewedOpportunities: intEnv('PRONG2_MAX_REVIEWED_OPPORTUNITIES', 1000),
    maxOldestReviewedOpportunityAgeSeconds: intEnv(
      'PRONG2_MAX_OLDEST_REVIEWED_OPPORTUNITY_AGE_SECONDS',
      7200,
    ),
    maxDeadLettersLastHour: intEnv('PRONG2_MAX_DEAD_LETTERS_LAST_HOUR', 50),
    maxDeadLettersLast24h: intEnv('PRONG2_MAX_DEAD_LETTERS_LAST_24H', 500),
    maxRunningMarketIntelAgeSeconds: intEnv(
      'PRONG2_MAX_RUNNING_MARKET_INTEL_AGE_SECONDS',
      1800,
    ),
    maxFailedMarketRunsLast24h: intEnv(
      'PRONG2_MAX_FAILED_MARKET_RUNS_LAST_24H',
      100,
    ),
    minActiveWatchlist: intEnv('PRONG2_MIN_ACTIVE_WATCHLIST', 1),
  };

  router.get('/health', async (_req: Request, res: Response) => {
    return res.status(200).json({
      ok: true,
      service: 'arb-system-api',
      timestamp: new Date().toISOString(),
    });
  });

  router.get('/ready', async (_req: Request, res: Response) => {
    try {
      const result = await evaluateProng2Readiness({
        repository,
        workerRules,
        thresholds,
      });

      return res.status(result.ok ? 200 : 503).json(result);
    } catch (error) {
      return res.status(503).json({
        ok: false,
        checkedAt: new Date().toISOString(),
        databaseOk: false,
        workersHealthy: false,
        backlogHealthy: false,
        failures: [
          error instanceof Error ? error.message : 'readiness_evaluation_failed',
        ],
        workerGroups: [],
        backlog: null,
      });
    }
  });

  router.get('/metrics', async (_req: Request, res: Response) => {
    try {
      const result = await evaluateProng2Readiness({
        repository,
        workerRules,
        thresholds,
      });

      const metrics = renderPrometheusMetrics(result);

      res.setHeader(
        'Content-Type',
        'text/plain; version=0.0.4; charset=utf-8',
      );
      return res.status(200).send(metrics);
    } catch (_error) {
      const fallback = [
        '# TYPE prong2_metrics_scrape_error gauge',
        'prong2_metrics_scrape_error 1',
      ].join('\n');

      res.setHeader(
        'Content-Type',
        'text/plain; version=0.0.4; charset=utf-8',
      );
      return res.status(200).send(`${fallback}\n`);
    }
  });

  return router;
}

function renderPrometheusMetrics(
  result: Awaited<ReturnType<typeof evaluateProng2Readiness>>,
): string {
  const lines: string[] = [];

  pushGauge(lines, 'prong2_system_ready', result.ok ? 1 : 0);
  pushGauge(lines, 'prong2_database_ready', result.databaseOk ? 1 : 0);
  pushGauge(lines, 'prong2_workers_ready', result.workersHealthy ? 1 : 0);
  pushGauge(lines, 'prong2_backlog_ready', result.backlogHealthy ? 1 : 0);
  pushGauge(lines, 'prong2_readiness_failures_count', result.failures.length);

  for (const group of result.workerGroups) {
    const worker = normalizeMetricName(group.workerName);

    pushGauge(
      lines,
      `prong2_worker_required_instances_${worker}`,
      group.minHealthyInstances,
    );
    pushGauge(
      lines,
      `prong2_worker_healthy_instances_${worker}`,
      group.healthyInstanceCount,
    );
    pushGauge(
      lines,
      `prong2_worker_group_healthy_${worker}`,
      group.healthy ? 1 : 0,
    );

    for (const instance of group.instances) {
      const key = `${worker}_${normalizeMetricName(instance.workerInstanceId)}`;

      pushGauge(
        lines,
        `prong2_worker_instance_healthy_${key}`,
        instance.healthy ? 1 : 0,
      );
      pushGauge(
        lines,
        `prong2_worker_instance_stale_${key}`,
        instance.stale ? 1 : 0,
      );
      pushGauge(
        lines,
        `prong2_worker_instance_status_accepted_${key}`,
        instance.statusAccepted ? 1 : 0,
      );
      pushGauge(
        lines,
        `prong2_worker_instance_heartbeat_age_seconds_${key}`,
        instance.heartbeatAgeSeconds,
      );
    }
  }

  pushGauge(
    lines,
    'prong2_candidates_pending_count',
    result.backlog.candidateStats.pendingCount,
  );
  pushGauge(
    lines,
    'prong2_candidates_retry_needed_count',
    result.backlog.candidateStats.retryNeededCount,
  );
  pushGauge(
    lines,
    'prong2_candidates_oldest_pending_age_seconds',
    result.backlog.candidateStats.oldestPendingAgeSeconds,
  );
  pushGauge(
    lines,
    'prong2_candidates_oldest_retry_needed_age_seconds',
    result.backlog.candidateStats.oldestRetryNeededAgeSeconds,
  );

  pushGauge(
    lines,
    'prong2_opportunity_queue_queued_count',
    result.backlog.opportunityQueueStats.queuedCount,
  );
  pushGauge(
    lines,
    'prong2_opportunity_queue_reviewed_count',
    result.backlog.opportunityQueueStats.reviewedCount,
  );
  pushGauge(
    lines,
    'prong2_opportunity_queue_purchased_count',
    result.backlog.opportunityQueueStats.purchasedCount,
  );
  pushGauge(
    lines,
    'prong2_opportunity_queue_oldest_queued_age_seconds',
    result.backlog.opportunityQueueStats.oldestQueuedAgeSeconds,
  );
  pushGauge(
    lines,
    'prong2_opportunity_queue_oldest_reviewed_age_seconds',
    result.backlog.opportunityQueueStats.oldestReviewedAgeSeconds,
  );

  pushGauge(
    lines,
    'prong2_dead_letters_last_hour_count',
    result.backlog.deadLetterStats.lastHourCount,
  );
  pushGauge(
    lines,
    'prong2_dead_letters_last_24h_count',
    result.backlog.deadLetterStats.last24hCount,
  );

  pushGauge(
    lines,
    'prong2_market_intel_running_count',
    result.backlog.marketIntelRunStats.runningCount,
  );
  pushGauge(
    lines,
    'prong2_market_intel_oldest_running_age_seconds',
    result.backlog.marketIntelRunStats.oldestRunningAgeSeconds,
  );
  pushGauge(
    lines,
    'prong2_market_intel_failed_last_24h_count',
    result.backlog.marketIntelRunStats.failedLast24hCount,
  );

  pushGauge(
    lines,
    'prong2_active_watchlist_count',
    result.backlog.activeWatchlistStats.activeCount,
  );

  return `${lines.join('\n')}\n`;
}

function pushGauge(lines: string[], name: string, value: number): void {
  lines.push(`# TYPE ${name} gauge`);
  lines.push(`${name} ${Number.isFinite(value) ? value : 0}`);
}

function normalizeMetricName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
