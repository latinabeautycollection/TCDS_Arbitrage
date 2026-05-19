import type { Prong2HealthRepository } from '../repositories/prong2HealthRepository';
import { evaluateProng2Readiness, type BacklogThresholds, type WorkerReadinessRule } from './prong2Readiness';

export async function collectProng2Metrics(input: {
  repository: Prong2HealthRepository;
  workerRules: WorkerReadinessRule[];
  thresholds: BacklogThresholds;
}): Promise<string> {
  const evaluation = await evaluateProng2Readiness({
    repository: input.repository,
    workerRules: input.workerRules,
    thresholds: input.thresholds,
  });

  const lines: string[] = [];

  pushGauge(lines, 'prong2_database_ready', evaluation.databaseOk ? 1 : 0);
  pushGauge(lines, 'prong2_workers_ready', evaluation.workersHealthy ? 1 : 0);
  pushGauge(lines, 'prong2_backlog_ready', evaluation.backlogHealthy ? 1 : 0);
  pushGauge(lines, 'prong2_system_ready', evaluation.ok ? 1 : 0);

  for (const group of evaluation.workerGroups) {
    const worker = normalize(group.workerName);

    pushGauge(lines, `prong2_worker_required_instances_${worker}`, group.minHealthyInstances);
    pushGauge(lines, `prong2_worker_healthy_instances_${worker}`, group.healthyInstanceCount);
    pushGauge(lines, `prong2_worker_group_healthy_${worker}`, group.healthy ? 1 : 0);

    for (const instance of group.instances) {
      const key = `${worker}_${normalize(instance.workerInstanceId)}`;
      pushGauge(lines, `prong2_worker_instance_healthy_${key}`, instance.healthy ? 1 : 0);
      pushGauge(lines, `prong2_worker_instance_stale_${key}`, instance.stale ? 1 : 0);
      pushGauge(lines, `prong2_worker_instance_status_accepted_${key}`, instance.statusAccepted ? 1 : 0);
      pushGauge(lines, `prong2_worker_instance_heartbeat_age_seconds_${key}`, instance.heartbeatAgeSeconds);
    }
  }

  pushGauge(lines, 'prong2_candidates_pending_count', evaluation.backlog.candidateStats.pendingCount);
  pushGauge(lines, 'prong2_candidates_retry_needed_count', evaluation.backlog.candidateStats.retryNeededCount);
  pushGauge(lines, 'prong2_candidates_oldest_pending_age_seconds', evaluation.backlog.candidateStats.oldestPendingAgeSeconds);
  pushGauge(lines, 'prong2_candidates_oldest_retry_needed_age_seconds', evaluation.backlog.candidateStats.oldestRetryNeededAgeSeconds);

  pushGauge(lines, 'prong2_opportunity_queue_queued_count', evaluation.backlog.opportunityQueueStats.queuedCount);
  pushGauge(lines, 'prong2_opportunity_queue_reviewed_count', evaluation.backlog.opportunityQueueStats.reviewedCount);
  pushGauge(lines, 'prong2_opportunity_queue_purchased_count', evaluation.backlog.opportunityQueueStats.purchasedCount);
  pushGauge(lines, 'prong2_opportunity_queue_oldest_queued_age_seconds', evaluation.backlog.opportunityQueueStats.oldestQueuedAgeSeconds);
  pushGauge(lines, 'prong2_opportunity_queue_oldest_reviewed_age_seconds', evaluation.backlog.opportunityQueueStats.oldestReviewedAgeSeconds);

  pushGauge(lines, 'prong2_dead_letters_last_hour_count', evaluation.backlog.deadLetterStats.lastHourCount);
  pushGauge(lines, 'prong2_dead_letters_last_24h_count', evaluation.backlog.deadLetterStats.last24hCount);

  pushGauge(lines, 'prong2_market_intel_running_count', evaluation.backlog.marketIntelRunStats.runningCount);
  pushGauge(lines, 'prong2_market_intel_oldest_running_age_seconds', evaluation.backlog.marketIntelRunStats.oldestRunningAgeSeconds);
  pushGauge(lines, 'prong2_market_intel_failed_last_24h_count', evaluation.backlog.marketIntelRunStats.failedLast24hCount);

  pushGauge(lines, 'prong2_active_watchlist_count', evaluation.backlog.activeWatchlistStats.activeCount);

  pushGauge(lines, 'prong2_readiness_failures_count', evaluation.failures.length);

  return `${lines.join('\n')}\n`;
}

function pushGauge(lines: string[], name: string, value: number): void {
  lines.push(`# TYPE ${name} gauge`);
  lines.push(`${name} ${Number.isFinite(value) ? value : 0}`);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}
