import type {
  ActiveWatchlistStats,
  CandidateBacklogStats,
  DeadLetterStats,
  MarketIntelRunStats,
  OpportunityQueueStats,
  Prong2HealthRepositoryContract,
  WorkerHeartbeatRow,
} from '../repositories/prong2HealthRepository';

export interface WorkerReadinessRule {
  workerName: string;
  maxHeartbeatAgeSeconds: number;
  minHealthyInstances: number;
  requiredStatuses: string[];
}

export interface BacklogThresholds {
  maxPendingCandidates: number;
  maxOldestPendingCandidateAgeSeconds: number;
  maxRetryNeededCandidates: number;
  maxOldestRetryNeededAgeSeconds: number;
  maxQueuedOpportunities: number;
  maxOldestQueuedOpportunityAgeSeconds: number;
  maxReviewedOpportunities: number;
  maxOldestReviewedOpportunityAgeSeconds: number;
  maxDeadLettersLastHour: number;
  maxDeadLettersLast24h: number;
  maxRunningMarketIntelAgeSeconds: number;
  maxFailedMarketRunsLast24h: number;
  minActiveWatchlist: number;
}

export interface WorkerInstanceEvaluation {
  workerName: string;
  workerInstanceId: string;
  status: string;
  lastSeenAt: string;
  heartbeatAgeSeconds: number;
  stale: boolean;
  statusAccepted: boolean;
  healthy: boolean;
  detailsJson: Record<string, unknown>;
}

export interface WorkerGroupEvaluation {
  workerName: string;
  minHealthyInstances: number;
  maxHeartbeatAgeSeconds: number;
  requiredStatuses: string[];
  healthyInstanceCount: number;
  healthy: boolean;
  latestHeartbeatAt: string | null;
  instances: WorkerInstanceEvaluation[];
}

export interface BacklogEvaluation {
  healthy: boolean;
  failures: string[];
  candidateStats: CandidateBacklogStats;
  opportunityQueueStats: OpportunityQueueStats;
  deadLetterStats: DeadLetterStats;
  marketIntelRunStats: MarketIntelRunStats;
  activeWatchlistStats: ActiveWatchlistStats;
}

export interface ReadinessEvaluation {
  ok: boolean;
  checkedAt: string;
  databaseOk: boolean;
  workersHealthy: boolean;
  backlogHealthy: boolean;
  failures: string[];
  workerGroups: WorkerGroupEvaluation[];
  backlog: BacklogEvaluation;
}

type ReadinessRepository = Prong2HealthRepositoryContract;

export async function evaluateProng2Readiness(input: {
  repository: ReadinessRepository;
  workerRules: WorkerReadinessRule[];
  thresholds: BacklogThresholds;
  now?: Date;
}): Promise<ReadinessEvaluation> {
  const now = input.now ?? new Date();
  const checkedAt = now.toISOString();

  const databaseOk = await input.repository.checkDatabase();

  if (!databaseOk) {
    return {
      ok: false,
      checkedAt,
      databaseOk: false,
      workersHealthy: false,
      backlogHealthy: false,
      failures: ['database_unavailable'],
      workerGroups: [],
      backlog: {
        healthy: false,
        failures: ['database_unavailable'],
        candidateStats: {
          pendingCount: 0,
          retryNeededCount: 0,
          oldestPendingAgeSeconds: 0,
          oldestRetryNeededAgeSeconds: 0,
        },
        opportunityQueueStats: {
          queuedCount: 0,
          reviewedCount: 0,
          purchasedCount: 0,
          oldestQueuedAgeSeconds: 0,
          oldestReviewedAgeSeconds: 0,
        },
        deadLetterStats: {
          lastHourCount: 0,
          last24hCount: 0,
        },
        marketIntelRunStats: {
          runningCount: 0,
          oldestRunningAgeSeconds: 0,
          failedLast24hCount: 0,
        },
        activeWatchlistStats: {
          activeCount: 0,
        },
      },
    };
  }

  const [
    heartbeatRows,
    candidateStats,
    opportunityQueueStats,
    deadLetterStats,
    marketIntelRunStats,
    activeWatchlistStats,
  ] = await Promise.all([
    input.repository.getLatestWorkerHeartbeats(
      input.workerRules.map((rule) => rule.workerName),
    ),
    input.repository.getCandidateBacklogStats(),
    input.repository.getOpportunityQueueStats(),
    input.repository.getDeadLetterStats(),
    input.repository.getMarketIntelRunStats(),
    input.repository.getActiveWatchlistStats(),
  ]);

  const workerGroups = evaluateWorkers({
    rows: heartbeatRows,
    rules: input.workerRules,
    now,
  });

  const workerFailures = buildWorkerFailures(workerGroups);
  const workersHealthy = workerFailures.length === 0;

  const backlog = evaluateBacklog({
    thresholds: input.thresholds,
    candidateStats,
    opportunityQueueStats,
    deadLetterStats,
    marketIntelRunStats,
    activeWatchlistStats,
  });

  const failures = [...workerFailures, ...backlog.failures];

  return {
    ok: workersHealthy && backlog.healthy,
    checkedAt,
    databaseOk: true,
    workersHealthy,
    backlogHealthy: backlog.healthy,
    failures,
    workerGroups,
    backlog,
  };
}

