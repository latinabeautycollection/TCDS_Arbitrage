import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import crypto from 'node:crypto';
import type {
  AcquisitionCandidate,
  AcquisitionCategoryPolicy,
  AcquisitionExecutionStatus,
  PurchaseQueueStatus,
  ScoredAcquisitionDecision,
  ShippingSignal,
} from '../contracts/acquisitionDecision';
import { isPurchaseQueueEligible } from '../contracts/acquisitionDecision';

export interface LoggerLike {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  debug?(msg: string, meta?: Record<string, unknown>): void;
}

type DbValue = string | number | boolean | null | Date | string[] | Record<string, unknown> | unknown[];

type TableColumnCache = Map<string, Set<string>>;

export interface PurchaseQueueBridgeResult {
  queued: boolean;
  queueStatus: PurchaseQueueStatus;
  legacyArbitrageDecisionId: number | null;
  sourceListingNormalizedId: number | null;
  reason: string | null;
}

/**
 * Domain 1 — Acquisition Decision Repository
 * Green Tier 1 production rewrite.
 *
 * Design rules:
 * 1. Preserve the original economic BUY signal. Never mutate BUY into REVIEW.
 * 2. Persist the final allowed operational decision separately from the original decision.
 * 3. Persist hard capital blockers separately from soft review reasons.
 * 4. Insert purchase_queue rows for AUTO_BUY_READY, BID_MONITOR_READY, and REVIEW_REQUIRED.
 * 5. Block queue creation only for BLOCKED, EXPIRED, and CAPITAL_LIMIT_SKIPPED.
 * 6. Bridge UUID-based arb.decisions into the legacy INT-based arb.arbitrage_decision/purchase_queue path
 *    so existing purchase workers can still execute.
 */
export class AcquisitionDecisionRepository {
  private readonly tableColumns: TableColumnCache = new Map();

  public constructor(
    private readonly pool: Pool,
    private readonly logger: LoggerLike,
  ) {}

  public async writeHeartbeat(input: {
    workerName: string;
    workerInstanceId: string;
    status: string;
    details: Record<string, unknown>;
  }): Promise<void> {
    await this.query(
      `
      insert into arb.worker_heartbeats (
        worker_name, worker_instance_id, status, details_json, last_seen_at, updated_at
      )
      values ($1, $2, $3, $4::jsonb, now(), now())
      on conflict (worker_name, worker_instance_id)
      do update set
        status = excluded.status,
        details_json = excluded.details_json,
        last_seen_at = now(),
        updated_at = now()
      `,
      [input.workerName, input.workerInstanceId, input.status, stringifyJson(input.details)],
      'writeHeartbeat',
    );
  }

  public async getCategoryPolicy(policyVersion: string, categoryKey: string | null): Promise<AcquisitionCategoryPolicy> {
    const key = categoryKey ?? 'default';
    const result = await this.query(
      `
      select p.scoring_version, c.*
      from arb.acquisition_category_policy c
      join arb.acquisition_policy_version p on p.policy_version = c.policy_version
      where c.policy_version = $1
        and c.is_active = true
        and c.category_key in ($2, 'default')
      order by case when c.category_key = $2 then 0 else 1 end
      limit 1
      `,
      [policyVersion, key],
      'getCategoryPolicy',
    );

    const row = result.rows[0];
    if (!row) throw new Error(`No acquisition category policy found for ${policyVersion}/${key}`);

    return {
      policyVersion: String(row.policy_version),
      scoringVersion: String(row.scoring_version),
      categoryKey: String(row.category_key),
      minSoldCount: number(row.min_sold_count),
      minProfitUsd: number(row.min_profit_usd),
      minRoi: number(row.min_roi),
      maxActiveSoldRatio: number(row.max_active_sold_ratio),
      minIdentityConfidence: number(row.min_identity_confidence),
      minCompQuality: number(row.min_comp_quality),
      maxVolatility: number(row.max_volatility),
      returnRiskRate: number(row.return_risk_rate),
      damageRiskRate: number(row.damage_risk_rate),
      disputeRiskRate: number(row.dispute_risk_rate),
      marketplaceFeeRate: number(row.marketplace_fee_rate),
      paymentFeeRate: number(row.payment_fee_rate),
      salesTaxRate: numberOrDefault(row.sales_tax_rate, 0.06),
      warehouseHandlingUsd: numberOrDefault(row.warehouse_handling_usd, 2.5),
      storageReserveUsd: numberOrDefault(row.storage_reserve_usd, 1),
      packagingCostUsd: number(row.packaging_cost_usd),
      insuranceReserveRate: numberOrDefault(row.insurance_reserve_rate, 0.005),
      signatureReserveUsd: numberOrDefault(row.signature_reserve_usd, 3.5),
      carrierRiskRate: numberOrDefault(row.carrier_risk_rate, 0.01),
      shippingBufferUsd: number(row.shipping_buffer_usd),
      maxItemCapitalPct: number(row.max_item_capital_pct),
      maxCategoryCapitalPct: numberOrDefault(row.max_category_capital_pct, 0.35),
      maxFamilyCapitalPct: numberOrDefault(row.max_family_capital_pct, 0.2),
      cashReservePct: numberOrDefault(row.cash_reserve_pct, 0.15),
      highProfitReviewMultiplier: numberOrDefault(row.high_profit_review_multiplier, 4),
      minSafetyScoreForBuy: numberOrDefault(row.min_safety_score_for_buy, 0.7),
      categoryRankWeight: number(row.category_rank_weight),
      minAcceptedCompsForAutoBuy: numberOrUndefined(row.min_accepted_comps_for_auto_buy),
      minAcceptedCompsForReview: numberOrUndefined(row.min_accepted_comps_for_review),
      minCompGroundingScoreForAutoBuy: numberOrUndefined(row.min_comp_grounding_score_for_auto_buy),
      minCompGroundingScoreForReview: numberOrUndefined(row.min_comp_grounding_score_for_review),
      allowBidMonitorForAuctions: booleanOrUndefined(row.allow_bid_monitor_for_auctions),
      allowReviewQueueForSoftBlocks: booleanOrUndefined(row.allow_review_queue_for_soft_blocks),
      allowPurchaseQueueForReviewRequired: booleanOrUndefined(row.allow_purchase_queue_for_review_required),
    };
  }

