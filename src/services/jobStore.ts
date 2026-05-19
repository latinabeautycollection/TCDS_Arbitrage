import type { Pool, PoolClient, QueryResultRow } from 'pg';

export type CompStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'retry'
  | 'dead_letter';

export type WorkerHeartbeatStatus =
  | 'starting'
  | 'running'
  | 'processing'
  | 'degraded'
  | 'stopped';

export type ListingId = string & { readonly __brand: 'ListingId' };

export interface ListingJob {
  id: ListingId;
  listingExternalId: string | null;
  title: string;
  normalizedTitle: string | null;
  brand: string | null;
  model: string | null;
  categoryId: string | null;
  categoryKey: string | null;
  conditionText: string | null;
  conditionGrade: string | null;
  buyNowPrice: number | null;
  currentBidPrice: number | null;
  inboundShippingUsd: number | null;
  priority: number | null;
  compAttempts: number;
  compStatus: CompStatus;
  categoryRecoveryApplied: boolean;
  lastCompDecision: string | null;
  reviewPriority: number | null;
}

export interface RetryCandidate {
  id: ListingId;
  listingExternalId: string | null;
  title: string;
  compStatus: 'retry';
  compAttempts: number;
  nextCompAttemptAt: string | null;
  compLastError: string | null;
  compLastErrorClass: string | null;
  priority: number | null;
  categoryRecoveryApplied: boolean;
  compResultJson: Record<string, unknown> | null;
}

export interface PersistMarketInput {
  listingId: ListingId;
  queryText: string | null;
  sold30d: number;
  activeCount: number;
  medianSoldPrice: number | null;
  p25SoldPrice: number | null;
  p75SoldPrice: number | null;
  medianActivePrice: number | null;
  resaleAnchorPrice: number | null;
  liquidityRatio: number | null;
  confidence: string;
  soldPricesJson: unknown;
  activePricesJson: unknown;
  soldSampleJson: unknown;
  activeSampleJson: unknown;
  correlationId: string;
}

export interface PersistDecisionInput {
  listingId: ListingId;
  decision: string;
  confidence: string;
  expectedResaleUsd: number | null;
  expectedNetUsd: number | null;
  estimatedProfitUsd: number | null;
  estimatedRoi: number | null;
  maxBidUsd: number | null;
  reasonsJson: unknown;
  riskFlagsJson: unknown;
  correlationId: string;
}

export interface FinalizeSuccessMeta {
  compDurationMs: number;
  compQuery: string;
  soldCount: number;
  activeCount: number;
  acceptedSoldCount: number;
  manualReviewSoldCount: number;
  rejectedSoldCount: number;
  decision: string;
  decisionSupport: string;
  correlationId: string;
  liquidityBand: string;
  evidenceGatePassed: boolean;
  evidenceGateReasons: string[];
  avgCategoryMatchScore: number | null;
  avgConditionMatchScore: number | null;
  avgOverallEvidenceScore: number | null;
  conditionGate: string;
}

export interface RetryUpdateInput {
  nextAttemptAt: Date;
  failureReason: string;
  failureClass: string;
}

export interface TerminalUpdateInput {
  terminalState: 'dead_letter';
  failureReason: string;
  failureClass: string;
  meta?: Record<string, unknown>;
}

export interface BacklogCounts {
  pending: number;
  retry: number;
  processing: number;
  completed: number;
  deadLetter: number;
}

export interface WorkerHeartbeatRow {
  workerName: string;
  workerInstanceId: string;
  status: string;
  detailsJson: Record<string, unknown> | null;
  lastSeenAt: string;
}

export class JobStore {
  constructor(private readonly pool: Pool) {}

  async ping(): Promise<number> {
    const startedAt = Date.now();
    await this.pool.query('select 1 as ok');
    return Date.now() - startedAt;
  }

