import type { Logger } from './logger';
import { JobStore, type BacklogCounts, type WorkerHeartbeatRow } from './jobStore';

export interface HealthConfig {
  compWorkerFreshnessSeconds: number;
  retryWorkerFreshnessSeconds: number;
  backlogWarnThreshold: number;
  backlogFailThreshold: number;
  deadLetterWarnThreshold: number;
  deadLetterFailThreshold: number;
  staleProcessingMinutes: number;
}

export interface DependencyStatus {
  ok: boolean;
  status: 'ok' | 'degraded' | 'fail';
  details: Record<string, unknown>;
}

export interface HealthSnapshot {
  overallStatus: 'ok' | 'degraded' | 'fail';
  checks: {
    database: DependencyStatus;
    workers: DependencyStatus;
    backlog: DependencyStatus;
    deadLetter: DependencyStatus;
    staleProcessing: DependencyStatus;
  };
  generatedAt: string;
}

export class HealthService {
  constructor(
    private readonly jobStore: JobStore,
    private readonly logger: Logger,
    private readonly config: HealthConfig,
  ) {}

  async buildHealthSnapshot(): Promise<HealthSnapshot> {
    const [database, workers, backlog, deadLetter, staleProcessing] = await Promise.all([
      this.checkDatabase(),
      this.checkWorkers(),
      this.checkBacklog(),
      this.checkDeadLetter(),
      this.checkStaleProcessing(),
    ]);

    const statuses = [
      database.status,
      workers.status,
      backlog.status,
      deadLetter.status,
      staleProcessing.status,
    ];

    const overallStatus: HealthSnapshot['overallStatus'] =
      statuses.includes('fail')
        ? 'fail'
        : statuses.includes('degraded')
          ? 'degraded'
          : 'ok';

    const snapshot: HealthSnapshot = {
      overallStatus,
      checks: {
        database,
        workers,
        backlog,
        deadLetter,
        staleProcessing,
      },
      generatedAt: new Date().toISOString(),
    };

    this.logger.debug('health snapshot built', {
      component: 'healthService',
      overallStatus,
    });

    return snapshot;
  }

  async buildReadinessSnapshot(): Promise<{
    ready: boolean;
    generatedAt: string;
    checks: {
      database: DependencyStatus;
      workers: DependencyStatus;
    };
  }> {
    const [database, workers] = await Promise.all([
      this.checkDatabase(),
      this.checkWorkers(),
    ]);

    const ready = database.status === 'ok' && workers.status !== 'fail';

    return {
      ready,
      generatedAt: new Date().toISOString(),
      checks: { database, workers },
    };
  }

  private async checkDatabase(): Promise<DependencyStatus> {
    const latencyMs = await this.jobStore.ping();

    return {
      ok: true,
      status: 'ok',
      details: { latencyMs },
    };
  }

  private async checkWorkers(): Promise<DependencyStatus> {
    const rows = await this.jobStore.getWorkerHeartbeats();
    const now = Date.now();

    const comp = rows.find((r) => r.workerName === 'comp-analysis-worker');
    const retry = rows.find((r) => r.workerName === 'retry-worker');

    const compFresh = isWorkerFresh(comp, now, this.config.compWorkerFreshnessSeconds);
    const retryFresh = isWorkerFresh(retry, now, this.config.retryWorkerFreshnessSeconds);

    const issues: string[] = [];
    if (!compFresh) issues.push('comp worker stale or missing');
    if (!retryFresh) issues.push('retry worker stale or missing');

    return {
      ok: issues.length === 0,
      status: issues.length === 0 ? 'ok' : 'fail',
      details: {
        compWorker: comp
          ? {
              workerInstanceId: comp.workerInstanceId,
              status: comp.status,
              lastSeenAt: comp.lastSeenAt,
              fresh: compFresh,
            }
          : null,
        retryWorker: retry
          ? {
              workerInstanceId: retry.workerInstanceId,
              status: retry.status,
              lastSeenAt: retry.lastSeenAt,
              fresh: retryFresh,
            }
          : null,
        issues,
      },
    };
  }

  private async checkBacklog(): Promise<DependencyStatus> {
    const counts = await this.jobStore.getBacklogCounts();
    const totalBacklog = counts.pending + counts.retry;

    const status: DependencyStatus['status'] =
      totalBacklog >= this.config.backlogFailThreshold
        ? 'fail'
        : totalBacklog >= this.config.backlogWarnThreshold
          ? 'degraded'
          : 'ok';

    return {
      ok: status === 'ok',
      status,
      details: {
        pending: counts.pending,
        retry: counts.retry,
        processing: counts.processing,
        totalBacklog,
        warnThreshold: this.config.backlogWarnThreshold,
        failThreshold: this.config.backlogFailThreshold,
      },
    };
  }

  private async checkDeadLetter(): Promise<DependencyStatus> {
    const deadLetterCount = await this.jobStore.getDeadLetterCount();

    const status: DependencyStatus['status'] =
      deadLetterCount >= this.config.deadLetterFailThreshold
        ? 'fail'
        : deadLetterCount >= this.config.deadLetterWarnThreshold
          ? 'degraded'
          : 'ok';

    return {
      ok: status === 'ok',
      status,
      details: {
        deadLetterCount,
        warnThreshold: this.config.deadLetterWarnThreshold,
        failThreshold: this.config.deadLetterFailThreshold,
      },
    };
  }

  private async checkStaleProcessing(): Promise<DependencyStatus> {
    const staleProcessingCount = await this.jobStore.getStaleProcessingCount(
      this.config.staleProcessingMinutes,
    );

    return {
      ok: staleProcessingCount === 0,
      status: staleProcessingCount > 0 ? 'degraded' : 'ok',
      details: {
        staleProcessingCount,
        staleProcessingMinutes: this.config.staleProcessingMinutes,
      },
    };
  }
}

function isWorkerFresh(
  row: WorkerHeartbeatRow | undefined,
  nowMs: number,
  freshnessSeconds: number,
): boolean {
  if (!row) return false;
  const ageMs = nowMs - new Date(row.lastSeenAt).getTime();
  return ageMs <= freshnessSeconds * 1000;
}
