/* src/repositories/capitalAllocationRepository.ts
 * Domain 2 — Capital Allocation Repository
 * Green Tier 1 hardened version.
 *
 * Fixes:
 * - No duplicate methods.
 * - Reads hardened Domain 1 execution fields.
 * - Allocates for AUTO_BUY_READY, BID_MONITOR_READY, REVIEW_REQUIRED.
 * - Blocks only BLOCKED, EXPIRED, CAPITAL_LIMIT_SKIPPED and invalid math.
 * - Dynamically writes purchase_queue when schema supports it.
 */

import crypto from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import type {
  AllocationMode,
  AllocationPolicy,
  AllocatedOpportunity,
  BuyQualifiedOpportunity,
  CapitalAllocationResult,
  PurchaseQueueStatus,
} from '../services/capitalAllocationEngine';

const ALLOCATABLE_EXECUTION_STATUSES = [
  'AUTO_BUY_READY',
  'BID_MONITOR_READY',
  'REVIEW_REQUIRED',
] as const;

const BLOCKED_EXECUTION_STATUSES = [
  'BLOCKED',
  'EXPIRED',
  'CAPITAL_LIMIT_SKIPPED',
] as const;

export class CapitalAllocationRepository {
  public constructor(private readonly pool: Pool) {}

  public async getPolicy(): Promise<AllocationPolicy> {
    const result = await this.pool.query(`
      select *
      from arb.capital_allocation_policy
      where id = 1
        and enabled = true
    `);

    if (result.rowCount !== 1) {
      throw new Error('Capital allocation policy missing or disabled');
    }

    const r = result.rows[0];

    return {
      policyVersion: String(r.policy_version),
      mode: normalizeMode(r.mode),
      totalCapitalUsd: toNumber(r.total_capital_usd),
      reservePct: toNumber(r.reserve_pct),
      maxPerItemUsd: toNumber(r.max_per_item_usd),
      maxCategoryExposurePct: toNumber(r.max_category_exposure_pct),
      maxFamilyExposurePct: toNumber(r.max_family_exposure_pct),
      minBuyAPlusScore: toNumber(r.min_buy_a_plus_score),
      minBuyAScore: toNumber(r.min_buy_a_score),
      minBuyBScore: toNumber(r.min_buy_b_score),
      minConfidenceScore: toNumber(r.min_confidence_score),
      requireCapitalSafety: Boolean(r.require_capital_safety),
      requireLiveness: Boolean(r.require_liveness),
      requireValidCostBasis: Boolean(r.require_valid_cost_basis),
    };
  }

  public async getBuyQualified(limit: number, mode: AllocationMode): Promise<BuyQualifiedOpportunity[]> {
    const safeLimit = sanitizeLimit(limit);
    return this.getDomain1ExecutionQualified(safeLimit, mode);
  }

  private async getDomain1ExecutionQualified(limit: number, mode: AllocationMode): Promise<BuyQualifiedOpportunity[]> {
    const sourceExists = await this.existsRelation('arb.v_domain2_buy_qualified_source');

    if (sourceExists) {
      const columns = await this.getRelationColumns('arb', 'v_domain2_buy_qualified_source');
      const result = await this.pool.query(this.buildViewSourceQuery(columns), [
        ALLOCATABLE_EXECUTION_STATUSES,
        BLOCKED_EXECUTION_STATUSES,
        limit,
      ]);

      return result.rows.map((row) => mapOpportunityRow(row, mode));
    }

    const result = await this.pool.query(this.buildDecisionsFallbackQuery(), [
      ALLOCATABLE_EXECUTION_STATUSES,
      BLOCKED_EXECUTION_STATUSES,
      limit,
    ]);

    return result.rows.map((row) => mapOpportunityRow(row, mode));
  }