  async claimNextCompJob(
    lockTtlSeconds: number,
    workerInstanceId: string,
  ): Promise<ListingJob | null> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      const result = await client.query(
        `
        with candidate as (
          select
            l.id,
            l.listing_external_id,
            l.title,
            l.normalized_title,
            l.brand,
            l.model,
            l.category_id,
            l.category_key,
            l.condition_text,
            l.condition_grade,
            l.buy_now_price,
            l.current_bid_price,
            l.inbound_shipping_usd,
            l.priority,
            coalesce(l.comp_attempts, 0) as comp_attempts,
            coalesce(l.comp_status, 'pending') as comp_status,
            case
              when coalesce(l.phase_summary_current, '') ilike '%category_recovery_applied%' then true
              else false
            end as category_recovery_applied,
            case
              when jsonb_typeof(l.comp_result_json) = 'object'
                then l.comp_result_json ->> 'decision'
              else null
            end as last_comp_decision,
            coalesce(
              nullif((l.comp_result_json ->> 'reviewPriority')::int, null),
              l.priority,
              1000
            ) as review_priority
          from arb.listings l
          where coalesce(l.comp_status, 'pending') in ('pending', 'retry')
            and coalesce(l.next_comp_attempt_at, now()) <= now()
            and (
              l.comp_locked_at is null
              or l.comp_locked_at < now() - make_interval(secs => $1::int)
            )
          order by
            case
              when coalesce(l.phase_summary_current, '') ilike '%category_recovery_applied%' then 0
              else 1
            end asc,
            coalesce(l.priority, 1000) asc,
            l.id asc
          limit 1
          for update skip locked
        )
        update arb.listings l
           set comp_status = 'processing',
               comp_locked_at = now(),
               comp_locked_by = $2,
               comp_started_at = coalesce(l.comp_started_at, now()),
               comp_updated_at = now(),
               comp_attempts = coalesce(l.comp_attempts, 0) + 1
        from candidate c
        where l.id = c.id
        returning
          l.id,
          l.listing_external_id,
          l.title,
          l.normalized_title,
          l.brand,
          l.model,
          l.category_id,
          l.category_key,
          l.condition_text,
          l.condition_grade,
          l.buy_now_price,
          l.current_bid_price,
          l.inbound_shipping_usd,
          l.priority,
          l.comp_attempts,
          l.comp_status,
          c.category_recovery_applied,
          c.last_comp_decision,
          c.review_priority
        `,
        [lockTtlSeconds, workerInstanceId],
      );

      await client.query('COMMIT');

      if (result.rowCount === 0) {
        return null;
      }

