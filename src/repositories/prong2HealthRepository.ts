import type { Prong2WorkerStatus } from '../contracts/prong2WorkerHealth';
import { Pool, type QueryResultRow } from 'pg';

export interface WorkerHeartbeatRow {
  workerName: string;
  workerInstanceId: string;
  status: Prong2WorkerStatus;
  detailsJson: Record<string, unknown>;
  lastSeenAt: string;
}

export interface CandidateBacklogStats {
  pendingCount: number;
  retryNeededCount: number;
  oldestPendingAgeSeconds: number;
  oldestRetryNeededAgeSeconds: number;
}

export interface OpportunityQueueStats {
  queuedCount: number;
  reviewedCount: number;
  purchasedCount: number;
  oldestQueuedAgeSeconds: number;
  oldestReviewedAgeSeconds: number;
}

export interface DeadLetterStats {
  lastHourCount: number;
  last24hCount: number;
}

export interface MarketIntelRunStats {
  runningCount: number;
  oldestRunningAgeSeconds: number;
  failedLast24hCount: number;
}

export interface ActiveWatchlistStats {
  activeCount: number;
}

/**
 * Contract consumed by src/services/prong2Readiness.ts.
 * Keeping this exported makes typing mocks and alternate implementations easy.
 */
export interface Prong2HealthRepositoryContract {
  checkDatabase(): Promise<boolean>;
  getLatestWorkerHeartbeats(workerNames: string[]): Promise<WorkerHeartbeatRow[]>;
  getCandidateBacklogStats(): Promise<CandidateBacklogStats>;
  getOpportunityQueueStats(): Promise<OpportunityQueueStats>;
  getDeadLetterStats(): Promise<DeadLetterStats>;
  getMarketIntelRunStats(): Promise<MarketIntelRunStats>;
  getActiveWatchlistStats(): Promise<ActiveWatchlistStats>;
}

type WorkerHeartbeatDbRow = QueryResultRow & {
  worker_name: unknown;
  worker_instance_id: unknown;
  status: unknown;
  details_json: unknown;
  last_seen_at: unknown;
};

type CandidateBacklogDbRow = QueryResultRow & {
  pending_count: unknown;
  retry_needed_count: unknown;
  oldest_pending_age_seconds: unknown;
  oldest_retry_needed_age_seconds: unknown;
};

type OpportunityQueueDbRow = QueryResultRow & {
  queued_count: unknown;
  reviewed_count: unknown;
  purchased_count: unknown;
  oldest_queued_age_seconds: unknown;
  oldest_reviewed_age_seconds: unknown;
};

type DeadLetterDbRow = QueryResultRow & {
  last_hour_count: unknown;
  last_24h_count: unknown;
};

type MarketIntelRunDbRow = QueryResultRow & {
  running_count: unknown;
  oldest_running_age_seconds: unknown;
  failed_last_24h_count: unknown;
};

type ActiveWatchlistDbRow = QueryResultRow & {
  active_count: unknown;
};

type DatabaseCheckRow = QueryResultRow & {
  ok: unknown;
};

export class Prong2HealthRepository implements Prong2HealthRepositoryContract {
  constructor(private readonly pool: Pool) {}

  async checkDatabase(): Promise<boolean> {
    const result = await this.pool.query<DatabaseCheckRow>('select 1 as ok');
    return toNumber(result.rows[0]?.ok) === 1;
  }

  async getLatestWorkerHeartbeats(
    workerNames: string[],
  ): Promise<WorkerHeartbeatRow[]> {
    if (workerNames.length === 0) {
      return [];
    }

    const result = await this.pool.query<WorkerHeartbeatDbRow>(
      `
      with ranked as (
        select
          worker_name,
          worker_instance_id,
          status,
          details_json,
          last_seen_at,
          row_number() over (
            partition by worker_name, worker_instance_id
            order by last_seen_at desc
          ) as rn
        from arb.worker_heartbeats
        where worker_name = any($1::text[])
      )
      select
        worker_name,
        worker_instance_id,
        status,
        details_json,
        last_seen_at
      from ranked
      where rn = 1
      order by worker_name asc, worker_instance_id asc
      `,
      [workerNames],
    );

    return result.rows.map((row) => ({
      workerName: toStringSafe(row.worker_name),
      workerInstanceId: toStringSafe(row.worker_instance_id),
      status: toStringSafe(row.status) as Prong2WorkerStatus,
      detailsJson: toRecord(row.details_json),
      lastSeenAt: toIsoString(row.last_seen_at),
    }));
  }