  private buildViewSourceQuery(columns: Set<string>): string {
    const expr = (name: string, fallback: string): string => columns.has(name) ? name : fallback;
    const coalesceAny = (names: string[], fallback: string): string => {
      const existing = names.filter((name) => columns.has(name));
      return existing.length ? `coalesce(${existing.join(', ')}, ${fallback})` : fallback;
    };

    const sourceRecordId = expr('source_record_id', coalesceAny(['id', 'decision_id'], "'unknown'"));
    const decisionId = expr('decision_id', "null::text");
    const listingId = expr('listing_id', "null::text");
    const candidateId = expr('candidate_id', "null::text");
    const opportunityQueueId = expr('opportunity_queue_id', "null::text");
    const categoryKey = coalesceAny(['category_key'], "'unknown'");
    const familyKey = coalesceAny(['family_key', 'category_key'], "'unknown'");

    const originalDecision = coalesceAny(['original_decision', 'decision_status', 'decision'], "'BUY'");
    const finalDecision = coalesceAny(['final_decision', 'decision_status', 'decision'], "'BUY'");
    const decisionStatus = coalesceAny(['decision_status', 'final_decision', 'original_decision', 'decision'], "'BUY'");
    const qualificationStatus = coalesceAny(['qualification_status'], "'BUY_QUALIFIED'");

    const executionStatus = coalesceAny(['execution_status'], "'REVIEW_REQUIRED'");
    const purchaseQueueStatus = coalesceAny(['purchase_queue_status'], `
      case
        when ${executionStatus} = 'AUTO_BUY_READY' then 'approved'
        when ${executionStatus} = 'BID_MONITOR_READY' then 'bid_monitor'
        when ${executionStatus} = 'REVIEW_REQUIRED' then 'review_required'
        else 'not_queued'
      end
    `);

    const capitalSafetyStatus = coalesceAny(['capital_safety_status'], "'REVIEW_REQUIRED'");
    const livenessStatus = coalesceAny(['liveness_status'], "'UNKNOWN'");
    const costBasisSource = coalesceAny(['cost_basis_source'], "'EFFECTIVE_COST_BASIS'");

    const hardBlockReasons = expr('hard_block_reasons', "array[]::text[]");
    const softReviewReasons = expr('soft_review_reasons', "array[]::text[]");
    const reasonCodes = expr('reason_codes', "array[]::text[]");
    const riskFlags = expr('risk_flags', "array[]::text[]");

    const requiredCapital = coalesceAny(
      ['required_capital_usd', 'effective_cost_basis_usd', 'expected_total_cost_basis_usd', 'max_bid_usd'],
      '0',
    );
    const expectedProfit = coalesceAny(['expected_profit_usd', 'estimated_profit_usd'], '0');
    const expectedRoi = coalesceAny(['expected_roi', 'estimated_roi'], '0');
    const expectedDays = expr('expected_days_to_sale', 'null::numeric');
    const confidence = coalesceAny(['confidence_score'], '0');
    const createdAt = expr('created_at', 'now()');

    return `
      select
        ${sourceRecordId}::text as source_record_id,
        ${decisionId}::text as decision_id,
        ${listingId}::text as listing_id,
        ${candidateId}::text as candidate_id,
        ${opportunityQueueId}::text as opportunity_queue_id,
        ${categoryKey}::text as category_key,
        ${familyKey}::text as family_key,

        ${originalDecision}::text as original_decision,
        ${finalDecision}::text as final_decision,
        ${decisionStatus}::text as decision_status,
        ${qualificationStatus}::text as qualification_status,

        ${executionStatus}::text as execution_status,
        ${purchaseQueueStatus}::text as purchase_queue_status,
        ${capitalSafetyStatus}::text as capital_safety_status,
        ${livenessStatus}::text as liveness_status,
        ${costBasisSource}::text as cost_basis_source,

        ${hardBlockReasons}::text[] as hard_block_reasons,
        ${softReviewReasons}::text[] as soft_review_reasons,
        ${reasonCodes}::text[] as reason_codes,
        ${riskFlags}::text[] as risk_flags,

        ${requiredCapital}::numeric as required_capital_usd,
        ${expectedProfit}::numeric as expected_profit_usd,
        ${expectedRoi}::numeric as expected_roi,
        ${expectedDays}::numeric as expected_days_to_sale,
        ${confidence}::numeric as confidence_score,
        ${createdAt} as created_at

      from arb.v_domain2_buy_qualified_source
      where ${qualificationStatus}::text = 'BUY_QUALIFIED'
        and (
          ${originalDecision}::text ilike 'BUY%'
          or ${finalDecision}::text ilike 'BUY%'
          or ${decisionStatus}::text ilike 'BUY%'
        )
        and ${executionStatus}::text = any($1::text[])
        and ${executionStatus}::text <> all($2::text[])
        and ${requiredCapital}::numeric > 0
        and ${expectedProfit}::numeric > 0
      order by ${createdAt} desc nulls last, ${sourceRecordId} asc
      limit $3
    `;
  }