function evaluateWorkers(input: {
  rows: WorkerHeartbeatRow[];
  rules: WorkerReadinessRule[];
  now: Date;
}): WorkerGroupEvaluation[] {
  const grouped = new Map<string, WorkerHeartbeatRow[]>();

  for (const row of input.rows) {
    const existing = grouped.get(row.workerName) ?? [];
    existing.push(row);
    grouped.set(row.workerName, existing);
  }

  return input.rules.map((rule) => {
    const rows = grouped.get(rule.workerName) ?? [];
    const instances = rows.map((row) => evaluateInstance(row, rule, input.now));
    const healthyInstanceCount = instances.filter((instance) => instance.healthy).length;
    const latestHeartbeatAt = getLatestHeartbeatAt(rows);

    return {
      workerName: rule.workerName,
      minHealthyInstances: rule.minHealthyInstances,
      maxHeartbeatAgeSeconds: rule.maxHeartbeatAgeSeconds,
      requiredStatuses: [...rule.requiredStatuses],
      healthyInstanceCount,
      healthy: healthyInstanceCount >= rule.minHealthyInstances,
      latestHeartbeatAt,
      instances,
    };
  });
}

function evaluateInstance(
  row: WorkerHeartbeatRow,
  rule: WorkerReadinessRule,
  now: Date,
): WorkerInstanceEvaluation {
  const heartbeatAgeSeconds = Math.max(
    0,
    Math.floor((now.getTime() - new Date(row.lastSeenAt).getTime()) / 1000),
  );

  const stale = heartbeatAgeSeconds > rule.maxHeartbeatAgeSeconds;
  const statusAccepted = rule.requiredStatuses.includes(row.status);
  const healthy = !stale && statusAccepted;

  return {
    workerName: row.workerName,
    workerInstanceId: row.workerInstanceId,
    status: row.status,
    lastSeenAt: row.lastSeenAt,
    heartbeatAgeSeconds,
    stale,
    statusAccepted,
    healthy,
    detailsJson: row.detailsJson ?? {},
  };
}

function getLatestHeartbeatAt(rows: WorkerHeartbeatRow[]): string | null {
  if (rows.length === 0) return null;

  let latest = rows[0]!.lastSeenAt;
  let latestTs = new Date(latest).getTime();

  for (const row of rows.slice(1)) {
    const ts = new Date(row.lastSeenAt).getTime();
    if (ts > latestTs) {
      latest = row.lastSeenAt;
      latestTs = ts;
    }
  }

  return latest;
}

function buildWorkerFailures(groups: WorkerGroupEvaluation[]): string[] {
  const failures: string[] = [];

  for (const group of groups) {
    if (group.healthy) continue;

    if (group.instances.length === 0) {
      failures.push(`${group.workerName}: no heartbeat found`);
      continue;
    }

    if (group.healthyInstanceCount === 0) {
      failures.push(`${group.workerName}: all instances stale or invalid status`);
      continue;
    }

    failures.push(
      `${group.workerName}: healthy instances ${group.healthyInstanceCount} below required minimum ${group.minHealthyInstances}`,
    );
  }

  return failures;
}

