import { PoolClient } from 'pg';

export interface InsertPricingEvidenceInput {
  processRunId: string | number;
  processStepId?: number | null;
  forensicEventId: number;
  entityType: string;
  entityPk: string;
  sourceListingNormalizedId?: number | null;
  candidateId?: number | null;
  decisionId?: string | null;
  priceType?: string;
  amountUsd?: number | null;
  ebayFeeUsd?: number | null;
  paymentFeeUsd?: number | null;
  shippingUsd?: number | null;
  totalCostBasisUsd?: number | null;
  expectedProfitUsd?: number | null;
  roiPct?: number | null;
  marginPct?: number | null;
  priceKind?: string;
  amount?: number | null;
  currency?: string;
  feeRate?: number | null;
  marginEstimate?: number | null;
  evidencePayload?: unknown;
  payloadJson?: Record<string, unknown> | null;
}

export class PricingEvidenceRepository {
  constructor(private readonly client: PoolClient) {}

  async insert(input: InsertPricingEvidenceInput) {
    const normalizedProcessRunId = this.normalizeProcessRunId(input.processRunId);
    const normalizedPayload = this.normalizePayload(input);

    const { rows } = await this.client.query(
      `
      insert into arb.pricing_evidence (
        process_run_id,
        process_step_id,
        forensic_event_id,
        entity_type,
        entity_pk,
        source_listing_normalized_id,
        candidate_id,
        decision_id,
        price_type,
        amount_usd,
        ebay_fee_usd,
        payment_fee_usd,
        shipping_usd,
        total_cost_basis_usd,
        expected_profit_usd,
        roi_pct,
        margin_pct,
        payload_json,
        created_at
      )
      values (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,now()
      )
      returning *
      `,
      [
        normalizedProcessRunId,
        input.processStepId ?? null,
        input.forensicEventId,
        input.entityType,
        input.entityPk,
        input.sourceListingNormalizedId ?? null,
        input.candidateId ?? null,
        input.decisionId ?? null,
        this.normalizePriceType(input),
        this.normalizeAmountUsd(input),
        input.ebayFeeUsd ?? null,
        input.paymentFeeUsd ?? null,
        input.shippingUsd ?? null,
        input.totalCostBasisUsd ?? null,
        input.expectedProfitUsd ?? null,
        input.roiPct ?? null,
        this.normalizeMarginPct(input),
        JSON.stringify(normalizedPayload)
      ]
    );

    return rows[0];
  }

  async getByEntity(entityType: string, entityPk: string) {
    const { rows } = await this.client.query(
      `
      select *
      from arb.pricing_evidence
      where entity_type = $1
        and entity_pk = $2
      order by id asc
      `,
      [entityType, entityPk]
    );

    return rows;
  }

  async getByProcessRunId(processRunId: string | number) {
    const normalizedProcessRunId = this.normalizeProcessRunId(processRunId);

    const { rows } = await this.client.query(
      `
      select *
      from arb.pricing_evidence
      where process_run_id = $1
      order by id asc
      `,
      [normalizedProcessRunId]
    );

    return rows;
  }

  async getByCandidateId(candidateId: number) {
    const { rows } = await this.client.query(
      `
      select *
      from arb.pricing_evidence
      where candidate_id = $1
      order by id asc
      `,
      [candidateId]
    );

    return rows;
  }

  async getBySourceListingNormalizedId(sourceListingNormalizedId: number) {
    const { rows } = await this.client.query(
      `
      select *
      from arb.pricing_evidence
      where source_listing_normalized_id = $1
      order by id asc
      `,
      [sourceListingNormalizedId]
    );

    return rows;
  }

  async getLatestByEntity(entityType: string, entityPk: string) {
    const { rows } = await this.client.query(
      `
      select *
      from arb.pricing_evidence
      where entity_type = $1
        and entity_pk = $2
      order by id desc
      limit 1
      `,
      [entityType, entityPk]
    );

    return rows[0] ?? null;
  }

  private normalizeProcessRunId(value: string | number): string {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }

    throw new Error('PricingEvidenceRepository.insert requires a valid processRunId');
  }

  private normalizePriceType(input: InsertPricingEvidenceInput): string {
    if (input.priceType && input.priceType.trim().length > 0) {
      return input.priceType.trim();
    }

    if (input.priceKind && input.priceKind.trim().length > 0) {
      return input.priceKind.trim();
    }

    throw new Error('PricingEvidenceRepository.insert requires priceType or legacy priceKind');
  }

  private normalizeAmountUsd(input: InsertPricingEvidenceInput): number | null {
    if (input.amountUsd !== undefined && input.amountUsd !== null) {
      return input.amountUsd;
    }

    if (input.amount !== undefined && input.amount !== null) {
      return input.amount;
    }

    return null;
  }

  private normalizeMarginPct(input: InsertPricingEvidenceInput): number | null {
    if (input.marginPct !== undefined && input.marginPct !== null) {
      return input.marginPct;
    }

    if (input.marginEstimate !== undefined && input.marginEstimate !== null) {
      return input.marginEstimate;
    }

    return null;
  }

  private normalizePayload(input: InsertPricingEvidenceInput): Record<string, unknown> {
    if (
      input.payloadJson &&
      typeof input.payloadJson === 'object' &&
      !Array.isArray(input.payloadJson)
    ) {
      return input.payloadJson;
    }

    if (
      input.evidencePayload &&
      typeof input.evidencePayload === 'object' &&
      !Array.isArray(input.evidencePayload)
    ) {
      return input.evidencePayload as Record<string, unknown>;
    }

    const legacyPayload: Record<string, unknown> = {};
    if (input.currency) legacyPayload.currency = input.currency;
    if (input.feeRate !== undefined && input.feeRate !== null) legacyPayload.feeRate = input.feeRate;
    if (input.marginEstimate !== undefined && input.marginEstimate !== null) legacyPayload.marginEstimate = input.marginEstimate;
    if (input.amount !== undefined && input.amount !== null) legacyPayload.amount = input.amount;
    if (input.priceKind) legacyPayload.priceKind = input.priceKind;

    return legacyPayload;
  }
}