  public async claimOpportunityBatch(input: {
    workerId: string;
    batchSize: number;
    claimTtlSeconds: number;
    maxAttempts: number;
    workerName?: string;
  }): Promise<AcquisitionCandidate[]> {
    const processRunId = crypto.randomUUID();
    const result = await this.withTransaction('claimOpportunityBatch', async (client) => {
      await client.query(
        `insert into arb.process_runs (run_id, process_name, status, actor_type, worker_name, worker_instance_id) values ($1::uuid,'acquisition_decision_engine','STARTED','worker','acquisition-decision-worker',$2) on conflict (run_id) do nothing`,
        [processRunId, workerInstanceId()],
      );
      const claimed = await client.query(
        `
        with claimable as (
          select oq.id
          from arb.opportunity_queue oq
          join arb.candidates c on c.id = oq.candidate_id
          join arb.listings l on l.id = c.listing_id
          where oq.status in ('queued', 'retry_needed')
            and (
              (oq.reason_json->>'process_claim_expires_at') is null
              or (oq.reason_json->>'process_claim_expires_at')::timestamptz < now()
            )
            and coalesce(c.process_attempts, 0) < $4
            and coalesce(l.end_time, now() + interval '1 day') > now()
          order by oq.priority_score desc nulls last, oq.created_at asc, oq.id asc
          limit $1
          for update skip locked
        )
        update arb.opportunity_queue oq
        set process_name = 'acquisition_decision_engine',
            process_run_id = $5::uuid,
            actor_type = 'worker',
            actor_id = $2,
            actor_name = coalesce(oq.actor_name, $2),
            phase_summary_current = 'Domain 1 acquisition decision scoring in progress',
            reason_json = coalesce(oq.reason_json, '{}'::jsonb) || jsonb_build_object('process_claimed_at', now(), 'process_claim_expires_at', now() + make_interval(secs => $3::int), 'process_run_id', $5::text),
            updated_at = now()
        from claimable c
        where oq.id = c.id
        returning oq.id
        `,
        [positiveInt(input.batchSize, 'batchSize'), input.workerId, positiveInt(input.claimTtlSeconds, 'claimTtlSeconds'), positiveInt(input.maxAttempts, 'maxAttempts'), processRunId],
      );

      for (const row of claimed.rows) {
        await client.query(
          `
          insert into arb.entity_claim_ledger (
            entity_type, entity_pk, process_name, process_run_id, claim_token, claimed_by,
            claimed_at, claim_expires_at, attempts_before, attempts_after, lock_reclaimed, details_json
          ) values (
            'opportunity_queue', $1, 'acquisition_decision_engine', $2::uuid, gen_random_uuid(), $3,
            now(), now() + make_interval(secs => $4::int), null, null, false, $5::jsonb
          )
          `,
          [String(row.id), processRunId, input.workerId, input.claimTtlSeconds, stringifyJson({ workerName: input.workerName ?? 'acquisition-decision-worker' })],
        );
      }

      return claimed;
    });

    if ((result.rowCount ?? 0) === 0) return [];

    const ids = result.rows.map((row) => number(row.id));
    const hydrated = await this.query(
      `
      select
        oq.id as opportunity_queue_id,
        oq.candidate_id,
        oq.watchlist_id,
        oq.reason_json,
        oq.priority_score,
        oq.process_run_id,
        c.listing_id,
        c.title as candidate_title,
        c.normalized_title as candidate_normalized_title,
        c.brand as candidate_brand,
        c.model as candidate_model,
        c.source_category_key as candidate_category_key,
        c.current_price as candidate_current_price,
        c.inbound_shipping_usd as candidate_inbound_shipping_usd,
        c.identity_json as candidate_identity_json,
        c.identity_confidence as candidate_identity_confidence,
        l.title,
        l.normalized_title,
        l.description_raw,
        l.description_clean,
        l.brand,
        l.model,
        l.variant,
        coalesce(l.category_key, l.category_id, c.source_category_key) as category_key,
        l.condition_text,
        l.current_price,
        l.current_bid_price,
        l.buy_now_price,
        l.inbound_shipping_usd,
        l.inbound_tax_usd,
        l.inbound_fees_usd,
        l.signals,
        l.status as listing_status,
        l.end_time,
        l.last_seen_at,
        pw.id as pw_id,
        pw.activation_reason_json as watchlist_json,
        pw.identity_json as watchlist_identity_json,
        em.sold_sample_json,
        em.active_sample_json,
        em.sold_prices_json,
        em.active_prices_json,
        em.sold_30d,
        em.active_count,
        em.median_sold_price,
        em.p25_sold_price,
        em.p75_sold_price,
        em.median_active_price,
        em.resale_anchor_price,
        em.liquidity_ratio
      from arb.opportunity_queue oq
      join arb.candidates c on c.id = oq.candidate_id
      join arb.listings l on l.id = c.listing_id
      left join arb.product_watchlist pw on pw.id = oq.watchlist_id
      left join arb.ebay_market em on em.listing_id = l.id
      where oq.id = any($1::bigint[])
      order by oq.priority_score desc nulls last, oq.created_at asc, oq.id asc
      `,
      [ids],
      'hydrateClaimedOpportunities',
    );

    return hydrated.rows.map(rowToCandidate);
  }

  public async getLatestShippingSignal(listingId: string): Promise<Partial<ShippingSignal> | null> {
    const fromEvidence = await this.query(
      `
      select carrier_code, service_code, service_name, quoted_label_cost_usd, on_time_probability,
             tracking_quality_score, claim_risk_score, payload_json, process_run_id, created_at
      from arb.shipping_evidence
      where entity_pk = $1
        and entity_type in ('listing', 'arb.listings', 'acquisition_listing')
        and quoted_label_cost_usd is not null
        and quoted_label_cost_usd > 0
      order by
        case when lower(coalesce(payload_json->>'source', payload_json->>'provider', '')) like '%shipengine%' then 0 else 1 end,
        created_at desc
      limit 1
      `,
      [listingId],
      'getLatestShippingSignalFromEvidence',
    );

    if ((fromEvidence.rowCount ?? 0) > 0) {
      const row = fromEvidence.rows[0]!;
      const payload = parseJsonObject(row.payload_json);
      const provider = String(payload.source ?? payload.provider ?? '').toLowerCase();
      const requestId = stringOrNull(payload.shipengine_request_id ?? payload.request_id ?? row.process_run_id);
      const riskFlags: string[] = [];
      if (!requestId) riskFlags.push('SHIPENGINE_REQUEST_ID_MISSING');
      if (numberOrDefault(row.claim_risk_score, 0) > 0.50) riskFlags.push('HIGH_CARRIER_CLAIM_RISK');
      if (numberOrDefault(row.on_time_probability, 1) < 0.80) riskFlags.push('LOW_ON_TIME_PROBABILITY');

      return {
        source: provider.includes('shipengine') ? 'shipengine' : 'direct_carrier',
        outboundShippingUsd: number(row.quoted_label_cost_usd),
        confidence: clamp(0.65 + numberOrDefault(row.tracking_quality_score, 0.75) * 0.20 + numberOrDefault(row.on_time_probability, 0.80) * 0.15 - numberOrDefault(row.claim_risk_score, 0) * 0.10, 0, 0.98),
        carrierCode: stringOrNull(row.carrier_code),
        serviceCode: stringOrNull(row.service_code),
        requestId,
        riskFlags,
      };
    }

    return {
      source: 'missing',
      outboundShippingUsd: undefined,
      confidence: 0,
      carrierCode: null,
      serviceCode: null,
      requestId: null,
      riskFlags: ['SHIPPING_SIGNAL_MISSING_FOR_LISTING'],
    };
  }

