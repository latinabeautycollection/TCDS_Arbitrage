import { Pool, PoolClient } from "pg";
import crypto from "crypto";

export type DecisionCode =
  | "BUY"
  | "REVIEW"
  | "PASS_LOW_MARGIN"
  | "PASS_LOW_CONFIDENCE"
  | "PASS_INSUFFICIENT_COMPS";

export interface ProfitReadyCandidate {
  candidateId: number;
  listingId: string;
  title: string;
  sourceCategoryKey: string | null;
  currentPrice: number;
  inboundShippingUsd: number;
  identityConfidence: number | null;
  isAccessory: boolean | null;
  isBundle: boolean | null;
  acceptedCompCount: number;
  medianActivePrice: number | null;
  activeCount: number | null;
}

export interface AcceptedComp {
  id: number;
  candidateId: number;
  ebayItemId: string;
  title: string;
  priceUsd: number;
  shippingUsd: number;
  totalPriceUsd: number;
  overallCompScore: number | null;
  titleSimilarityScore: number | null;
  identifierMatchScore: number | null;
  conditionMatchScore: number | null;
  categoryMatchScore: number | null;
  ebayBrand: string | null;
  ebayModel: string | null;
  ebayMpn: string | null;
  createdAt: Date;
}

export interface ProfitAnalysisResult {
  candidateId: number;
  listingId: string;
  analysisVersion: number;
  acceptedCompCount: number;
  rejectedCompCount: number;
  manualReviewCompCount: number;
  lowCompPriceUsd: number;
  medianCompPriceUsd: number;
  highCompPriceUsd: number;
  recommendedSalePriceUsd: number;
  ebayFeeEstimateUsd: number;
  outboundShippingEstimateUsd: number;
  propertyroomCostUsd: number;
  inboundShippingUsd: number;
  paymentFeeUsd: number;
  packagingCostUsd: number;
  returnReserveUsd: number;
  promoReserveUsd: number;
  totalCostBasisUsd: number;
  estimatedNetProfitUsd: number;
  estimatedMarginPct: number;
  estimatedRoiPct: number;
  confidenceScore: number;
  decisionCode: DecisionCode;
  decisionReasonJson: Record<string, unknown>;
  reasonCodes: string[];
  riskFlags: string[];
  phaseSummaryCurrent: string;
}

export interface ProcessRunInput {
  processName: string;
  processStage: string;
  workerName: string;
  workerInstanceId: string;
  hostName: string;
  codeVersion: string;
  rulesetVersion: string;
  modelVersion: string;
}

export class ProfitAnalysisRepository {
  constructor(private readonly pool: Pool) {}