  private buildDecisionsFallbackQuery(): string {
    return `
      select
        d.id::text as source_record_id,
        d.id::text as decision_id,
        d.listing_id::text as listing_id,
        null::text as candidate_id,
        null::text as opportunity_queue_id,
        coalesce(d.category_key, 'unknown') as category_key,
        coalesce(d.family_key, d.category_key, 'unknown') as family_key,

        coalesce(d.original_decision::text, d.decision::text, 'BUY') as original_decision,
        coalesce(d.final_decision::text, d.decision::text, 'BUY') as final_decision,
        coalesce(d.decision::text, 'BUY') as decision_status,
        'BUY_QUALIFIED' as qualification_status,

        coalesce(d.execution_status::text,
          case
            when coalesce(d.capital_safe, false) is true then 'AUTO_BUY_READY'
            when coalesce(d.decision::text, '') ilike 'BUY%' then 'REVIEW_REQUIRED'
            else 'BLOCKED'
          end
        ) as execution_status,

        coalesce(d.purchase_queue_status::text,
          case
            when coalesce(d.execution_status::text, '') = 'AUTO_BUY_READY' then 'approved'
            when coalesce(d.execution_status::text, '') = 'BID_MONITOR_READY' then 'bid_monitor'
            when coalesce(d.execution_status::text, '') = 'REVIEW_REQUIRED' then 'review_required'
            when coalesce(d.capital_safe, false) is true then 'approved'
            else 'review_required'
          end
        ) as purchase_queue_status,

        coalesce(d.capital_safety_status::text,
          case when coalesce(d.capital_safe, false) is true then 'PASS' else 'REVIEW_REQUIRED' end
        ) as capital_safety_status,
        'UNKNOWN' as liveness_status,
        'DECISION_COST_BASIS' as cost_basis_source,

        coalesce(d.hard_block_reasons, array[]::text[]) as hard_block_reasons,
        coalesce(d.soft_review_reasons, array[]::text[]) as soft_review_reasons,
        coalesce(d.reason_codes, array[]::text[]) as reason_codes,
        coalesce(d.risk_flags, array[]::text[]) as risk_flags,

        coalesce(d.effective_cost_basis_usd, d.expected_total_cost_basis_usd, d.max_bid_usd, 0) as required_capital_usd,
        coalesce(d.expected_profit_usd, d.estimated_profit_usd, 0) as expected_profit_usd,
        coalesce(d.expected_roi, d.estimated_roi, 0) as expected_roi,
        d.expected_days_to_sale,
        coalesce(d.confidence_score, 0) as confidence_score,
        d.created_at

      from arb.decisions d
      where coalesce(d.decision::text, '') ilike 'BUY%'
        and coalesce(d.execution_status::text,
          case
            when coalesce(d.capital_safe, false) is true then 'AUTO_BUY_READY'
            when coalesce(d.decision::text, '') ilike 'BUY%' then 'REVIEW_REQUIRED'
            else 'BLOCKED'
          end
        ) = any($1::text[])
        and coalesce(d.execution_status::text, '') <> all($2::text[])
        and coalesce(d.effective_cost_basis_usd, d.expected_total_cost_basis_usd, d.max_bid_usd, 0) > 0
        and coalesce(d.expected_profit_usd, d.estimated_profit_usd, 0) > 0
      order by d.created_at desc nulls last, d.id asc
      limit $3
    `;
  }