  public async persistDecisionBatch(decisions: ScoredAcquisitionDecision[]): Promise<void> {
    if (decisions.length === 0) return;

    await this.withTransaction('persistDecisionBatch', async (client) => {
      for (const runId of new Set(decisions.map((d) => d.portfolioBatchId))) {
        await client.query(
          `insert into arb.process_runs (run_id, process_name, status, actor_type, worker_name, worker_instance_id) values ($1::uuid,'acquisition_decision_engine','STARTED','worker','acquisition-decision-worker',$2) on conflict (run_id) do nothing`,
          [runId, workerInstanceId()],
        );
      }
      for (const decision of decisions) {
        const decisionJson = buildDecisionJson(decision);
        const decisionId = await this.upsertDecision(client, decision, decisionJson);
        await this.persistEvidenceAndAudit(client, decision, decisionId, decisionJson);
        const bridgeResult = await this.bridgePurchaseQueueIfEligible(client, decision, decisionId, decisionJson);
        await this.persistLifecycleState(client, decision, decisionId, bridgeResult, decisionJson);
      }
    });
  }

  public async markOpportunityRetry(input: {
    opportunityQueueId: number;
    errorMessage: string;
    workerId: string;
  }): Promise<void> {
    await this.query(
      `
      update arb.opportunity_queue
      set status = 'queued',
          phase_summary_current = $2,
          actor_type = 'worker',
          actor_id = $3,
          reason_json = coalesce(reason_json, '{}'::jsonb) || jsonb_build_object('executionStatus', 'ERROR_RETRY_NEEDED', 'last_error', $2, 'process_claim_expires_at', to_jsonb(now() - interval '1 second')),
          updated_at = now()
      where id = $1
      `,
      [input.opportunityQueueId, truncate(input.errorMessage, 900), input.workerId],
      'markOpportunityRetry',
    );
  }

  public async insertDeadLetter(input: {
    queueName: string;
    entityType: string;
    entityPk: string;
    workerName: string;
    workerInstanceId: string;
    errorCode: string;
    errorMessage: string;
    payload: Record<string, unknown>;
    processRunId?: string | null;
    retryCount?: number;
  }): Promise<void> {
    await this.query(
      `
      insert into arb.dead_letter (
        process_run_id, process_step_id, queue_name, job_id, entity_type, entity_pk,
        worker_name, worker_instance_id, error_code, error_message, stack_trace, payload_json,
        retry_count, created_at
      ) values (
        $1::uuid, null, $2, null, $3, $4, $5, $6, $7, $8, null, $9::jsonb, $10, now()
      )
      `,
      [input.processRunId ?? null, input.queueName, input.entityType, input.entityPk, input.workerName, input.workerInstanceId, input.errorCode, truncate(input.errorMessage, 2000), stringifyJson(input.payload), input.retryCount ?? 0],
      'insertDeadLetter',
    );
  }

  private async upsertDecision(client: PoolClient, d: ScoredAcquisitionDecision, decisionJson: Record<string, unknown>): Promise<string | null> {
    const original = d.originalRules ?? d.rules;
    const final = d.finalRules ?? d.rules;
    const capitalJson = buildCapitalSafetyJson(d);
    const packageClass = process.env.ACQ_DEFAULT_PACKAGE_CLASS?.trim() || 'standard';

    const baseValues: Record<string, DbValue> = {
      listing_id: d.candidate.listingId,
      decision: original.status,
      package: packageClass,
      expected_net_profit: d.financial.estimatedProfitUsd,
      expected_roi: d.financial.estimatedRoi,
      max_bid: d.financial.maxBidUsd,
      risk_flags: final.riskFlags,
      reason_codes: final.reasonCodes,
      computed_at: new Date(),
      created_at: new Date(),
      updated_at: new Date(),
      confidence: final.confidenceBand,
      expected_resale_usd: d.financial.expectedResaleUsd,
      expected_net_usd: d.financial.expectedNetUsd,
      estimated_profit_usd: d.financial.estimatedProfitUsd,
      estimated_roi: d.financial.estimatedRoi,
      max_bid_usd: d.financial.maxBidUsd,
      reasons_json: {
        originalDecision: original.status,
        finalAllowedDecision: final.allowedDecision,
        executionStatus: d.executionStatus,
        purchaseQueueStatus: d.purchaseQueueStatus,
        reasonCodes: final.reasonCodes,
        originalReasonCodes: original.reasonCodes,
        hardBlockReasons: d.safety.hardBlockReasons,
        softReviewReasons: d.safety.softReviewReasons,
      },
      risk_flags_json: { riskFlags: final.riskFlags, originalRiskFlags: original.riskFlags },
      correlation_id: d.correlationId,
      phase_summary_current: summarizeDecision(d),
      process_name: 'acquisition_decision_engine',
      process_stage: 'persist_decision',
      process_run_id: d.portfolioBatchId,
      actor_type: 'worker',
      actor_id: workerInstanceId(),
      actor_name: workerInstanceId(),
      code_version: process.env.ACQ_CODE_VERSION?.trim() || 'acq-domain1-green-tier-repository-v2',
      ruleset_version: d.policy.policyVersion,
      model_version: d.policy.scoringVersion,
      decision_at: new Date(),
      current_propertyroom_bid: d.candidate.currentBidPrice ?? d.candidate.currentPrice ?? d.candidate.buyNowPrice,
      estimated_purchase_price: d.financial.estimatedPurchasePriceUsd,
      purchase_price_basis: d.financial.purchasePriceBasis,
      purchase_price_inputs_json: {
        currentPrice: d.candidate.currentPrice,
        currentBidPrice: d.candidate.currentBidPrice,
        buyNowPrice: d.candidate.buyNowPrice,
        inboundShippingUsd: d.candidate.inboundShippingUsd,
      },
      source_price_snapshot_at: new Date(),
      expected_total_cost_basis_usd: d.financial.deployableCapitalUsd,
      canonical_source: 'propertyroom',
      capital_safe: d.safety.status === 'PASS',
      capital_block_reason_json: capitalJson,
      shipping_class: inferShippingClass(d),
      outbound_shipping_usd: d.financial.shippingEstimateUsd,
      packaging_cost_usd: (d.financial.packagingCostUsd ?? 0),
      insurance_reserve_usd: d.financial.insuranceReserveUsd,
      signature_reserve_usd: d.financial.signatureReserveUsd,
      return_reserve_usd: d.financial.returnReserveUsd,
      dispute_reserve_usd: d.financial.disputeReserveUsd,
      damage_reserve_usd: d.financial.damageReserveUsd,
      shipping_risk_score: shippingRiskScore(d),
      shipping_confidence_score: d.financial.shippingSignal.confidence,
      description_quality_score: descriptionQualityScore(d),
      return_probability: d.policy.returnRiskRate,
      dispute_probability: d.policy.disputeRiskRate,
      return_risk_score: returnRiskScore(d),
      defensibility_score: defensibilityScore(d),
      seller_protection_score: sellerProtectionScore(d),
      execution_integrity_score: executionIntegrityScore(d),
      forensic_required_json: requiredForensicEvidence(d),
      forensic_missing_json: missingForensicEvidence(d),

      // Forward-compatible columns, inserted only when migrations exist.
      opportunity_queue_id: d.candidate.opportunityQueueId,
      candidate_id: d.candidate.candidateId,
      policy_version: d.policy.policyVersion,
      scoring_version: d.policy.scoringVersion,
      decision_status: original.status,
      original_decision_status: original.status,
      final_allowed_decision: final.allowedDecision,
      capital_status: d.safety.status,
      execution_status: d.executionStatus,
      purchase_queue_status: d.purchaseQueueStatus,
      hard_block_reasons: d.safety.hardBlockReasons,
      soft_review_reasons: d.safety.softReviewReasons,
      decision_rank: final.rank,
      aggressive_resale_usd: d.financial.aggressiveResaleUsd,
      conservative_resale_usd: d.financial.conservativeResaleUsd,
      fees_estimate_usd: d.financial.feesEstimateUsd,
      shipping_estimate_usd: d.financial.shippingEstimateUsd,
      tax_estimate_usd: d.financial.taxEstimateUsd,
      warehouse_handling_usd: d.financial.warehouseHandlingUsd,
      storage_reserve_usd: d.financial.storageReserveUsd,
      carrier_risk_reserve_usd: d.financial.carrierRiskReserveUsd,
      risk_reserve_usd: d.financial.riskReserveUsd,
      shipping_signal_json: d.financial.shippingSignal as unknown as DbValue,
      safety_json: d.safety as unknown as DbValue,
      family_key: d.identity.familyKey,
      confidence_score: final.confidenceScore,
      risk_score: final.riskScore,
      priority_score: final.priorityScore,
      allocation_position: d.allocationPosition,
      portfolio_batch_id: d.portfolioBatchId,
      deployable_units: d.financial.deployableUnits,
      deployable_capital_usd: d.financial.deployableCapitalUsd,
      deployable_profit_usd: d.financial.deployableProfitUsd,
      capital_efficiency: d.financial.capitalEfficiency,
      velocity_efficiency: d.financial.velocityEfficiency,
      cash_turn_profit: d.financial.cashTurnProfit,
      sold_comp_count: d.market.soldCount,
      active_comp_count: d.market.activeCount,
      explanation_summary: final.explanationSummary,
      acquisition_input_hash: d.inputHash,
      decision_json: decisionJson,
      decided_at: new Date(),
    };

    const result = await this.insertOrUpdateDynamic(client, 'decisions', baseValues, ['listing_id'], ['id']);
    return stringOrNull(result.rows[0]?.id);
  }

