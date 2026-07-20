import type { Pool } from "pg";
import type { ShippingExecutionGateway } from "../contracts/shippingExecutionGateway";
import type { ShippingIntelligenceDecision } from "../models/decisionEvidence";
import type { ShippingIntelligenceContext } from "../models/intelligenceContext";

export class ExistingRepositoryAdapter implements ShippingExecutionGateway {
  constructor(private readonly pool: Pool) {}

  async persistRecommendation(
    context: ShippingIntelligenceContext,
    decision: ShippingIntelligenceDecision
  ): Promise<void> {
    await this.pool.query(
      `select arb.record_shipping_intelligence_decision_v2($1::jsonb)`,
      [JSON.stringify({
        decision_id: decision.decisionId,
        idempotency_key: decision.idempotencyKey,
        input_hash: decision.inputHash,
        correlation_id: decision.correlationId,
        stage: decision.stage,
        process_run_id: context.processRunId ?? null,
        listing_id: context.listingId ?? null,
        candidate_id: context.candidateId ?? null,
        source_listing_normalized_id: context.sourceListingNormalizedId ?? null,
        ebay_listing_fk: context.ebayListingFk ?? null,
        ebay_order_fk: context.ebayOrderFk ?? null,
        shipment_id: context.shipmentId ?? null,
        mode: context.mode,
        status: decision.protection.status,
        policy_version: decision.policyVersion,
        model_version: decision.modelVersion,
        ruleset_version: decision.rulesetVersion,
        risk_score: decision.risk.totalRiskScore,
        confidence_score: decision.pricing.quoteConfidenceScore,
        protected_shipping_charge_cents: decision.pricing.protectedShippingChargeCents,
        expected_net_profit_cents: decision.profit.expectedNetProfitCents,
        worst_case_net_profit_cents: decision.profit.worstCaseNetProfitCents,
        fail_closed: decision.failClosed,
        decision_json: decision,
        evidence_hash: decision.evidenceHash
      })]
    );
  }

  async requestReconciliation(shipmentId: number, correlationId: string): Promise<void> {
    await this.pool.query(
      `insert into arb.job_queue(job_type, job_key, payload, status, priority, correlation_id, idempotency_key)
       values ('shipping_intelligence_reconcile', $1, $2::jsonb, 'QUEUED', 40, $3, $1)
       on conflict do nothing`,
      [
        `shipping-reconcile:${shipmentId}`,
        JSON.stringify({ shipmentId, correlationId }),
        correlationId
      ]
    );
  }
}