  public async persistRun(input: {
    mode: AllocationMode;
    policy: AllocationPolicy;
    opportunities: BuyQualifiedOpportunity[];
    result: CapitalAllocationResult;
  }): Promise<number> {
    const inputPayload = canonicalize({ policy: input.policy, opportunities: input.opportunities });
    const resultPayload = canonicalize(input.result);
    const inputHash = sha256(inputPayload);
    const resultHash = sha256(resultPayload);

    const correlationId = [
      'capital-allocation',
      input.policy.policyVersion,
      input.mode,
      inputHash.slice(0, 24),
    ].join(':');

    const client = await this.pool.connect();

    try {
      await client.query('begin');

      const runId = await this.upsertRun(client, {
        correlationId,
        inputHash,
        resultHash,
        mode: input.mode,
        policy: input.policy,
        result: input.result,
        candidateCount: input.opportunities.length,
      });

      await client.query(`delete from arb.capital_allocation_items where run_id = $1`, [runId]);

      for (const item of input.result.allocated) {
        await this.upsertItem(client, runId, item);
      }

      const purchaseQueueWrites = await this.promoteEligibleToPurchaseQueue(client, runId, input.result.allocated);

      await client.query(
        `
        update arb.capital_allocation_runs
        set run_json = coalesce(run_json, '{}'::jsonb) || $2::jsonb
        where id = $1
        `,
        [
          runId,
          JSON.stringify({
            purchaseQueueWrites,
            purchaseQueueEligibleCount: input.result.purchaseQueueEligibleCount,
            promotedAt: new Date().toISOString(),
          }),
        ],
      );

      await client.query('commit');
      return runId;
    } catch (error) {
      await client.query('rollback');

      await this.deadLetter({
        workerName: 'capital-allocation-repository',
        failureCode: 'PERSIST_RUN_FAILED',
        failureMessage: error instanceof Error ? error.message : String(error),
        payloadJson: {
          mode: input.mode,
          policyVersion: input.policy.policyVersion,
          inputHash,
          resultHash,
          correlationId,
        },
      }).catch(() => undefined);

      throw error;
    } finally {
      client.release();
    }
  }

  private async upsertRun(client: PoolClient, input: {
    correlationId: string;
    inputHash: string;
    resultHash: string;
    mode: AllocationMode;
    policy: AllocationPolicy;
    result: CapitalAllocationResult;
    candidateCount: number;
  }): Promise<number> {
    const allocated = input.result.allocated;

    const allocatedCount = allocated.filter((x) => x.capitalAllocationUsd > 0).length;
    const reviewCount = allocated.filter((x) => x.allocationTier === 'REVIEW_ALLOCATED').length;
    const noCapitalCount = allocated.filter((x) => x.allocationTier === 'NO_CAPITAL').length;
    const buyAPlusCount = allocated.filter((x) => x.allocationTier === 'BUY_A+').length;
    const buyACount = allocated.filter((x) => x.allocationTier === 'BUY_A').length;
    const buyBCount = allocated.filter((x) => x.allocationTier === 'BUY_B').length;

    const result = await client.query(
      `
      insert into arb.capital_allocation_runs (
        correlation_id,
        run_status,
        source_mode,
        policy_version,
        input_hash,
        result_hash,
        total_capital_usd,
        reserve_usd,
        deployable_capital_usd,
        allocated_capital_usd,
        remaining_capital_usd,
        candidate_count,
        allocated_count,
        review_count,
        no_capital_count,
        buy_a_plus_count,
        buy_a_count,
        buy_b_count,
        completed_at,
        run_json
      )
      values (
        $1,'completed',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,now(),$18::jsonb
      )
      on conflict (correlation_id)
      do update set
        run_status = 'completed',
        source_mode = excluded.source_mode,
        policy_version = excluded.policy_version,
        result_hash = excluded.result_hash,
        total_capital_usd = excluded.total_capital_usd,
        reserve_usd = excluded.reserve_usd,
        deployable_capital_usd = excluded.deployable_capital_usd,
        allocated_capital_usd = excluded.allocated_capital_usd,
        remaining_capital_usd = excluded.remaining_capital_usd,
        candidate_count = excluded.candidate_count,
        allocated_count = excluded.allocated_count,
        review_count = excluded.review_count,
        no_capital_count = excluded.no_capital_count,
        buy_a_plus_count = excluded.buy_a_plus_count,
        buy_a_count = excluded.buy_a_count,
        buy_b_count = excluded.buy_b_count,
        completed_at = now(),
        run_json = excluded.run_json
      returning id
      `,
      [
        input.correlationId,
        input.mode,
        input.policy.policyVersion,
        input.inputHash,
        input.resultHash,
        input.policy.totalCapitalUsd,
        input.result.reserveUsd,
        input.result.deployableCapitalUsd,
        input.result.allocatedCapitalUsd,
        input.result.remainingCapitalUsd,
        input.candidateCount,
        allocatedCount,
        reviewCount,
        noCapitalCount,
        buyAPlusCount,
        buyACount,
        buyBCount,
        JSON.stringify({
          inputHash: input.inputHash,
          resultHash: input.resultHash,
          policyVersion: input.policy.policyVersion,
          mode: input.mode,
          generatedAt: new Date().toISOString(),
          purchaseQueueEligibleCount: input.result.purchaseQueueEligibleCount,
          blockedCount: input.result.blockedCount,
          reviewRequiredCount: input.result.reviewRequiredCount,
          bidMonitorCount: input.result.bidMonitorCount,
        }),
      ],
    );

    return Number(result.rows[0].id);
  }