  public async withTransaction<T>(
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async heartbeat(input: {
    workerName: string;
    workerInstanceId: string;
    status: string;
    details: Record<string, unknown>;
  }): Promise<void> {
    await this.pool.query(
      `
      INSERT INTO arb.worker_heartbeats (
        worker_name,
        worker_instance_id,
        status,
        details_json,
        last_seen_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4::jsonb, now(), now())
      ON CONFLICT (worker_name, worker_instance_id)
      DO UPDATE SET
        status = EXCLUDED.status,
        details_json = EXCLUDED.details_json,
        last_seen_at = now(),
        updated_at = now()
      `,
      [
        input.workerName,
        input.workerInstanceId,
        input.status,
        JSON.stringify(input.details),
      ],
    );
  }

  public async startProcessRun(
    client: PoolClient,
    input: ProcessRunInput,
  ): Promise<string> {
    const result = await client.query<{ run_id: string }>(
      `
      INSERT INTO arb.process_runs (
        process_name,
        process_stage,
        status,
        actor_type,
        actor_id,
        actor_name,
        worker_name,
        worker_instance_id,
        host_name,
        code_version,
        ruleset_version,
        model_version,
        entity_type,
        started_at,
        created_at,
        updated_at
      )
      VALUES (
        $1,
        $2,
        'STARTED',
        'worker',
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        'candidate',
        now(),
        now(),
        now()
      )
      RETURNING run_id
      `,
      [
        input.processName,
        input.processStage,
        input.workerInstanceId,
        input.workerName,
        input.workerName,
        input.workerInstanceId,
        input.hostName,
        input.codeVersion,
        input.rulesetVersion,
        input.modelVersion,
      ],
    );

    return result.rows[0]!.run_id;
  }

  public async completeProcessRun(
    client: PoolClient,
    input: {
      runId: string;
      status: "SUCCEEDED" | "FAILED" | "PARTIAL";
      rowsSeen: number;
      rowsSucceeded: number;
      rowsFailed: number;
      details: Record<string, unknown>;
      errorClass?: string;
      errorSummary?: string;
    },
  ): Promise<void> {
    await client.query(
      `
      UPDATE arb.process_runs
      SET
        status = $2,
        rows_seen = $3,
        rows_succeeded = $4,
        rows_failed = $5,
        details_json = $6::jsonb,
        error_class = $7,
        error_summary = $8,
        completed_at = CASE WHEN $2 IN ('SUCCEEDED', 'PARTIAL') THEN now() ELSE completed_at END,
        failed_at = CASE WHEN $2 = 'FAILED' THEN now() ELSE failed_at END,
        updated_at = now()
      WHERE run_id = $1
      `,
      [
        input.runId,
        input.status,
        input.rowsSeen,
        input.rowsSucceeded,
        input.rowsFailed,
        JSON.stringify(input.details),
        input.errorClass ?? null,
        input.errorSummary ?? null,
      ],
    );
  }

  public async createProcessStep(
    client: PoolClient,
    input: {
      runId: string;
      candidateId: number;
      stepName: string;
      status: "RUNNING" | "SUCCEEDED" | "FAILED";
      payload: Record<string, unknown>;
    },
  ): Promise<number> {
    const result = await client.query<{ id: number }>(
      `
      INSERT INTO arb.process_steps (
        process_run_id,
        step_name,
        queue_name,
        entity_type,
        entity_pk,
        status,
        started_at,
        payload_json,
        created_at,
        updated_at
      )
      VALUES (
        $1,
        $2,
        'profit_analysis',
        'candidate',
        $3,
        $4,
        now(),
        $5::jsonb,
        now(),
        now()
      )
      RETURNING id
      `,
      [
        input.runId,
        input.stepName,
        String(input.candidateId),
        input.status,
        JSON.stringify(input.payload),
      ],
    );

    return result.rows[0]!.id;
  }

  public async completeProcessStep(
    client: PoolClient,
    input: {
      stepId: number;
      status: "SUCCEEDED" | "FAILED" | "DEAD_LETTERED";
      result?: Record<string, unknown>;
      errorCode?: string;
      errorMessage?: string;
    },
  ): Promise<void> {
    await client.query(
      `
      UPDATE arb.process_steps
      SET
        status = $2,
        completed_at = now(),
        result_json = COALESCE($3::jsonb, result_json),
        error_code = $4,
        error_message = $5,
        updated_at = now()
      WHERE id = $1
      `,
      [
        input.stepId,
        input.status,
        input.result ? JSON.stringify(input.result) : null,
        input.errorCode ?? null,
        input.errorMessage ?? null,
      ],
    );
  }

  public async findProfitReadyCandidates(
    limit: number,
    rulesetVersion: string,
   minAcceptedComps: number,
    demandMin: number,
  ): Promise<ProfitReadyCandidate[]> {
    const result = await this.pool.query<{
      candidate_id: string;
      listing_id: string;
      title: string;
      source_category_key: string | null;
      current_price: string;
      inbound_shipping_usd: string | null;
      identity_confidence: string | null;
      is_accessory: boolean | null;
      is_bundle: boolean | null;
      accepted_comp_count: string;
      median_active_price: string | null;
      active_count: string | null;
    }>(
      `
        SELECT
          c.id AS candidate_id,
          c.listing_id,
          c.title,
          c.source_category_key,
          c.current_price,
          COALESCE(c.inbound_shipping_usd, 0) AS inbound_shipping_usd,
          c.identity_confidence,
          c.is_accessory,
          c.is_bundle,
          COUNT(ec.id) FILTER (WHERE ec.status = 'accepted') AS accepted_comp_count,
          m.median_active_price,
          m.active_count
        FROM arb.candidates c
        JOIN arb.ebay_comps ec
          ON ec.candidate_id = c.id
        LEFT JOIN LATERAL (
  SELECT *
  FROM arb.profit_analysis
  WHERE candidate_id = c.id
  ORDER BY analysis_version DESC
  LIMIT 1
) pa ON true
        LEFT JOIN arb.ebay_market m ON m.listing_id = c.listing_id
        WHERE c.current_price IS NOT NULL
          AND c.current_price >= 0
        GROUP BY
          c.id,
          c.listing_id,
          c.title,
          c.source_category_key,
          c.current_price,
          c.inbound_shipping_usd,
          c.identity_confidence,
          c.is_accessory,
          c.is_bundle,
          pa.id,
          pa.accepted_comp_count,
          pa.ruleset_version,
          pa.updated_at,
          pa.propertyroom_cost_usd,
          pa.inbound_shipping_usd,
          m.median_active_price,
          m.active_count
HAVING (COUNT(ec.id) FILTER (WHERE ec.status = 'accepted') >= $3
            OR (m.median_active_price IS NOT NULL AND COALESCE(m.active_count, 0) >= $4
                AND c.title !~* 'activation[ _-]*lock|icloud[ _-]*lock'))
          AND (
            pa.id IS NULL
            OR pa.accepted_comp_count <> COUNT(ec.id) FILTER (WHERE ec.status = 'accepted')
            OR pa.ruleset_version IS DISTINCT FROM $2
            OR pa.updated_at < MAX(ec.created_at) FILTER (WHERE ec.status = 'accepted')
            OR pa.propertyroom_cost_usd <> c.current_price
            OR pa.inbound_shipping_usd <> COALESCE(c.inbound_shipping_usd, 0)
          )
        ORDER BY
          COUNT(ec.id) FILTER (WHERE ec.status = 'accepted') DESC,
          COALESCE(c.identity_confidence, 0) DESC,
          c.id ASC
        LIMIT $1
      `,
      [limit, rulesetVersion, minAcceptedComps, demandMin],
    );

    return result.rows.map((row) => ({
      candidateId: Number(row.candidate_id),
      listingId: row.listing_id,
      title: row.title,
      sourceCategoryKey: row.source_category_key,
      currentPrice: Number(row.current_price),
      inboundShippingUsd: Number(row.inbound_shipping_usd ?? 0),
      identityConfidence:
        row.identity_confidence === null
          ? null
          : Number(row.identity_confidence),
      isAccessory: row.is_accessory,
      isBundle: row.is_bundle,
      acceptedCompCount: Number(row.accepted_comp_count),
      medianActivePrice: row.median_active_price === null ? null : Number(row.median_active_price),
      activeCount: row.active_count === null ? null : Number(row.active_count),
    }));
  }

  public async tryCandidateLock(
    client: PoolClient,
    candidateId: number,
  ): Promise<boolean> {
    const result = await client.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_xact_lock($1::bigint) AS locked`,
      [candidateId],
    );

    return result.rows[0]?.locked === true;
  }

  public async getAcceptedComps(
    client: PoolClient,
    candidateId: number,
  ): Promise<AcceptedComp[]> {
    const result = await client.query<{
      id: string;
      candidate_id: string;
      ebay_item_id: string;
      title: string;
      price_usd: string;
      shipping_usd: string;
      total_price_usd: string;
      overall_comp_score: string | null;
      title_similarity_score: string | null;
      identifier_match_score: string | null;
      condition_match_score: string | null;
      category_match_score: string | null;
      ebay_brand: string | null;
      ebay_model: string | null;
      ebay_mpn: string | null;
      created_at: Date;
    }>(
      `
      SELECT
        id,
        candidate_id,
        ebay_item_id,
        title,
        price_usd,
        COALESCE(shipping_usd, 0) AS shipping_usd,
        COALESCE(total_price_usd, price_usd + COALESCE(shipping_usd, 0)) AS total_price_usd,
        overall_comp_score,
        title_similarity_score,
        identifier_match_score,
        condition_match_score,
        category_match_score,
        ebay_brand,
        ebay_model,
        ebay_mpn,
        created_at
      FROM arb.ebay_comps
      WHERE candidate_id = $1
        AND status = 'accepted'
        AND total_price_usd IS NOT NULL
        AND total_price_usd > 0
      ORDER BY
        overall_comp_score DESC NULLS LAST,
        created_at DESC
      `,
      [candidateId],
    );

    return result.rows.map((row) => ({
      id: Number(row.id),
      candidateId: Number(row.candidate_id),
      ebayItemId: row.ebay_item_id,
      title: row.title,
      priceUsd: Number(row.price_usd),
      shippingUsd: Number(row.shipping_usd),
      totalPriceUsd: Number(row.total_price_usd),
      overallCompScore:
        row.overall_comp_score === null ? null : Number(row.overall_comp_score),
      titleSimilarityScore:
        row.title_similarity_score === null
          ? null
          : Number(row.title_similarity_score),
      identifierMatchScore:
        row.identifier_match_score === null
          ? null
          : Number(row.identifier_match_score),
      conditionMatchScore:
        row.condition_match_score === null
          ? null
          : Number(row.condition_match_score),
      categoryMatchScore:
        row.category_match_score === null
          ? null
          : Number(row.category_match_score),
      ebayBrand: row.ebay_brand,
      ebayModel: row.ebay_model,
      ebayMpn: row.ebay_mpn,
      createdAt: row.created_at,
    }));
  }

  public async getCompCounts(
    client: PoolClient,
    candidateId: number,
  ): Promise<{
    accepted: number;
    rejected: number;
    manualReview: number;
  }> {
    const result = await client.query<{
      accepted: string;
      rejected: string;
      manual_review: string;
    }>(
      `
      SELECT
        COUNT(*) FILTER (WHERE status = 'accepted') AS accepted,
        COUNT(*) FILTER (WHERE status = 'rejected') AS rejected,
        COUNT(*) FILTER (WHERE status = 'manual_review') AS manual_review
      FROM arb.ebay_comps
      WHERE candidate_id = $1
      `,
      [candidateId],
    );

    return {
      accepted: Number(result.rows[0]!.accepted),
      rejected: Number(result.rows[0]!.rejected),
      manualReview: Number(result.rows[0]!.manual_review),
    };
  }

  public async getFeeModel(client: PoolClient): Promise<{
    ebayFeeRate: number;
    returnsBufferRate: number;
    promoBufferRate: number;
  }> {
    const result = await client.query<{
      ebay_fee_rate: string;
      returns_buffer_rate: string;
      promo_buffer_rate: string;
    }>(
      `
      SELECT
        ebay_fee_rate,
        returns_buffer_rate,
        promo_buffer_rate
      FROM arb.fee_model
      ORDER BY updated_at DESC NULLS LAST, created_at DESC
      LIMIT 1
      `,
    );

    if (result.rowCount === 0) {
      return {
        ebayFeeRate: 0.135,
        returnsBufferRate: 0.06,
        promoBufferRate: 0.02,
      };
    }

    return {
      ebayFeeRate: Number(result.rows[0]!.ebay_fee_rate),
      returnsBufferRate: Number(result.rows[0]!.returns_buffer_rate),
      promoBufferRate: Number(result.rows[0]!.promo_buffer_rate),
    };
  }

  public async upsertProfitAnalysis(
  client: PoolClient,
  result: ProfitAnalysisResult,
  processName: string,
  processRunId: string,
  actorId: string,
  actorName: string,
  codeVersion: string,
  rulesetVersion: string,
  modelVersion: string,
): Promise<number> {
  const queryResult = await client.query<{ id: number }>(
    `
    INSERT INTO arb.profit_analysis (
      candidate_id, analysis_version,
      accepted_comp_count, rejected_comp_count, manual_review_comp_count,
      low_comp_price_usd, median_comp_price_usd, high_comp_price_usd,
      recommended_sale_price_usd, ebay_fee_estimate_usd, outbound_shipping_estimate_usd,
      propertyroom_cost_usd, inbound_shipping_usd, total_cost_basis_usd,
      estimated_net_profit_usd, estimated_margin_pct, confidence_score,
      decision_code, decision_reason_json,
      process_name, process_run_id, actor_type, actor_id, actor_name,
      code_version, ruleset_version, model_version,
      phase_summary_current, created_at, updated_at
    )
    VALUES (
      $1, 1,
      $2, $3, $4,
      $5, $6, $7,
      $8, $9, $10,
      $11, $12, $13,
      $14, $15, $16,
      $17, $18::jsonb,
      $19, $20, 'worker', $21, $22,
      $23, $24, $25,
      $26, now(), now()
    )
    ON CONFLICT (candidate_id) DO UPDATE SET
      accepted_comp_count = EXCLUDED.accepted_comp_count,
      rejected_comp_count = EXCLUDED.rejected_comp_count,
      manual_review_comp_count = EXCLUDED.manual_review_comp_count,
      low_comp_price_usd = EXCLUDED.low_comp_price_usd,
      median_comp_price_usd = EXCLUDED.median_comp_price_usd,
      high_comp_price_usd = EXCLUDED.high_comp_price_usd,
      recommended_sale_price_usd = EXCLUDED.recommended_sale_price_usd,
      ebay_fee_estimate_usd = EXCLUDED.ebay_fee_estimate_usd,
      outbound_shipping_estimate_usd = EXCLUDED.outbound_shipping_estimate_usd,
      propertyroom_cost_usd = EXCLUDED.propertyroom_cost_usd,
      inbound_shipping_usd = EXCLUDED.inbound_shipping_usd,
      total_cost_basis_usd = EXCLUDED.total_cost_basis_usd,
      estimated_net_profit_usd = EXCLUDED.estimated_net_profit_usd,
      estimated_margin_pct = EXCLUDED.estimated_margin_pct,
      confidence_score = EXCLUDED.confidence_score,
      decision_code = EXCLUDED.decision_code,
      decision_reason_json = EXCLUDED.decision_reason_json,
      process_name = EXCLUDED.process_name,
      process_run_id = EXCLUDED.process_run_id,
      actor_id = EXCLUDED.actor_id,
      actor_name = EXCLUDED.actor_name,
      code_version = EXCLUDED.code_version,
      ruleset_version = EXCLUDED.ruleset_version,
      model_version = EXCLUDED.model_version,
      phase_summary_current = EXCLUDED.phase_summary_current,
      updated_at = now()
    RETURNING id
    `,
    [
      result.candidateId,                  // $1
      result.acceptedCompCount,            // $2
      result.rejectedCompCount,            // $3
      result.manualReviewCompCount,        // $4
      result.lowCompPriceUsd,              // $5
      result.medianCompPriceUsd,           // $6
      result.highCompPriceUsd,             // $7
      result.recommendedSalePriceUsd,      // $8
      result.ebayFeeEstimateUsd,           // $9
      result.outboundShippingEstimateUsd,  // $10
      result.propertyroomCostUsd,          // $11
      result.inboundShippingUsd,           // $12
      result.totalCostBasisUsd,            // $13
      result.estimatedNetProfitUsd,        // $14
      result.estimatedMarginPct,           // $15
      result.confidenceScore,              // $16
      result.decisionCode,                 // $17
      JSON.stringify(result.decisionReasonJson), // $18
      processName,                         // $19
      processRunId,                        // $20
      actorId,                             // $21
      actorName,                           // $22
      codeVersion,                         // $23
      rulesetVersion,                      // $24
      modelVersion,                        // $25
      result.phaseSummaryCurrent,          // $26
    ],
  );

  return Number(queryResult.rows[0]!.id);
}

  public async updateCandidateAfterProfit(
    client: PoolClient,
    input: {
      candidateId: number;
      processName: string;
      processRunId: string;
      actorId: string;
      actorName: string;
      codeVersion: string;
      rulesetVersion: string;
      modelVersion: string;
      phaseSummary: string;
      decisionCode: DecisionCode;
    },
  ): Promise<void> {
    const status =
      input.decisionCode === "BUY"
        ? "profit_buy"
        : input.decisionCode === "REVIEW"
          ? "profit_review"
          : "profit_pass";

    await client.query(
      `
      UPDATE arb.candidates
      SET
        status = $2,
        lifecycle_status = 'PROFIT_ANALYZED',
        phase_summary_current = $3,
        last_process_name = $4,
        last_process_stage = 'PROFIT_ANALYZED',
        last_process_run_id = $5,
        last_actor_type = 'worker',
        last_actor_id = $6,
        last_actor_name = $7,
        code_version = $8,
        ruleset_version = $9,
        model_version = $10,
        updated_at = now()
      WHERE id = $1
      `,
      [
        input.candidateId,
        status,
        input.phaseSummary,
        input.processName,
        input.processRunId,
        input.actorId,
        input.actorName,
        input.codeVersion,
        input.rulesetVersion,
        input.modelVersion,
      ],
    );
  }

  public async getDecisionEnumLabels(client: PoolClient): Promise<string[]> {
    const result = await client.query<{ enumlabel: string }>(
      `
      SELECT e.enumlabel
      FROM pg_type t
      JOIN pg_enum e
        ON e.enumtypid = t.oid
      JOIN pg_namespace n
        ON n.oid = t.typnamespace
      WHERE n.nspname = 'arb'
        AND t.typname = 'decision_code'
      ORDER BY e.enumsortorder
      `,
    );

    return result.rows.map((row) => row.enumlabel);
  }

  public async upsertDecisionFromProfit(
    client: PoolClient,
    input: {
      result: ProfitAnalysisResult;
      decisionEnumValue: string;
      processName: string;
      processRunId: string;
      actorId: string;
      actorName: string;
      codeVersion: string;
      rulesetVersion: string;
      modelVersion: string;
    },
  ): Promise<string> {
    const queryResult = await client.query<{ id: string }>(
      `
      INSERT INTO arb.decisions (
        listing_id,
        decision,
        expected_net_profit,
        expected_roi,
        max_bid,
        risk_flags,
        reason_codes,
        computed_at,
        updated_at,
        confidence,
        expected_resale_usd,
        expected_net_usd,
        estimated_profit_usd,
        estimated_roi,
        max_bid_usd,
        reasons_json,
        risk_flags_json,
        correlation_id,
        phase_summary_current,
        process_name,
        process_stage,
        process_run_id,
        actor_type,
        actor_id,
        actor_name,
        code_version,
        ruleset_version,
        model_version,
        decision_at,
        current_propertyroom_bid,
        estimated_purchase_price,
        purchase_price_basis,
        purchase_price_inputs_json,
        source_price_snapshot_at,
        expected_total_cost_basis_usd
      )
      VALUES (
        $1,
        $2::arb.decision_code,
        $3,
        $4,
        $5,
        $6::text[],
        $7::text[],
        now(),
        now(),
        $8,
        $9,
        $10,
        $11,
        $12,
        $13,
        $14::jsonb,
        $15::jsonb,
        $16,
        $17,
        $18,
        'PROFIT_ANALYZED',
        $19,
        'worker',
        $20,
        $21,
        $22,
        $23,
        $24,
        now(),
        $25,
        $26,
        'PROPERTYROOM_CURRENT_PRICE_PLUS_INBOUND_SHIPPING',
        $27::jsonb,
        now(),
        $28
      )
      ON CONFLICT (listing_id)
      DO UPDATE SET
        decision = EXCLUDED.decision,
        expected_net_profit = EXCLUDED.expected_net_profit,
        expected_roi = EXCLUDED.expected_roi,
        max_bid = EXCLUDED.max_bid,
        risk_flags = EXCLUDED.risk_flags,
        reason_codes = EXCLUDED.reason_codes,
        computed_at = now(),
        updated_at = now(),
        confidence = EXCLUDED.confidence,
        expected_resale_usd = EXCLUDED.expected_resale_usd,
        expected_net_usd = EXCLUDED.expected_net_usd,
        estimated_profit_usd = EXCLUDED.estimated_profit_usd,
        estimated_roi = EXCLUDED.estimated_roi,
        max_bid_usd = EXCLUDED.max_bid_usd,
        reasons_json = EXCLUDED.reasons_json,
        risk_flags_json = EXCLUDED.risk_flags_json,
        correlation_id = EXCLUDED.correlation_id,
        phase_summary_current = EXCLUDED.phase_summary_current,
        process_name = EXCLUDED.process_name,
        process_stage = EXCLUDED.process_stage,
        process_run_id = EXCLUDED.process_run_id,
        actor_type = EXCLUDED.actor_type,
        actor_id = EXCLUDED.actor_id,
        actor_name = EXCLUDED.actor_name,
        code_version = EXCLUDED.code_version,
        ruleset_version = EXCLUDED.ruleset_version,
        model_version = EXCLUDED.model_version,
        decision_at = now(),
        current_propertyroom_bid = EXCLUDED.current_propertyroom_bid,
        estimated_purchase_price = EXCLUDED.estimated_purchase_price,
        purchase_price_basis = EXCLUDED.purchase_price_basis,
        purchase_price_inputs_json = EXCLUDED.purchase_price_inputs_json,
        source_price_snapshot_at = now(),
        expected_total_cost_basis_usd = EXCLUDED.expected_total_cost_basis_usd
      RETURNING id
      `,
      [
        input.result.listingId,
        input.decisionEnumValue,
        input.result.estimatedNetProfitUsd,
        input.result.estimatedRoiPct,
        input.result.propertyroomCostUsd + input.result.inboundShippingUsd,
        input.result.riskFlags,
        input.result.reasonCodes,
        this.confidenceText(input.result.confidenceScore),
        input.result.recommendedSalePriceUsd,
        input.result.estimatedNetProfitUsd,
        input.result.estimatedNetProfitUsd,
        input.result.estimatedRoiPct,
        input.result.propertyroomCostUsd + input.result.inboundShippingUsd,
        JSON.stringify(input.result.decisionReasonJson),
        JSON.stringify(input.result.riskFlags),
        input.processRunId,
        input.result.phaseSummaryCurrent,
        input.processName,
        input.processRunId,
        input.actorId,
        input.actorName,
        input.codeVersion,
        input.rulesetVersion,
        input.modelVersion,
        input.result.propertyroomCostUsd,
        input.result.propertyroomCostUsd,
        JSON.stringify({
          propertyroomCostUsd: input.result.propertyroomCostUsd,
          inboundShippingUsd: input.result.inboundShippingUsd,
          ebayFeeEstimateUsd: input.result.ebayFeeEstimateUsd,
          outboundShippingEstimateUsd: input.result.outboundShippingEstimateUsd,
          paymentFeeUsd: input.result.paymentFeeUsd,
          packagingCostUsd: input.result.packagingCostUsd,
          returnReserveUsd: input.result.returnReserveUsd,
          promoReserveUsd: input.result.promoReserveUsd,
        }),
        input.result.totalCostBasisUsd,
      ],
    );

    return queryResult.rows[0]!.id;
  }

  public async writeProductJournal(
    client: PoolClient,
    input: {
      result: ProfitAnalysisResult;
      processName: string;
      processRunId: string;
      workerName: string;
      workerInstanceId: string;
      codeVersion: string;
      rulesetVersion: string;
      modelVersion: string;
    },
  ): Promise<void> {
    await client.query(
      `
      INSERT INTO arb.product_journal (
        entity_type,
        entity_pk,
        listing_id,
        candidate_id,
        event_type,
        process_name,
        process_stage,
        process_run_id,
        correlation_id,
        actor_type,
        actor_id,
        actor_name,
        worker_name,
        worker_instance_id,
        code_version,
        ruleset_version,
        model_version,
        decision_code,
        reason_codes,
        risk_flags,
        event_summary,
        event_details_json,
        event_at,
        created_at
      )
      VALUES (
        'candidate',
        $1,
        $2,
        $3,
        'PROFIT_ANALYSIS_COMPLETED',
        $4,
        'PROFIT_ANALYZED',
        $5::uuid,
        $5::text,
        'worker',
        $6,
        $7,
        $8,
        $6,
        $9,
        $10,
        $11,
        $12,
        $13::text[],
        $14::text[],
        $15,
        $16::jsonb,
        now(),
        now()
      )
      `,
      [
        String(input.result.candidateId),
        input.result.listingId,
        input.result.candidateId,
        input.processName,
        input.processRunId,
        input.workerInstanceId,
        input.workerName,
        input.workerName,
        input.codeVersion,
        input.rulesetVersion,
        input.modelVersion,
        input.result.decisionCode,
        input.result.reasonCodes,
        input.result.riskFlags,
        input.result.phaseSummaryCurrent,
        JSON.stringify(input.result.decisionReasonJson),
      ],
    );
  }

  public async writeForensicEvent(
    client: PoolClient,
    input: {
      processRunId: string;
      processStepId: number;
      candidateId: number;
      eventType: string;
      actionType: string;
      workerName: string;
      workerInstanceId: string;
      sourceTable: string;
      sourcePk: string;
      evidence: Record<string, unknown>;
      metrics: Record<string, unknown>;
      flags: string[];
    },
  ): Promise<number> {
    const payload = {
      processRunId: input.processRunId,
      processStepId: input.processStepId,
      candidateId: input.candidateId,
      eventType: input.eventType,
      actionType: input.actionType,
      evidence: input.evidence,
      metrics: input.metrics,
      flags: input.flags,
      at: new Date().toISOString(),
    };

    const eventHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex");

    const result = await client.query<{ id: number }>(
      `
      INSERT INTO arb.forensic_events (
        process_run_id,
        process_step_id,
        correlation_id,
        entity_type,
        entity_pk,
        event_type,
        action_type,
        actor_type,
        actor_id,
        actor_name,
        worker_name,
        worker_instance_id,
        source_table,
        source_pk,
        queue_name,
        job_id,
        idempotency_key,
        evidence_json,
        metrics_json,
        flags_json,
        event_hash,
        event_at,
        created_at
      )
      VALUES (
        $1::uuid,
        $2,
        $1::text,
        'candidate',
        $3,
        $4,
        $5,
        'worker',
        $6,
        $7,
        $7,
        $6,
        $8,
        $9,
        'profit_analysis',
        $3,
        $10,
        $11::jsonb,
        $12::jsonb,
        $13::jsonb,
        $14,
        now(),
        now()
      )
      RETURNING id
      `,
      [
        input.processRunId,
        input.processStepId,
        String(input.candidateId),
        input.eventType,
        input.actionType,
        input.workerInstanceId,
        input.workerName,
        input.sourceTable,
        input.sourcePk,
        `profitAnalysisWorker:${input.candidateId}`,
        JSON.stringify(input.evidence),
        JSON.stringify(input.metrics),
        JSON.stringify(input.flags),
        eventHash,
      ],
    );

    return Number(result.rows[0]!.id);
  }

  public async writePricingEvidence(
    client: PoolClient,
    input: {
      processRunId: string;
      processStepId: number;
      forensicEventId: number;
      result: ProfitAnalysisResult;
      decisionId: string;
    },
  ): Promise<void> {
    await client.query(
      `
      INSERT INTO arb.pricing_evidence (
        process_run_id,
        process_step_id,
        forensic_event_id,
        entity_type,
        entity_pk,
        candidate_id,
        decision_id,
        price_type,
        amount_usd,
        ebay_fee_usd,
        shipping_usd,
        total_cost_basis_usd,
        expected_profit_usd,
        roi_pct,
        margin_pct,
        payload_json,
        created_at
      )
      VALUES (
        $1,
        $2,
        $3,
        'candidate',
        $4,
        $5,
        $6,
        'PROFIT_ANALYSIS',
        $7,
        $8,
        $9,
        $10,
        $11,
        $12,
        $13,
        $14::jsonb,
        now()
      )
      `,
      [
        input.processRunId,
        input.processStepId,
        input.forensicEventId,
        String(input.result.candidateId),
        input.result.candidateId,
        input.decisionId,
        input.result.recommendedSalePriceUsd,
        input.result.ebayFeeEstimateUsd,
        input.result.outboundShippingEstimateUsd,
        input.result.totalCostBasisUsd,
        input.result.estimatedNetProfitUsd,
        input.result.estimatedRoiPct,
        input.result.estimatedMarginPct,
        JSON.stringify(input.result.decisionReasonJson),
      ],
    );
  }

  public async writeDeadLetter(
    client: PoolClient,
    input: {
      processRunId: string;
      processStepId?: number;
      candidateId?: number;
      workerName: string;
      workerInstanceId: string;
      errorCode: string;
      errorMessage: string;
      payload: Record<string, unknown>;
      retryCount?: number;
    },
  ): Promise<void> {
    await client.query(
      `
      INSERT INTO arb.dead_letter (
        process_run_id,
        process_step_id,
        queue_name,
        job_id,
        entity_type,
        entity_pk,
        worker_name,
        worker_instance_id,
        error_code,
        error_message,
        payload_json,
        retry_count,
        created_at
      )
      VALUES (
        $1,
        $2,
        'profit_analysis',
        $3,
        'candidate',
        $4,
        $5,
        $6,
        $7,
        $8,
        $9::jsonb,
        $10,
        now()
      )
      `,
      [
        input.processRunId,
        input.processStepId ?? null,
        input.candidateId ? String(input.candidateId) : null,
        input.candidateId ? String(input.candidateId) : null,
        input.workerName,
        input.workerInstanceId,
        input.errorCode,
        input.errorMessage,
        JSON.stringify(input.payload),
        input.retryCount ?? 0,
      ],
    );
  }

  private confidenceText(score: number): string {
    if (score >= 0.85) return "HIGH";
    if (score >= 0.7) return "MEDIUM";
    return "LOW";
  }
}