  private async bridgePurchaseQueueIfEligible(client: PoolClient, d: ScoredAcquisitionDecision, decisionId: string | null, decisionJson: Record<string, unknown>): Promise<PurchaseQueueBridgeResult> {
    const executionStatus = d.executionStatus;
    const purchaseQueueStatus = d.purchaseQueueStatus;

    if (!isExecutionQueueEligible(executionStatus, purchaseQueueStatus)) {
      return {
        queued: false,
        queueStatus: purchaseQueueStatus,
        legacyArbitrageDecisionId: null,
        sourceListingNormalizedId: null,
        reason: `Execution status ${executionStatus} is not purchase-queue eligible`,
      };
    }

    const sourceListingNormalizedId = await this.resolveSourceListingNormalizedId(client, d.candidate.listingId);
    if (sourceListingNormalizedId === null) {
      this.logger.warn('Cannot bridge BUY to purchase_queue because source_listing_normalized_id was not resolved', {
        listingId: d.candidate.listingId,
        decisionId,
        executionStatus,
        purchaseQueueStatus,
      });
      return {
        queued: false,
        queueStatus: purchaseQueueStatus,
        legacyArbitrageDecisionId: null,
        sourceListingNormalizedId: null,
        reason: 'SOURCE_LISTING_NORMALIZED_ID_NOT_FOUND',
      };
    }

    const legacyDecisionId = await this.upsertLegacyArbitrageDecision(client, d, sourceListingNormalizedId, decisionJson);
    await this.upsertPurchaseQueue(client, d, sourceListingNormalizedId, legacyDecisionId, decisionId);

    return {
      queued: true,
      queueStatus: purchaseQueueStatus,
      legacyArbitrageDecisionId: legacyDecisionId,
      sourceListingNormalizedId,
      reason: null,
    };
  }

  private async resolveSourceListingNormalizedId(client: PoolClient, listingId: string): Promise<number | null> {
    const result = await client.query(
      `
      select ln.id
      from arb.listings l
      join arb.listing_normalized ln on ln.listing_external_id = l.listing_external_id
      where l.id = $1::uuid
      order by ln.updated_at desc nulls last, ln.id desc
      limit 1
      `,
      [listingId],
    );
    return numberOrNull(result.rows[0]?.id);
  }

  private async upsertLegacyArbitrageDecision(client: PoolClient, d: ScoredAcquisitionDecision, sourceListingNormalizedId: number, decisionJson: Record<string, unknown>): Promise<number> {
    const final = d.finalRules ?? d.rules;
    const result = await client.query(
      `
      insert into arb.arbitrage_decision (
        source_listing_normalized_id,
        comp_set_id,
        run_id,
        acquisition_price,
        inbound_shipping_usd,
        expected_sale_price,
        expected_buyer_shipping_usd,
        ebay_fee_usd,
        payment_fee_usd,
        packaging_cost_usd,
        handling_cost_usd,
        expected_return_reserve_usd,
        total_cost_basis_usd,
        expected_profit_usd,
        roi_pct,
        expected_days_to_sell,
        sell_through_rate,
        risk_score,
        risk_flags,
        policy_version,
        decision,
        decision_reason,
        created_at
      ) values (
        $1, null, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11,
        $12, $13, $14, $15, $16, $17, $18::jsonb, $19, $20, $21, now()
      )
      returning id
      `,
      [
        sourceListingNormalizedId,
        d.portfolioBatchId,
        d.financial.estimatedPurchasePriceUsd,
        d.candidate.inboundShippingUsd ?? d.financial.shippingEstimateUsd,
        d.financial.expectedResaleUsd ?? 0,
        d.financial.shippingEstimateUsd,
        marketplaceFeeUsd(d),
        paymentFeeUsd(d),
        (d.financial.packagingCostUsd ?? 0),
        d.financial.warehouseHandlingUsd,
        d.financial.returnReserveUsd,
        d.financial.deployableCapitalUsd,
        d.financial.estimatedProfitUsd ?? 0,
        d.financial.estimatedRoi ?? 0,
        d.market.estimatedDaysToSale,
        d.market.sellThroughRate,
        final.riskScore,
        stringifyJson({
          riskFlags: final.riskFlags,
          executionStatus: d.executionStatus,
          purchaseQueueStatus: d.purchaseQueueStatus,
          hardBlockReasons: d.safety.hardBlockReasons,
          softReviewReasons: d.safety.softReviewReasons,
          decisionJson,
        }),
        d.policy.policyVersion,
        d.originalRules.status,
        summarizeDecision(d),
      ],
    );
    return number(result.rows[0]?.id);
  }

