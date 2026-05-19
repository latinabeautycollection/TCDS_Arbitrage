import { PoolClient } from 'pg';

export interface InsertShippingEvidenceInput {
  processRunId: string;
  processStepId?: number | null;
  forensicEventId: number;
  entityType: string;
  entityPk: string;
  sourceListingNormalizedId?: number | null;
  shipmentId?: number | null;
  carrierCode?: string | null;
  serviceCode?: string | null;
  serviceName?: string | null;
  quotedLabelCostUsd?: number | null;
  estimatedDeliveryDays?: number | null;
  onTimeProbability?: number | null;
  trackingQualityScore?: number | null;
  claimRiskScore?: number | null;
  payloadJson?: Record<string, unknown>;
}

export class ShippingEvidenceRepository {
  constructor(private readonly client: PoolClient) {}

  async insert(input: InsertShippingEvidenceInput) {
    const { rows } = await this.client.query(
      `
      insert into arb.shipping_evidence (
        process_run_id,
        process_step_id,
        forensic_event_id,
        entity_type,
        entity_pk,
        source_listing_normalized_id,
        shipment_id,
        carrier_code,
        service_code,
        service_name,
        quoted_label_cost_usd,
        estimated_delivery_days,
        on_time_probability,
        tracking_quality_score,
        claim_risk_score,
        payload_json
      )
      values (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb
      )
      returning *
      `,
      [
        input.processRunId,
        input.processStepId ?? null,
        input.forensicEventId,
        input.entityType,
        input.entityPk,
        input.sourceListingNormalizedId ?? null,
        input.shipmentId ?? null,
        input.carrierCode ?? null,
        input.serviceCode ?? null,
        input.serviceName ?? null,
        input.quotedLabelCostUsd ?? null,
        input.estimatedDeliveryDays ?? null,
        input.onTimeProbability ?? null,
        input.trackingQualityScore ?? null,
        input.claimRiskScore ?? null,
        JSON.stringify(input.payloadJson ?? {})
      ]
    );

    return rows[0];
  }

  async getById(id: number) {
    const { rows } = await this.client.query(
      `
      select *
      from arb.shipping_evidence
      where id = $1
      `,
      [id]
    );
    return rows[0] ?? null;
  }

  async getByProcessRunId(processRunId: string) {
    const { rows } = await this.client.query(
      `
      select *
      from arb.shipping_evidence
      where process_run_id = $1
      order by id asc
      `,
      [processRunId]
    );
    return rows;
  }

  async getByEntity(entityType: string, entityPk: string) {
    const { rows } = await this.client.query(
      `
      select *
      from arb.shipping_evidence
      where entity_type = $1
        and entity_pk = $2
      order by id asc
      `,
      [entityType, entityPk]
    );
    return rows;
  }

  async getByShipmentId(shipmentId: number) {
    const { rows } = await this.client.query(
      `
      select *
      from arb.shipping_evidence
      where shipment_id = $1
      order by id asc
      `,
      [shipmentId]
    );
    return rows;
  }
}