      return mapListingJob(result.rows[0]);
    } catch (error) {
      await safeRollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async persistMarketAndDecision(
    market: PersistMarketInput,
    decision: PersistDecisionInput,
  ): Promise<void> {
    assertListingId(market.listingId, 'PersistMarketInput.listingId');
    assertListingId(decision.listingId, 'PersistDecisionInput.listingId');

    if (market.listingId !== decision.listingId) {
      throw new Error(
        `Listing ID mismatch between market and decision payloads: ${market.listingId} vs ${decision.listingId}`,
      );
    }

    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      await client.query(
        `
        insert into arb.ebay_market (
          listing_id,
          query_text,
          sold_30d,
          active_count,
          median_sold_price,
          p25_sold_price,
          p75_sold_price,
          median_active_price,
          resale_anchor_price,
          liquidity_ratio,
          confidence,
          sold_prices_json,
          active_prices_json,
          sold_sample_json,
          active_sample_json,
          correlation_id,
          updated_at
        )
        values (
          $1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
          $12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,$16,now()
        )
        on conflict (listing_id)
        do update set
          query_text = excluded.query_text,
          sold_30d = excluded.sold_30d,
          active_count = excluded.active_count,
          median_sold_price = excluded.median_sold_price,
          p25_sold_price = excluded.p25_sold_price,
          p75_sold_price = excluded.p75_sold_price,
          median_active_price = excluded.median_active_price,
          resale_anchor_price = excluded.resale_anchor_price,
          liquidity_ratio = excluded.liquidity_ratio,
          confidence = excluded.confidence,
          sold_prices_json = excluded.sold_prices_json,
          active_prices_json = excluded.active_prices_json,
          sold_sample_json = excluded.sold_sample_json,
          active_sample_json = excluded.active_sample_json,
          correlation_id = excluded.correlation_id,
          updated_at = now()
        `,
        [
          market.listingId,
          market.queryText,
          market.sold30d,
          market.activeCount,
          market.medianSoldPrice,
          market.p25SoldPrice,
          market.p75SoldPrice,
          market.medianActivePrice,
          market.resaleAnchorPrice,
          market.liquidityRatio,
          market.confidence,
          JSON.stringify(market.soldPricesJson),
          JSON.stringify(market.activePricesJson),
          JSON.stringify(market.soldSampleJson),
          JSON.stringify(market.activeSampleJson),
          market.correlationId,
        ],
      );

      await client.query(
        `
        insert into arb.decisions (
          listing_id,
          decision,
          confidence,
          expected_resale_usd,
          expected_net_usd,
          estimated_profit_usd,
          estimated_roi,
          max_bid_usd,
          reasons_json,
          risk_flags_json,
          correlation_id,
          updated_at
        )
        values (
          $1::uuid,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,now()
        )
        on conflict (listing_id)
        do update set
          decision = excluded.decision,
          confidence = excluded.confidence,
          expected_resale_usd = excluded.expected_resale_usd,
          expected_net_usd = excluded.expected_net_usd,
          estimated_profit_usd = excluded.estimated_profit_usd,
          estimated_roi = excluded.estimated_roi,
          max_bid_usd = excluded.max_bid_usd,
          reasons_json = excluded.reasons_json,
          risk_flags_json = excluded.risk_flags_json,
          correlation_id = excluded.correlation_id,
          updated_at = now()
        `,
        [
          decision.listingId,
          decision.decision,
          decision.confidence,
          decision.expectedResaleUsd,
          decision.expectedNetUsd,
          decision.estimatedProfitUsd,
          decision.estimatedRoi,
          decision.maxBidUsd,
          JSON.stringify(decision.reasonsJson),
          JSON.stringify(decision.riskFlagsJson),
          decision.correlationId,
        ],
      );

      await client.query('COMMIT');
    } catch (error) {
      await safeRollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async finalizeSuccess(listingId: ListingId, meta: FinalizeSuccessMeta): Promise<void> {
    assertListingId(listingId, 'finalizeSuccess.listingId');

    await this.pool.query(
      `
      update arb.listings
         set comp_status = 'completed',
             comp_completed_at = now(),
             comp_updated_at = now(),
             comp_locked_at = null,
             comp_locked_by = null,
             next_comp_attempt_at = null,
             comp_last_error = null,
             comp_last_error_class = null,
             comp_result_json = coalesce(comp_result_json, '{}'::jsonb) || $2::jsonb
       where id = $1::uuid
      `,
      [listingId, JSON.stringify(meta)],
    );
  }

  async markListingForRetry(listingId: ListingId, input: RetryUpdateInput): Promise<void> {
    assertListingId(listingId, 'markListingForRetry.listingId');

    await this.pool.query(
      `
      update arb.listings
         set comp_status = 'retry',
             comp_updated_at = now(),
             comp_locked_at = null,
             comp_locked_by = null,
             next_comp_attempt_at = $2,
             comp_last_error = left($3, 1000),
             comp_last_error_class = left($4, 128)
       where id = $1::uuid
      `,
      [
        listingId,
        input.nextAttemptAt.toISOString(),
        input.failureReason,
        input.failureClass,
      ],
    );
  }

  async markListingTerminal(listingId: ListingId, input: TerminalUpdateInput): Promise<void> {
    assertListingId(listingId, 'markListingTerminal.listingId');

    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      await client.query(
        `
        update arb.listings
           set comp_status = $2,
               comp_updated_at = now(),
               comp_locked_at = null,
               comp_locked_by = null,
               next_comp_attempt_at = null,
               comp_last_error = left($3, 1000),
               comp_last_error_class = left($4, 128),
               comp_result_json = coalesce(comp_result_json, '{}'::jsonb) || $5::jsonb
         where id = $1::uuid
        `,
        [
          listingId,
          input.terminalState,
          input.failureReason,
          input.failureClass,
          JSON.stringify({
            failureReason: input.failureReason,
            failureClass: input.failureClass,
            ...(input.meta ?? {}),
          }),
        ],
      );

      await client.query(
        `
        insert into arb.comp_dead_letter (
          listing_id,
          failure_reason,
          failure_class,
          error_json,
          created_at
        )
        values ($1::uuid, $2, $3, $4::jsonb, now())
        `,
        [
          listingId,
          input.failureReason,
          input.failureClass,
          JSON.stringify(input.meta ?? {}),
        ],
      );

      await client.query('COMMIT');
    } catch (error) {
      await safeRollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async writeWorkerHeartbeat(
    workerName: string,
    workerInstanceId: string,
    status: WorkerHeartbeatStatus,
    details: Record<string, unknown>,
  ): Promise<void> {
    await this.pool.query(
      `
      insert into arb.worker_heartbeats (
        worker_name,
        worker_instance_id,
        status,
        details_json,
        last_seen_at
      )
      values ($1, $2, $3, $4::jsonb, now())
      on conflict (worker_name, worker_instance_id)
      do update set
        status = excluded.status,
        details_json = excluded.details_json,
        last_seen_at = now()
      `,
      [workerName, workerInstanceId, status, JSON.stringify(details)],
    );
  }

  async claimRetryCandidates(
    lockTtlSeconds: number,
    batchSize: number,
    workerInstanceId: string,
  ): Promise<RetryCandidate[]> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      const result = await client.query(
        `
        with candidate as (
          select
            l.id,
            l.listing_external_id,
            l.title,
            l.comp_status,
            coalesce(l.comp_attempts, 0) as comp_attempts,
            l.next_comp_attempt_at,
            l.comp_last_error,
            l.comp_last_error_class,
            l.priority,
            case
              when coalesce(l.phase_summary_current, '') ilike '%category_recovery_applied%' then true
              else false
            end as category_recovery_applied,
            l.comp_result_json
          from arb.listings l
          where l.comp_status = 'retry'
            and coalesce(l.next_comp_attempt_at, now()) <= now()
            and (
              l.comp_locked_at is null
              or l.comp_locked_at < now() - make_interval(secs => $1::int)
            )
          order by
            case
              when upper(coalesce(l.comp_last_error_class, '')) = 'THROTTLED' then 0
              else 1
            end asc,
            case
              when coalesce(l.phase_summary_current, '') ilike '%category_recovery_applied%' then 0
              else 1
            end asc,
            coalesce(l.next_comp_attempt_at, now()) asc,
            coalesce(l.priority, 1000) asc,
            l.id asc
          limit $2
          for update skip locked
        )
        update arb.listings l
           set comp_locked_at = now(),
               comp_locked_by = $3,
               comp_updated_at = now()
        from candidate c
        where l.id = c.id
        returning
          l.id,
          l.listing_external_id,
          l.title,
          l.comp_status,
          l.comp_attempts,
          l.next_comp_attempt_at,
          l.comp_last_error,
          l.comp_last_error_class,
          c.priority,
          c.category_recovery_applied,
          c.comp_result_json
        `,
        [lockTtlSeconds, batchSize, workerInstanceId],
      );

      await client.query('COMMIT');

      return result.rows.map(mapRetryCandidate);
    } catch (error) {
      await safeRollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async resetListingToPending(listingId: ListingId): Promise<boolean> {
    assertListingId(listingId, 'resetListingToPending.listingId');

    const result = await this.pool.query(
      `
      update arb.listings
         set comp_status = 'pending',
             comp_locked_at = null,
             comp_locked_by = null,
             next_comp_attempt_at = null,
             comp_updated_at = now()
       where id = $1::uuid
         and comp_status = 'retry'
      `,
      [listingId],
    );

    return (result.rowCount ?? 0) > 0;
  }

  async reclaimStaleProcessingLocks(staleRetryMinutes: number): Promise<number> {
    const result = await this.pool.query(
      `
      update arb.listings
         set comp_status = 'retry',
             next_comp_attempt_at = now(),
             comp_locked_at = null,
             comp_locked_by = null,
             comp_updated_at = now(),
             comp_last_error = left(coalesce(comp_last_error, 'stale processing lock reclaimed'), 1000),
             comp_last_error_class = coalesce(comp_last_error_class, 'STALE_LOCK_RECLAIMED')
       where comp_status = 'processing'
         and comp_locked_at < now() - make_interval(mins => $1::int)
      `,
      [staleRetryMinutes],
    );

    return result.rowCount ?? 0;
  }

  async getWorkerHeartbeats(): Promise<WorkerHeartbeatRow[]> {
    const result = await this.pool.query(
      `
      select worker_name, worker_instance_id, status, details_json, last_seen_at
      from arb.worker_heartbeats
      where worker_name in ('comp-analysis-worker', 'retry-worker')
      order by last_seen_at desc
      `,
    );

    return result.rows.map((row) => ({
      workerName: String(row.worker_name),
      workerInstanceId: String(row.worker_instance_id),
      status: String(row.status),
      detailsJson: toRecordOrNull(row.details_json),
      lastSeenAt: new Date(row.last_seen_at).toISOString(),
    }));
  }

  async getBacklogCounts(): Promise<BacklogCounts> {
    const result = await this.pool.query(
      `
      select
        count(*) filter (where coalesce(comp_status, 'pending') = 'pending') as pending_count,
        count(*) filter (where comp_status = 'retry') as retry_count,
        count(*) filter (where comp_status = 'processing') as processing_count,
        count(*) filter (where comp_status = 'completed') as completed_count,
        count(*) filter (where comp_status = 'dead_letter') as dead_letter_count
      from arb.listings
      `,
    );

    const row = result.rows[0];
    return {
      pending: Number(row.pending_count ?? 0),
      retry: Number(row.retry_count ?? 0),
      processing: Number(row.processing_count ?? 0),
      completed: Number(row.completed_count ?? 0),
      deadLetter: Number(row.dead_letter_count ?? 0),
    };
  }

  async getDeadLetterCount(): Promise<number> {
    const result = await this.pool.query(
      `
      select count(*)::int as dead_letter_count
      from arb.listings
      where comp_status = 'dead_letter'
      `,
    );

    return Number(result.rows[0]?.dead_letter_count ?? 0);
  }

  async getStaleProcessingCount(staleProcessingMinutes: number): Promise<number> {
    const result = await this.pool.query(
      `
      select count(*)::int as stale_processing_count
      from arb.listings
      where comp_status = 'processing'
        and comp_locked_at < now() - make_interval(mins => $1::int)
      `,
      [staleProcessingMinutes],
    );

    return Number(result.rows[0]?.stale_processing_count ?? 0);
  }
}

function mapListingJob(row: QueryResultRow): ListingJob {
  return {
    id: toListingId(row.id, 'ListingJob.id'),
    listingExternalId: row.listing_external_id ? String(row.listing_external_id) : null,
    title: String(row.title ?? ''),
    normalizedTitle: row.normalized_title ? String(row.normalized_title) : null,
    brand: row.brand ? String(row.brand) : null,
    model: row.model ? String(row.model) : null,
    categoryId: row.category_id ? String(row.category_id) : null,
    categoryKey: row.category_key ? String(row.category_key) : null,
    conditionText: row.condition_text ? String(row.condition_text) : null,
    conditionGrade: row.condition_grade ? String(row.condition_grade) : null,
    buyNowPrice: parseNullableNumber(row.buy_now_price),
    currentBidPrice: parseNullableNumber(row.current_bid_price),
    inboundShippingUsd: parseNullableNumber(row.inbound_shipping_usd),
    priority: row.priority !== null && row.priority !== undefined ? Number(row.priority) : null,
    compAttempts: Number(row.comp_attempts ?? 0),
    compStatus: String(row.comp_status ?? 'processing') as CompStatus,
    categoryRecoveryApplied: Boolean(row.category_recovery_applied),
    lastCompDecision: row.last_comp_decision ? String(row.last_comp_decision) : null,
    reviewPriority: row.review_priority !== null && row.review_priority !== undefined ? Number(row.review_priority) : null,
  };
}

function mapRetryCandidate(row: QueryResultRow): RetryCandidate {
  return {
    id: toListingId(row.id, 'RetryCandidate.id'),
    listingExternalId: row.listing_external_id ? String(row.listing_external_id) : null,
    title: String(row.title ?? ''),
    compStatus: 'retry',
    compAttempts: Number(row.comp_attempts ?? 0),
    nextCompAttemptAt: row.next_comp_attempt_at
      ? new Date(row.next_comp_attempt_at as string | Date).toISOString()
      : null,
    compLastError: row.comp_last_error ? String(row.comp_last_error) : null,
    compLastErrorClass: row.comp_last_error_class ? String(row.comp_last_error_class) : null,
    priority: row.priority !== null && row.priority !== undefined ? Number(row.priority) : null,
    categoryRecoveryApplied: Boolean(row.category_recovery_applied),
    compResultJson: toRecordOrNull(row.comp_result_json),
  };
}

async function safeRollback(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // suppress rollback failure; caller handles original failure
  }
}

function parseNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toRecordOrNull(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toListingId(value: unknown, fieldName = 'listingId'): ListingId {
  const str = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
  assertListingId(str, fieldName);
  return str as ListingId;
}

function assertListingId(value: unknown, fieldName = 'listingId'): asserts value is ListingId {
  const str = typeof value === 'string' ? value.trim() : String(value ?? '').trim();

  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!uuidRegex.test(str)) {
    throw new Error(`Invalid UUID for ${fieldName}: ${String(value)}`);
  }
}