function evaluateBacklog(input: {
  thresholds: BacklogThresholds;
  candidateStats: CandidateBacklogStats;
  opportunityQueueStats: OpportunityQueueStats;
  deadLetterStats: DeadLetterStats;
  marketIntelRunStats: MarketIntelRunStats;
  activeWatchlistStats: ActiveWatchlistStats;
}): BacklogEvaluation {
  const failures: string[] = [];
  const t = input.thresholds;

  if (input.candidateStats.pendingCount > t.maxPendingCandidates) {
    failures.push(
      `candidate_backlog_pending_exceeded: ${input.candidateStats.pendingCount} > ${t.maxPendingCandidates}`,
    );
  }

  if (
    input.candidateStats.oldestPendingAgeSeconds >
    t.maxOldestPendingCandidateAgeSeconds
  ) {
    failures.push(
      `candidate_backlog_oldest_pending_age_exceeded: ${input.candidateStats.oldestPendingAgeSeconds} > ${t.maxOldestPendingCandidateAgeSeconds}`,
    );
  }

  if (input.candidateStats.retryNeededCount > t.maxRetryNeededCandidates) {
    failures.push(
      `candidate_retry_needed_exceeded: ${input.candidateStats.retryNeededCount} > ${t.maxRetryNeededCandidates}`,
    );
  }

  if (
    input.candidateStats.oldestRetryNeededAgeSeconds >
    t.maxOldestRetryNeededAgeSeconds
  ) {
    failures.push(
      `candidate_oldest_retry_needed_age_exceeded: ${input.candidateStats.oldestRetryNeededAgeSeconds} > ${t.maxOldestRetryNeededAgeSeconds}`,
    );
  }

  if (input.opportunityQueueStats.queuedCount > t.maxQueuedOpportunities) {
    failures.push(
      `opportunity_queue_queued_exceeded: ${input.opportunityQueueStats.queuedCount} > ${t.maxQueuedOpportunities}`,
    );
  }

  if (
    input.opportunityQueueStats.oldestQueuedAgeSeconds >
    t.maxOldestQueuedOpportunityAgeSeconds
  ) {
    failures.push(
      `opportunity_queue_oldest_queued_age_exceeded: ${input.opportunityQueueStats.oldestQueuedAgeSeconds} > ${t.maxOldestQueuedOpportunityAgeSeconds}`,
    );
  }

  if (input.opportunityQueueStats.reviewedCount > t.maxReviewedOpportunities) {
    failures.push(
      `opportunity_queue_reviewed_exceeded: ${input.opportunityQueueStats.reviewedCount} > ${t.maxReviewedOpportunities}`,
    );
  }

  if (
    input.opportunityQueueStats.oldestReviewedAgeSeconds >
    t.maxOldestReviewedOpportunityAgeSeconds
  ) {
    failures.push(
      `opportunity_queue_oldest_reviewed_age_exceeded: ${input.opportunityQueueStats.oldestReviewedAgeSeconds} > ${t.maxOldestReviewedOpportunityAgeSeconds}`,
    );
  }

  if (input.deadLetterStats.lastHourCount > t.maxDeadLettersLastHour) {
    failures.push(
      `dead_letters_last_hour_exceeded: ${input.deadLetterStats.lastHourCount} > ${t.maxDeadLettersLastHour}`,
    );
  }

  if (input.deadLetterStats.last24hCount > t.maxDeadLettersLast24h) {
    failures.push(
      `dead_letters_last_24h_exceeded: ${input.deadLetterStats.last24hCount} > ${t.maxDeadLettersLast24h}`,
    );
  }

  if (
    input.marketIntelRunStats.runningCount > 0 &&
    input.marketIntelRunStats.oldestRunningAgeSeconds >
      t.maxRunningMarketIntelAgeSeconds
  ) {
    failures.push(
      `market_intel_oldest_running_age_exceeded: ${input.marketIntelRunStats.oldestRunningAgeSeconds} > ${t.maxRunningMarketIntelAgeSeconds}`,
    );
  }

  if (
    input.marketIntelRunStats.failedLast24hCount >
    t.maxFailedMarketRunsLast24h
  ) {
    failures.push(
      `market_intel_failed_last_24h_exceeded: ${input.marketIntelRunStats.failedLast24hCount} > ${t.maxFailedMarketRunsLast24h}`,
    );
  }

  if (input.activeWatchlistStats.activeCount < t.minActiveWatchlist) {
    failures.push(
      `active_watchlist_below_minimum: ${input.activeWatchlistStats.activeCount} < ${t.minActiveWatchlist}`,
    );
  }

  return {
    healthy: failures.length === 0,
    failures,
    candidateStats: input.candidateStats,
    opportunityQueueStats: input.opportunityQueueStats,
    deadLetterStats: input.deadLetterStats,
    marketIntelRunStats: input.marketIntelRunStats,
    activeWatchlistStats: input.activeWatchlistStats,
  };
}