  async getCandidateBacklogStats(): Promise<CandidateBacklogStats> {
    const result = await this.pool.query<CandidateBacklogDbRow>(
      `
      select
        count(*) filter (where status = 'pending')::int as pending_count,
        count(*) filter (where status = 'retry_needed')::int as retry_needed_count,
        coalesce(
          floor(extract(epoch from now() - min(updated_at) filter (where status = 'pending'))),
          0
        )::int as oldest_pending_age_seconds,
        coalesce(
          floor(extract(epoch from now() - min(updated_at) filter (where status = 'retry_needed'))),
          0
        )::int as oldest_retry_needed_age_seconds
      from arb.candidates
      `,
    );

    const row = result.rows[0];

    return {
      pendingCount: toNumber(row?.pending_count),
      retryNeededCount: toNumber(row?.retry_needed_count),
      oldestPendingAgeSeconds: toNumber(row?.oldest_pending_age_seconds),
      oldestRetryNeededAgeSeconds: toNumber(row?.oldest_retry_needed_age_seconds),
    };
  }

  async getOpportunityQueueStats(): Promise<OpportunityQueueStats> {
    const result = await this.pool.query<OpportunityQueueDbRow>(
      `
      select
        count(*) filter (where status = 'queued')::int as queued_count,
        count(*) filter (where status = 'reviewed')::int as reviewed_count,
        count(*) filter (where status = 'purchased')::int as purchased_count,
        coalesce(
          floor(extract(epoch from now() - min(updated_at) filter (where status = 'queued'))),
          0
        )::int as oldest_queued_age_seconds,
        coalesce(
          floor(extract(epoch from now() - min(updated_at) filter (where status = 'reviewed'))),
          0
        )::int as oldest_reviewed_age_seconds
      from arb.opportunity_queue
      `,
    );

    const row = result.rows[0];

    return {
      queuedCount: toNumber(row?.queued_count),
      reviewedCount: toNumber(row?.reviewed_count),
      purchasedCount: toNumber(row?.purchased_count),
      oldestQueuedAgeSeconds: toNumber(row?.oldest_queued_age_seconds),
      oldestReviewedAgeSeconds: toNumber(row?.oldest_reviewed_age_seconds),
    };
  }

  async getDeadLetterStats(): Promise<DeadLetterStats> {
    const result = await this.pool.query<DeadLetterDbRow>(
      `
      select
        count(*) filter (where created_at >= now() - interval '1 hour')::int as last_hour_count,
        count(*) filter (where created_at >= now() - interval '24 hours')::int as last_24h_count
      from arb.prong2_dead_letter
      `,
    );

    const row = result.rows[0];

    return {
      lastHourCount: toNumber(row?.last_hour_count),
      last24hCount: toNumber(row?.last_24h_count),
    };
  }

  async getMarketIntelRunStats(): Promise<MarketIntelRunStats> {
    const result = await this.pool.query<MarketIntelRunDbRow>(
      `
      select
        count(*) filter (where status = 'running')::int as running_count,
        coalesce(
          floor(extract(epoch from now() - min(started_at) filter (where status = 'running'))),
          0
        )::int as oldest_running_age_seconds,
        count(*) filter (
          where status = 'failed'
            and completed_at >= now() - interval '24 hours'
        )::int as failed_last_24h_count
      from arb.market_intel_runs
      `,
    );

    const row = result.rows[0];

    return {
      runningCount: toNumber(row?.running_count),
      oldestRunningAgeSeconds: toNumber(row?.oldest_running_age_seconds),
      failedLast24hCount: toNumber(row?.failed_last_24h_count),
    };
  }

  async getActiveWatchlistStats(): Promise<ActiveWatchlistStats> {
    const result = await this.pool.query<ActiveWatchlistDbRow>(
      `
      select count(*)::int as active_count
      from arb.product_watchlist
      where status = 'active'
      `,
    );

    return {
      activeCount: toNumber(result.rows[0]?.active_count),
    };
  }
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined || value === '') {
    return 0;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toStringSafe(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (value === null || value === undefined) {
    return '';
  }

  return String(value);
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function toIsoString(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  return new Date(0).toISOString();
}