  private async upsertItem(client: PoolClient, runId: number, item: AllocatedOpportunity): Promise<void> {
    await client.query(
      `
      insert into arb.capital_allocation_items (
        run_id,
        source_record_id,
        listing_id,
        candidate_id,
        opportunity_queue_id,
        category_key,
        family_key,
        decision_status,
        qualification_status,
        allocation_tier,
        capital_allocation_usd,
        required_capital_usd,
        expected_profit_usd,
        expected_roi,
        expected_days_to_sale,
        confidence_score,
        capital_efficiency_score,
        velocity_score,
        allocation_score,
        exposure_status,
        reason_codes,
        risk_flags,
        allocation_json
      )
      values (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
        $21::text[],$22::text[],$23::jsonb
      )
      on conflict (run_id, source_record_id)
      do update set
        category_key = excluded.category_key,
        family_key = excluded.family_key,
        allocation_tier = excluded.allocation_tier,
        capital_allocation_usd = excluded.capital_allocation_usd,
        required_capital_usd = excluded.required_capital_usd,
        expected_profit_usd = excluded.expected_profit_usd,
        expected_roi = excluded.expected_roi,
        expected_days_to_sale = excluded.expected_days_to_sale,
        confidence_score = excluded.confidence_score,
        capital_efficiency_score = excluded.capital_efficiency_score,
        velocity_score = excluded.velocity_score,
        allocation_score = excluded.allocation_score,
        exposure_status = excluded.exposure_status,
        reason_codes = excluded.reason_codes,
        risk_flags = excluded.risk_flags,
        allocation_json = excluded.allocation_json
      `,
      [
        runId,
        String(item.sourceRecordId),
        item.listingId,
        nullableString(item.candidateId),
        nullableString(item.opportunityQueueId),
        item.categoryKey,
        item.familyKey,
        item.decisionStatus,
        item.qualificationStatus,
        item.allocationTier,
        item.capitalAllocationUsd,
        item.requiredCapitalUsd,
        item.expectedProfitUsd,
        item.expectedRoi,
        item.expectedDaysToSale,
        item.confidenceScore,
        item.capitalEfficiencyScore,
        item.velocityScore,
        item.allocationScore,
        item.exposureStatus,
        item.reasonCodes,
        item.riskFlags,
        JSON.stringify(item.allocationJson ?? {}),
      ],
    );
  }