  private async upsertPurchaseQueue(client: PoolClient, d: ScoredAcquisitionDecision, sourceListingNormalizedId: number, legacyDecisionId: number, decisionId: string | null): Promise<void> {
    const queueStatus = mapPurchaseQueueStatusForDb(d.purchaseQueueStatus);
    await client.query(
      `
      insert into arb.purchase_queue (
        source_listing_normalized_id,
        arbitrage_decision_id,
        queue_status,
        priority_score,
        approved_by,
        approved_at,
        purchased_at,
        notes,
        created_at,
        process_name,
        process_run_id,
        actor_type,
        actor_id,
        actor_name,
        phase_summary_current
      ) values (
        $1, $2, $3, $4, $5, $6, null, $7, now(),
        'acquisition_decision_repository', $8::uuid, 'worker', $9, $9, $10
      )
      on conflict do nothing
      `,
      [
        sourceListingNormalizedId,
        legacyDecisionId,
        queueStatus,
        d.finalRules.priorityScore,
        queueStatus === 'approved' ? 'system' : null,
        queueStatus === 'approved' ? new Date() : null,
        buildQueueNotes(d, decisionId),
        d.portfolioBatchId,
        workerInstanceId(),
        summarizeDecision(d),
      ],
    );
  }

  private async persistEvidenceAndAudit(client: PoolClient, d: ScoredAcquisitionDecision, decisionId: string | null, decisionJson: Record<string, unknown>): Promise<void> {
    await this.safeInsertDynamic(client, 'acquisition_identity_evidence', {
      listing_id: d.candidate.listingId,
      opportunity_queue_id: d.candidate.opportunityQueueId,
      candidate_id: d.candidate.candidateId,
      policy_version: d.policy.policyVersion,
      correlation_id: d.correlationId,
      normalized_identity_json: d.identity as unknown as DbValue,
      identity_confidence: d.identity.identityConfidence,
      ambiguity_flags: d.identity.ambiguityFlags,
    });

    await this.safeInsertDynamic(client, 'acquisition_comp_evidence', {
      listing_id: d.candidate.listingId,
      opportunity_queue_id: d.candidate.opportunityQueueId,
      candidate_id: d.candidate.candidateId,
      policy_version: d.policy.policyVersion,
      correlation_id: d.correlationId,
      sold_comp_count: d.market.soldCount,
      active_comp_count: d.market.activeCount,
      accepted_comp_count: d.comps.acceptedComps.length,
      rejected_comp_count: d.comps.rejectedComps.length,
      outlier_count: d.comps.outlierCount,
      comp_quality_score: d.comps.compQualityScore,
      market_profile_json: d.market as unknown as DbValue,
      accepted_comps_json: d.comps.acceptedComps.slice(0, 50),
      rejected_comps_json: d.comps.rejectedComps.slice(0, 50),
    });

    await this.safeInsertDynamic(client, 'acquisition_decision_audit', {
      listing_id: d.candidate.listingId,
      opportunity_queue_id: d.candidate.opportunityQueueId,
      candidate_id: d.candidate.candidateId,
      decision_status: d.originalRules.status,
      original_decision_status: d.originalRules.status,
      final_allowed_decision: d.finalRules.allowedDecision,
      capital_status: d.safety.status,
      execution_status: d.executionStatus,
      purchase_queue_status: d.purchaseQueueStatus,
      policy_version: d.policy.policyVersion,
      scoring_version: d.policy.scoringVersion,
      correlation_id: d.correlationId,
      input_hash: d.inputHash,
      reason_codes: d.finalRules.reasonCodes,
      risk_flags: d.finalRules.riskFlags,
      hard_block_reasons: d.safety.hardBlockReasons,
      soft_review_reasons: d.safety.softReviewReasons,
      decision_json: decisionJson,
    });

    const forensicResult = await this.safeInsertDynamic(client, 'forensic_events', {
      process_run_id: d.portfolioBatchId,
      process_step_id: null,
      correlation_id: d.correlationId,
      causation_id: null,
      entity_type: 'listing',
      entity_pk: d.candidate.listingId,
      event_type: 'ACQUISITION_DECISION',
      action_type: 'UPSERT_DECISION',
      actor_type: 'worker',
      actor_id: workerInstanceId(),
      actor_name: workerInstanceId(),
      worker_name: 'acquisition-decision-worker',
      worker_instance_id: workerInstanceId(),
      source_table: 'arb.decisions',
      source_pk: decisionId,
      queue_name: 'opportunity_queue',
      job_id: String(d.candidate.opportunityQueueId),
      idempotency_key: d.inputHash,
      before_json: null,
      after_json: decisionJson,
      diff_json: {},
      evidence_json: {
        originalDecision: d.originalRules.status,
        finalAllowedDecision: d.finalRules.allowedDecision,
        capitalStatus: d.safety.status,
        executionStatus: d.executionStatus,
        purchaseQueueStatus: d.purchaseQueueStatus,
      },
      metrics_json: { priorityScore: d.finalRules.priorityScore, profit: d.financial.estimatedProfitUsd, roi: d.financial.estimatedRoi },
      flags_json: { reasonCodes: d.finalRules.reasonCodes, riskFlags: d.finalRules.riskFlags },
      prev_hash: null,
      event_hash: d.inputHash,
      event_at: new Date(),
      created_at: new Date(),
    });

    const forensicEventId = numberOrNull(forensicResult?.rows[0]?.id);
    await this.safeInsertDynamic(client, 'pricing_evidence', {
      process_run_id: d.portfolioBatchId,
      process_step_id: null,
      forensic_event_id: forensicEventId,
      entity_type: 'listing',
      entity_pk: d.candidate.listingId,
      candidate_id: d.candidate.candidateId,
      decision_id: decisionId,
      price_type: 'acquisition_decision',
      amount_usd: d.financial.expectedResaleUsd,
      ebay_fee_usd: marketplaceFeeUsd(d),
      payment_fee_usd: paymentFeeUsd(d),
      shipping_usd: d.financial.shippingEstimateUsd,
      total_cost_basis_usd: d.financial.deployableCapitalUsd,
      expected_profit_usd: d.financial.estimatedProfitUsd,
      roi_pct: d.financial.estimatedRoi,
      margin_pct: marginPct(d),
      payload_json: decisionJson,
      created_at: new Date(),
    });
  }