  private async promoteEligibleToPurchaseQueue(
    client: PoolClient,
    runId: number,
    items: AllocatedOpportunity[],
  ): Promise<number> {
    const exists = await this.existsRelation('arb.purchase_queue', client);
    if (!exists) return 0;

    const columns = await this.getTableColumns('arb', 'purchase_queue', client);
    if (columns.size === 0) return 0;

    let writes = 0;

    for (const item of items) {
      if (!item.purchaseQueueEligible || item.capitalAllocationUsd <= 0) continue;

      const queueStatus = normalizePurchaseQueueStatus(item.purchaseQueueStatus, item.executionStatus);

      const payload: Record<string, unknown> = {
        source: 'domain2_capital_allocation',
        capital_allocation_run_id: runId,
        capital_allocation_source_record_id: String(item.sourceRecordId),
        listing_id: item.listingId,
        decision_id: item.decisionId ?? null,
        candidate_id: item.candidateId,
        opportunity_queue_id: item.opportunityQueueId,
        queue_status: queueStatus,
        status: queueStatus,
        approved_at: queueStatus === 'approved' ? new Date() : null,
        created_at: new Date(),
        updated_at: new Date(),
        required_capital_usd: item.requiredCapitalUsd,
        capital_allocation_usd: item.capitalAllocationUsd,
        expected_profit_usd: item.expectedProfitUsd,
        expected_roi: item.expectedRoi,
        priority_score: item.allocationScore,
        allocation_json: item.allocationJson,
        metadata_json: {
          allocationTier: item.allocationTier,
          executionStatus: item.executionStatus,
          purchaseQueueStatus: queueStatus,
          hardBlockReasons: item.hardBlockReasons ?? [],
          softReviewReasons: item.softReviewReasons ?? [],
          reasonCodes: item.reasonCodes,
          riskFlags: item.riskFlags,
        },
      };

      const supported = Object.entries(payload).filter(([key]) => columns.has(key));

      if (supported.length === 0) continue;

      const keys = supported.map(([key]) => key);
      const values = supported.map(([, value]) => value);
      const placeholders = keys.map((key, index) => {
        if (key.endsWith('_json')) return `$${index + 1}::jsonb`;
        return `$${index + 1}`;
      });

      const conflictTarget = this.purchaseQueueConflictTarget(columns);
      const updateSql = keys
        .filter((key) => !conflictTarget.includes(key) && key !== 'created_at')
        .map((key) => `${key} = excluded.${key}`)
        .join(', ');

      const sql = `
        insert into arb.purchase_queue (${keys.join(', ')})
        values (${placeholders.join(', ')})
        ${conflictTarget.length > 0
          ? `on conflict (${conflictTarget.join(', ')}) do update set ${updateSql || 'updated_at = now()'}`
          : ''}
      `;

      await client.query(sql, values.map((value, idx) => {
        const key = keys[idx];
        return key?.endsWith('_json') ? JSON.stringify(value ?? {}) : value;
      }));

      writes += 1;
    }

    return writes;
  }

  private purchaseQueueConflictTarget(columns: Set<string>): string[] {
    if (columns.has('decision_id')) return ['decision_id'];
    if (columns.has('listing_id')) return ['listing_id'];
    if (columns.has('source_listing_normalized_id')) return ['source_listing_normalized_id'];
    return [];
  }

  public async writeHeartbeat(workerName: string, workerInstanceId: string, status: string, details: unknown): Promise<void> {
    await this.pool.query(
      `
      insert into arb.worker_heartbeats (
        worker_name,
        worker_instance_id,
        status,
        details_json,
        last_seen_at
      )
      values ($1,$2,$3,$4::jsonb,now())
      on conflict(worker_name, worker_instance_id)
      do update set
        status = excluded.status,
        details_json = excluded.details_json,
        last_seen_at = now()
      `,
      [workerName, workerInstanceId, status, JSON.stringify(details ?? {})],
    );
  }

  public async deadLetter(input: {
    workerName: string;
    failureCode: string;
    failureMessage: string;
    payloadJson: unknown;
  }): Promise<void> {
    await this.pool.query(
      `
      insert into arb.capital_allocation_dead_letter (
        worker_name,
        failure_code,
        failure_message,
        payload_json,
        created_at
      )
      values ($1,$2,left($3,2000),$4::jsonb,now())
      `,
      [
        input.workerName,
        input.failureCode,
        input.failureMessage,
        JSON.stringify(input.payloadJson ?? {}),
      ],
    );
  }

  private async existsRelation(qualifiedName: string, client?: PoolClient): Promise<boolean> {
    const runner = client ?? this.pool;
    const result = await runner.query(`select to_regclass($1) is not null as exists`, [qualifiedName]);
    return Boolean(result.rows[0]?.exists);
  }