  private async persistLifecycleState(client: PoolClient, d: ScoredAcquisitionDecision, decisionId: string | null, bridge: PurchaseQueueBridgeResult, decisionJson: Record<string, unknown>): Promise<void> {
    const opportunityStatus = mapOpportunityStatus(d.executionStatus, bridge.queued);
    const reasonExecutionStatus = mapReasonExecutionStatus(d.executionStatus, bridge.queued);
    await client.query(
      `
      update arb.opportunity_queue
      set status = $2,
          phase_summary_current = $3,
          process_name = 'acquisition_decision_engine',
          process_run_id = $4::uuid,
          actor_type = 'worker',
          actor_id = $5,
          actor_name = $5,
          reason_json = coalesce(reason_json, '{}'::jsonb) || jsonb_build_object('executionStatus', $6::text, 'decisionId', $7::text, 'processed_at', now()),
          updated_at = now()
      where id = $1
      `,
      [d.candidate.opportunityQueueId, opportunityStatus, summarizeDecision(d), d.portfolioBatchId, workerInstanceId(), reasonExecutionStatus, decisionId],
    );

    if (d.candidate.candidateId !== null) {
      await client.query(
        `
        update arb.candidates
        set status = $2,
            phase_summary_current = $3,
            last_process_name = 'acquisition_decision_engine',
            last_process_stage = $4,
            last_process_run_id = $5::uuid,
            last_actor_type = 'worker',
            last_actor_id = $6,
            last_actor_name = $6,
            updated_at = now()
        where id = $1
        `,
        [d.candidate.candidateId, mapCandidateStatus(d), summarizeDecision(d), d.executionStatus, d.portfolioBatchId, workerInstanceId()],
      );
    }

    await this.safeInsertDynamic(client, 'product_journal', {
      entity_type: 'listing',
      entity_pk: d.candidate.listingId,
      listing_id: d.candidate.listingId,
      candidate_id: d.candidate.candidateId,
      watchlist_id: d.candidate.watchlistId,
      event_type: 'ACQUISITION_DECISION_PERSISTED',
      process_name: 'acquisition_decision_engine',
      process_stage: d.executionStatus,
      process_run_id: d.portfolioBatchId,
      correlation_id: d.correlationId,
      actor_type: 'worker',
      actor_id: workerInstanceId(),
      actor_name: workerInstanceId(),
      worker_name: 'acquisition-decision-worker',
      worker_instance_id: workerInstanceId(),
      code_version: process.env.ACQ_CODE_VERSION?.trim() || 'acq-domain1-green-tier-repository-v2',
      ruleset_version: d.policy.policyVersion,
      model_version: d.policy.scoringVersion,
      decision_code: d.originalRules.status,
      reason_codes: d.finalRules.reasonCodes,
      risk_flags: d.finalRules.riskFlags,
      event_summary: summarizeDecision(d),
      event_details_json: { ...decisionJson, bridge, decisionId },
      event_at: new Date(),
      created_at: new Date(),
    });
  }

  private async insertOrUpdateDynamic(client: PoolClient, tableName: string, values: Record<string, DbValue>, conflictColumns: string[], returningColumns: string[] = []): Promise<QueryResult<QueryResultRow>> {
    const columns = await this.getTableColumns(client, tableName);
    const filtered = Object.entries(values).filter(([column]) => columns.has(column));
    if (filtered.length === 0) throw new Error(`No insertable columns found for arb.${tableName}`);

    const names = filtered.map(([name]) => name);
    const params = filtered.map(([name, value]) => toDbValue(name, value));
    const placeholders = names.map((name, index) => castPlaceholder(name, index + 1));
    const updateColumns = names.filter((name) => !conflictColumns.includes(name) && name !== 'created_at' && name !== 'id');
    const returning = returningColumns.filter((column) => columns.has(column));

    const sql = `
      insert into arb.${tableName} (${names.map(quoteIdent).join(', ')})
      values (${placeholders.join(', ')})
      on conflict (${conflictColumns.map(quoteIdent).join(', ')})
      do update set ${updateColumns.map((name) => `${quoteIdent(name)} = excluded.${quoteIdent(name)}`).join(', ')}
      ${returning.length > 0 ? `returning ${returning.map(quoteIdent).join(', ')}` : ''}
    `;

    return client.query(sql, params);
  }