  private async getTableColumns(schema: string, table: string, client?: PoolClient): Promise<Set<string>> {
    const runner = client ?? this.pool;
    const result = await runner.query(
      `
      select column_name
      from information_schema.columns
      where table_schema = $1
        and table_name = $2
      `,
      [schema, table],
    );

    return new Set(result.rows.map((row) => String(row.column_name)));
  }

  private async getRelationColumns(schema: string, relation: string, client?: PoolClient): Promise<Set<string>> {
    const runner = client ?? this.pool;
    const result = await runner.query(
      `
      select column_name
      from information_schema.columns
      where table_schema = $1
        and table_name = $2
      order by ordinal_position
      `,
      [schema, relation],
    );

    return new Set(result.rows.map((row) => String(row.column_name)));
  }
}

function mapOpportunityRow(r: Record<string, unknown>, mode: AllocationMode): BuyQualifiedOpportunity {
  const executionStatus = String(r.execution_status ?? 'REVIEW_REQUIRED');
  const purchaseQueueStatus = nullableString(r.purchase_queue_status) ?? normalizePurchaseQueueStatus(null, executionStatus);

  return {
    sourceRecordId: r.source_record_id === undefined ? String(r.decision_id ?? '') : String(r.source_record_id),
    decisionId: nullableString(r.decision_id),
    listingId: nullableString(r.listing_id),
    candidateId: nullableString(r.candidate_id),
    opportunityQueueId: nullableString(r.opportunity_queue_id),
    categoryKey: nullableString(r.category_key),
    familyKey: nullableString(r.family_key),

    originalDecision: String(r.original_decision ?? r.decision_status ?? 'BUY'),
    finalDecision: String(r.final_decision ?? r.decision_status ?? 'BUY'),
    decisionStatus: String(r.decision_status ?? r.final_decision ?? r.original_decision ?? 'BUY'),
    qualificationStatus: String(r.qualification_status ?? 'BUY_QUALIFIED'),

    executionStatus,
    purchaseQueueStatus,
    capitalSafetyStatus: nullableString(r.capital_safety_status),
    livenessStatus: nullableString(r.liveness_status),
    costBasisSource: nullableString(r.cost_basis_source),

    hardBlockReasons: toStringArray(r.hard_block_reasons),
    softReviewReasons: toStringArray(r.soft_review_reasons),
    reasonCodes: toStringArray(r.reason_codes),
    riskFlags: toStringArray(r.risk_flags),

    requiredCapitalUsd: toNumber(r.required_capital_usd),
    expectedProfitUsd: toNumber(r.expected_profit_usd),
    expectedRoi: toNumber(r.expected_roi),
    expectedDaysToSale: nullableNumber(r.expected_days_to_sale),
    confidenceScore: toNumber(r.confidence_score),

    // Included in payload trace; not used directly by engine.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(mode === 'shadow' ? { modeTag: 'shadow' } as any : {}),
  };
}

function normalizeMode(value: unknown): AllocationMode {
  if (value === 'shadow' || value === 'production') return value;
  throw new Error(`Invalid capital allocation mode: ${String(value)}`);
}

function normalizePurchaseQueueStatus(value: string | null | undefined, executionStatus: string | null | undefined): PurchaseQueueStatus {
  const explicit = value?.trim().toLowerCase();
  if (explicit === 'approved' || explicit === 'bid_monitor' || explicit === 'review_required' || explicit === 'blocked' || explicit === 'not_queued') {
    return explicit;
  }

  const status = executionStatus?.trim().toUpperCase();
  if (status === 'AUTO_BUY_READY') return 'approved';
  if (status === 'BID_MONITOR_READY') return 'bid_monitor';
  if (status === 'REVIEW_REQUIRED') return 'review_required';
  if (status === 'BLOCKED' || status === 'EXPIRED' || status === 'CAPITAL_LIMIT_SKIPPED') return 'blocked';
  return 'not_queued';
}

function sanitizeLimit(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 500;
  return Math.min(Math.floor(value), 5000);
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string' && value.length > 0) return [value];
  return [];
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);

  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeys((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }

  return value;
}