  private async safeInsertDynamic(client: PoolClient, tableName: string, values: Record<string, DbValue>): Promise<QueryResult<QueryResultRow> | null> {
    const exists = await this.tableExists(client, tableName);
    if (!exists) return null;

    const columns = await this.getTableColumns(client, tableName);
    const filtered = Object.entries(values).filter(([column]) => columns.has(column));
    if (filtered.length === 0) return null;

    const names = filtered.map(([name]) => name);
    const params = filtered.map(([name, value]) => toDbValue(name, value));
    const placeholders = names.map((name, index) => castPlaceholder(name, index + 1));
    const returning = columns.has('id') ? 'returning id' : '';

        await client.query('savepoint sp_safe_insert');
    try {
      const res = await client.query(
        `insert into arb.${tableName} (${names.map(quoteIdent).join(', ')}) values (${placeholders.join(', ')}) ${returning}`,
        params,
      );
      await client.query('release savepoint sp_safe_insert');
      return res;
    } catch (error) {
      await client.query('rollback to savepoint sp_safe_insert');
      this.logger.debug?.(`Optional audit insert skipped for arb.${tableName}`, { error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }

  private async tableExists(client: PoolClient, tableName: string): Promise<boolean> {
    const result = await client.query(
      `select 1 from information_schema.tables where table_schema = 'arb' and table_name = $1 limit 1`,
      [tableName],
    );
    return (result.rowCount ?? 0) > 0;
  }

  private async getTableColumns(client: PoolClient, tableName: string): Promise<Set<string>> {
    const cached = this.tableColumns.get(tableName);
    if (cached) return cached;

    const result = await client.query(
      `select column_name from information_schema.columns where table_schema = 'arb' and table_name = $1`,
      [tableName],
    );
    const columns = new Set(result.rows.map((row) => String(row.column_name)));
    this.tableColumns.set(tableName, columns);
    return columns;
  }

  private async query<TRow extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[], label: string): Promise<QueryResult<TRow>> {
    try {
      return await this.pool.query<TRow>(sql, params);
    } catch (error) {
      this.logger.error(`AcquisitionDecisionRepository query failed: ${label}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async withTransaction<T>(label: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await fn(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      this.logger.error(`AcquisitionDecisionRepository transaction failed: ${label}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      client.release();
    }
  }
}

export function hashAcquisitionInput(value: unknown): string {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function mergeCompPrices(sample: unknown, prices: unknown): unknown {
  if (!Array.isArray(sample)) return sample;
  const priceArr = Array.isArray(prices) ? prices : [];
  return sample.map((item, i) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? { ...(item as Record<string, unknown>), price: (item as Record<string, unknown>).price ?? priceArr[i] ?? null }
      : item,
  );
}


function rowToCandidate(row: QueryResultRow): AcquisitionCandidate {
  const title = stringOrNull(row.title) ?? stringOrNull(row.candidate_title) ?? 'Untitled acquisition candidate';
  const description = stringOrNull(row.description_clean) ?? stringOrNull(row.description_raw);
  return {
    opportunityQueueId: number(row.opportunity_queue_id),
    candidateId: numberOrNull(row.candidate_id),
    listingId: String(row.listing_id),
    watchlistId: numberOrNull(row.watchlist_id),
    title,
    normalizedTitle: stringOrNull(row.normalized_title) ?? stringOrNull(row.candidate_normalized_title),
    description,
    brand: stringOrNull(row.brand) ?? stringOrNull(row.candidate_brand),
    model: stringOrNull(row.model) ?? stringOrNull(row.candidate_model),
    categoryKey: stringOrNull(row.category_key) ?? stringOrNull(row.candidate_category_key),
    conditionText: stringOrNull(row.condition_text),
    currentPrice: numberOrNull(row.current_bid_price ?? row.current_price ?? row.candidate_current_price),
    currentBidPrice: numberOrNull(row.current_bid_price),
    buyNowPrice: numberOrNull(row.buy_now_price),
    inboundShippingUsd: numberOrNull(row.inbound_shipping_usd ?? row.candidate_inbound_shipping_usd),
    quantityAvailable: 1,
    opportunityReasonJson: parseJsonObject(row.reason_json),
    watchlistJson: parseJsonObject(row.watchlist_json),
    ebayMarketJson: {
            soldSample: mergeCompPrices(parseJson(row.sold_sample_json), parseJson(row.sold_prices_json)),
      activeSample: mergeCompPrices(parseJson(row.active_sample_json), parseJson(row.active_prices_json)),
      soldPrices: parseJson(row.sold_prices_json),
      activePrices: parseJson(row.active_prices_json),
      sold30d: numberOrNull(row.sold_30d),
      activeCount: numberOrNull(row.active_count),
      medianSoldPrice: numberOrNull(row.median_sold_price),
      p25SoldPrice: numberOrNull(row.p25_sold_price),
      p75SoldPrice: numberOrNull(row.p75_sold_price),
      medianActivePrice: numberOrNull(row.median_active_price),
      resaleAnchorPrice: numberOrNull(row.resale_anchor_price),
      liquidityRatio: numberOrNull(row.liquidity_ratio),
    },
    listingStatus: stringOrNull(row.listing_status),
    endTime: row.end_time ?? null,
    lastSeenAt: row.last_seen_at ?? null,
  };
}

function buildDecisionJson(d: ScoredAcquisitionDecision): Record<string, unknown> {
  return {
    schemaVersion: 'domain1.acquisitionDecision.repository.v2.green-tier',
    correlationId: d.correlationId,
    inputHash: d.inputHash,
    candidate: d.candidate,
    policy: d.policy,
    identity: d.identity,
    comps: {
      acceptedCount: d.comps.acceptedComps.length,
      rejectedCount: d.comps.rejectedComps.length,
      compQualityScore: d.comps.compQualityScore,
      compGroundingScore: d.comps.compGroundingScore,
      weakGroundingReasons: d.comps.weakGroundingReasons,
    },
    market: d.market,
    financial: d.financial,
    safety: d.safety,
    originalRules: d.originalRules,
    finalRules: d.finalRules,
    executionStatus: d.executionStatus,
    purchaseQueueStatus: d.purchaseQueueStatus,
    originalBuySignal: d.originalBuySignal,
    purchaseQueueEligible: d.purchaseQueueEligible,
    reviewRequired: d.reviewRequired,
    allocationAudit: d.allocationAudit,
  };
}

function buildCapitalSafetyJson(d: ScoredAcquisitionDecision): Record<string, unknown> {
  return {
    status: d.safety.status,
    safetyScore: d.safety.safetyScore,
    ok: d.safety.ok,
    originalDecision: d.originalRules.status,
    finalAllowedDecision: d.finalRules.allowedDecision,
    allowedDecision: d.safety.allowedDecision,
    executionStatus: d.executionStatus,
    purchaseQueueStatus: d.purchaseQueueStatus,
    hardBlockReasons: d.safety.hardBlockReasons,
    softReviewReasons: d.safety.softReviewReasons,
    blockingReasons: d.safety.blockingReasons,
    reviewReasons: d.safety.reviewReasons,
    replayCertificationStatus: d.safety.replayCertificationStatus,
    compGroundingStatus: d.safety.compGroundingStatus,
    mutationLedgerStatus: d.safety.mutationLedgerStatus,
    executionEligible: d.safety.executionEligible,
    purchaseQueueEligible: d.safety.purchaseQueueEligible,
    reviewQueueEligible: d.safety.reviewQueueEligible,
  };
}

function summarizeDecision(d: ScoredAcquisitionDecision): string {
  const profit = money(d.financial.estimatedProfitUsd);
  const roi = d.financial.estimatedRoi === null ? 'n/a' : `${round(d.financial.estimatedRoi * 100, 2)}%`;
  return `${d.originalRules.status} preserved; final=${d.finalRules.allowedDecision}; execution=${d.executionStatus}; queue=${d.purchaseQueueStatus}; profit=${profit}; roi=${roi}`;
}

function isExecutionQueueEligible(executionStatus: AcquisitionExecutionStatus, queueStatus: PurchaseQueueStatus): boolean {
  if (!isPurchaseQueueEligible(queueStatus)) return false;
  return executionStatus === 'AUTO_BUY_READY' || executionStatus === 'BID_MONITOR_READY' || executionStatus === 'REVIEW_REQUIRED';
}

function mapPurchaseQueueStatusForDb(status: PurchaseQueueStatus): string {
  switch (status) {
    case 'approved':
    case 'approved_pending_bid_check':
      return 'approved';
    case 'bid_monitor':
      return 'bid_monitor';
    case 'review_required':
      return 'review_required';
    case 'blocked':
      return 'blocked';
    case 'expired':
      return 'expired';
    case 'capital_limit_skipped':
      return 'capital_limit_skipped';
    case 'not_queued':
      return 'not_queued';
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

function mapOpportunityStatus(executionStatus: AcquisitionExecutionStatus, _queued: boolean): string {
  if (executionStatus === 'EXPIRED') return 'expired';
  return 'reviewed';
}

function mapReasonExecutionStatus(executionStatus: AcquisitionExecutionStatus, queued: boolean): string {
  if (queued) return 'PURCHASE_QUEUE_CREATED';
  if (executionStatus === 'AUTO_BUY_READY') return 'AUTO_BUY_READY';
  if (executionStatus === 'BID_MONITOR_READY') return 'BID_MONITOR_READY';
  if (executionStatus === 'REVIEW_REQUIRED') return 'REVIEW_REQUIRED';
  if (executionStatus === 'BLOCKED') return 'BLOCKED';
  if (executionStatus === 'CAPITAL_LIMIT_SKIPPED') return 'CAPITAL_LIMIT_SKIPPED';
  if (executionStatus === 'EXPIRED') return 'BLOCKED';
  return 'REVIEW_REQUIRED';
}

function mapCandidateStatus(d: ScoredAcquisitionDecision): string {
  if (d.executionStatus === 'AUTO_BUY_READY') return 'profit_buy';
  if (d.executionStatus === 'BID_MONITOR_READY') return 'profit_bid_monitor';
  if (d.executionStatus === 'REVIEW_REQUIRED') return 'profit_review';
  if (d.executionStatus === 'CAPITAL_LIMIT_SKIPPED') return 'profit_capital_skipped';
  if (d.executionStatus === 'EXPIRED') return 'expired';
  return 'profit_blocked';
}

function buildQueueNotes(d: ScoredAcquisitionDecision, decisionId: string | null): string {
  return truncate(
    JSON.stringify({
      decisionId,
      originalDecision: d.originalRules.status,
      finalAllowedDecision: d.finalRules.allowedDecision,
      executionStatus: d.executionStatus,
      purchaseQueueStatus: d.purchaseQueueStatus,
      profit: d.financial.estimatedProfitUsd,
      roi: d.financial.estimatedRoi,
      maxBidUsd: d.financial.maxBidUsd,
      hardBlockReasons: d.safety.hardBlockReasons,
      softReviewReasons: d.safety.softReviewReasons,
    }),
    2000,
  );
}

function inferShippingClass(d: ScoredAcquisitionDecision): string {
  if (d.financial.shippingEstimateUsd >= 35) return 'oversize_or_heavy';
  if (d.financial.shippingEstimateUsd >= 15) return 'standard_parcel';
  return 'small_parcel';
}

function shippingRiskScore(d: ScoredAcquisitionDecision): number {
  return clamp(1 - d.financial.shippingSignal.confidence + d.policy.carrierRiskRate, 0, 1);
}

function descriptionQualityScore(d: ScoredAcquisitionDecision): number {
  const length = (d.candidate.description ?? '').length;
  if (length > 500) return 0.9;
  if (length > 120) return 0.7;
  return 0.45;
}

function returnRiskScore(d: ScoredAcquisitionDecision): number {
  return clamp(d.policy.returnRiskRate + d.policy.damageRiskRate + d.policy.disputeRiskRate, 0, 1);
}

function defensibilityScore(d: ScoredAcquisitionDecision): number {
  return clamp(0.35 + d.identity.identityConfidence * 0.25 + d.comps.compQualityScore * 0.20 + descriptionQualityScore(d) * 0.20, 0, 1);
}

function sellerProtectionScore(d: ScoredAcquisitionDecision): number {
  const evidencePenalty = missingForensicEvidence(d).length * 0.08;
  return clamp(defensibilityScore(d) - evidencePenalty, 0, 1);
}

function executionIntegrityScore(d: ScoredAcquisitionDecision): number {
  const hardPenalty = d.safety.hardBlockReasons.length * 0.25;
  const softPenalty = d.safety.softReviewReasons.length * 0.08;
  return clamp(0.95 - hardPenalty - softPenalty, 0, 1);
}

function requiredForensicEvidence(d: ScoredAcquisitionDecision): string[] {
  const base = ['source_listing_snapshot', 'source_images', 'pricing_model', 'comp_set', 'decision_audit'];
  if ((d.financial.expectedResaleUsd ?? 0) >= 100) base.push('insurance_policy');
  if (d.identity.categoryKey.includes('phone')) base.push('imei_or_serial_capture');
  return base;
}

function missingForensicEvidence(d: ScoredAcquisitionDecision): string[] {
  const missing: string[] = [];
  if (d.financial.shippingSignal.source === 'missing') missing.push('shipping_quote');
  if ((d.candidate.description ?? '').length < 50) missing.push('source_description_detail');
  if (d.comps.acceptedComps.length < 3) missing.push('minimum_comp_set');
  return missing;
}

function marginPct(d: ScoredAcquisitionDecision): number | null {
  if (d.financial.expectedResaleUsd === null || d.financial.expectedResaleUsd <= 0 || d.financial.estimatedProfitUsd === null) return null;
  return round(d.financial.estimatedProfitUsd / d.financial.expectedResaleUsd, 4);
}

function marketplaceFeeUsd(d: ScoredAcquisitionDecision): number {
  return round(d.financial.feesEstimateUsd * (d.policy.marketplaceFeeRate / Math.max(0.0001, d.policy.marketplaceFeeRate + d.policy.paymentFeeRate)), 2);
}

function paymentFeeUsd(d: ScoredAcquisitionDecision): number {
  return round(d.financial.feesEstimateUsd * (d.policy.paymentFeeRate / Math.max(0.0001, d.policy.marketplaceFeeRate + d.policy.paymentFeeRate)), 2);
}

function isJsonColumn(columnName: string): boolean {
  return columnName.endsWith('_json') || columnName.endsWith('_jsonb') || ['details_json', 'payload_json', 'decision_json', 'reasons_json', 'risk_flags_json', 'capital_block_reason_json', 'purchase_price_inputs_json', 'forensic_required_json', 'forensic_missing_json', 'shipping_signal_json', 'safety_json', 'event_details_json', 'evidence_json', 'metrics_json', 'flags_json', 'diff_json', 'after_json', 'before_json'].includes(columnName);
}

function toDbValue(columnName: string, value: DbValue): unknown {
  if (value === null || value === undefined) return value;
  if (isJsonColumn(columnName)) return stringifyJson(value);
  if (Array.isArray(value)) return value;
  if (value instanceof Date) return value;
  if (typeof value === 'object') return stringifyJson(value);
  return value;
}

function castPlaceholder(columnName: string, index: number): string {
  if (columnName.endsWith('_json') || columnName.endsWith('_jsonb') || ['details_json', 'payload_json', 'decision_json', 'reasons_json', 'risk_flags_json', 'capital_block_reason_json', 'purchase_price_inputs_json', 'forensic_required_json', 'forensic_missing_json', 'shipping_signal_json', 'safety_json', 'event_details_json', 'evidence_json', 'metrics_json', 'flags_json', 'diff_json', 'after_json', 'before_json'].includes(columnName)) {
    return `$${index}::jsonb`;
  }
  if (columnName.endsWith('_id') && ['listing_id', 'process_run_id', 'correlation_id', 'portfolio_batch_id', 'decision_id'].includes(columnName)) {
    return `$${index}::uuid`;
  }
  return `$${index}`;
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      return Object.keys(val)
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = (val as Record<string, unknown>)[key];
          return acc;
        }, {});
    }
    return val;
  });
}

function parseJson(value: unknown): Record<string, unknown> | unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value === 'string' && value.trim().length > 0) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed) || (parsed && typeof parsed === 'object')) return parsed as Record<string, unknown> | unknown[];
    } catch {
      return {};
    }
  }
  return {};
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? {} : parsed;
}

function number(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Expected finite number, received ${String(value)}`);
  return parsed;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function numberOrUndefined(value: unknown): number | undefined {
  const parsed = numberOrNull(value);
  return parsed === null ? undefined : parsed;
}

function numberOrDefault(value: unknown, fallback: number): number {
  return numberOrNull(value) ?? fallback;
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return ['true', '1', 'yes'].includes(value.toLowerCase());
  return Boolean(value);
}

function stringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  return str.length > 0 ? str : null;
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function positiveInt(value: number, fieldName: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${fieldName} must be a positive integer`);
  return value;
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function money(value: number | null): string {
  return value === null ? 'n/a' : `$${round(value, 2).toFixed(2)}`;
}

function workerInstanceId(): string {
  return process.env.ACQ_DECISION_WORKER_INSTANCE_ID?.trim() || 'acquisition-decision-worker';
}
