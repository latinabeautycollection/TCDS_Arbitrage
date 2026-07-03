import type { Pool } from "pg";
import { defaultWarehouseProfile, assertWarehouseProfile, type WarehouseProfile } from "../config/warehouseConfig";
import {
  DEFAULT_WEIGHTED_DESTINATION_MODEL_KEY,
  assertWeightedDestinationModel,
  defaultWeightedDestinationZips,
  type WeightedDestinationZip,
} from "../config/weightedDestinationModel";

export type CarrierRateAdapter = {
  getRates(input: {
    origin: WarehouseProfile;
    destination: WeightedDestinationZip;
    package: Record<string, unknown>;
  }): Promise<Array<{
    carrierCode: string;
    serviceCode?: string;
    serviceName?: string;
    quotedCostUsd: number;
    estimatedDeliveryDays?: number;
    rawRateJson?: Record<string, unknown>;
  }>>;
};

export type WeightedRateSummary = {
  weightedAverageCostUsd: number;
  minCostUsd: number;
  medianCostUsd: number;
  maxCostUsd: number;
  costStddevUsd: number;
  p80CostUsd: number;
  p90CostUsd: number;
  worstCaseCostUsd: number;
  conservativeCostUsd: number;
  destinationCount: number;
  confidenceScore: number;
};

export type ShippingDestinationDigitalTwinResult = {
  decision: "BUY_SAFE" | "BUY_REVIEW" | "WATCH" | "REJECT";
  weightedAverageCostUsd: number;
  p90CostUsd: number;
  worstCaseCostUsd: number;
  expectedProfitAfterWeightedShippingUsd: number;
  expectedProfitAfterP90ShippingUsd: number;
  expectedProfitAfterWorstCaseShippingUsd: number;
  confidenceScore: number;
  explanation: string;
};

export class ShippingDestinationModelEngine {
  constructor(private readonly db: Pool, private readonly adapter: CarrierRateAdapter) {}

  async getDefaultDestinations(input?: {
    destinationModelKey?: string;
    categoryKey?: string;
    shipDate?: string;
  }): Promise<WeightedDestinationZip[]> {
    const { rows } = await this.db.query(
      `
      SELECT *
      FROM arb.fn_get_weighted_destination_zip_model($1, $2, coalesce($3::date, current_date))
      ORDER BY priority
      `,
      [
        input?.destinationModelKey ?? DEFAULT_WEIGHTED_DESTINATION_MODEL_KEY,
        input?.categoryKey ?? null,
        input?.shipDate ?? null,
      ],
    );

    if (!rows.length) return defaultWeightedDestinationZips;

    const destinations = rows.map((r) => ({
      regionGroup: r.region_group,
      marketName: r.market_name,
      city: r.city,
      stateCode: r.state_code,
      postalCode: r.representative_postal_code,
      weight: Number(r.effective_weight),
      priority: Number(r.priority),
      seasonalCostMultiplier: Number(r.seasonal_cost_multiplier ?? 1),
      seasonalDelayRiskMultiplier: Number(r.seasonal_delay_risk_multiplier ?? 1),
    })) as WeightedDestinationZip[];

    assertWeightedDestinationModel(destinations);
    return destinations;
  }

  async estimatePrePurchaseRate(input: {
    candidateId?: number;
    sourceListingNormalizedId?: number;
    categoryKey?: string;
    package: Record<string, unknown>;
    carrierCode?: string;
    serviceCode?: string;
    warehouse?: WarehouseProfile;
    destinations?: WeightedDestinationZip[];
    destinationModelKey?: string;
    shipDate?: string;
  }): Promise<{ batchId: number; summary: WeightedRateSummary }> {
    const origin = input.warehouse ?? defaultWarehouseProfile;
    const destinations = input.destinations ?? await this.getDefaultDestinations({
      destinationModelKey: input.destinationModelKey,
      categoryKey: input.categoryKey,
      shipDate: input.shipDate,
    });

    assertWarehouseProfile(origin);
    assertWeightedDestinationModel(destinations);

    const batchId = await this.createBatch({
      candidateId: input.candidateId,
      sourceListingNormalizedId: input.sourceListingNormalizedId,
      categoryKey: input.categoryKey,
      warehouseKey: origin.warehouseKey,
      destinationModelKey: input.destinationModelKey ?? DEFAULT_WEIGHTED_DESTINATION_MODEL_KEY,
      carrierCode: input.carrierCode,
      serviceCode: input.serviceCode,
      packageJson: input.package,
    });

    try {
      await this.db.query(`UPDATE arb.shipping_weighted_rate_batches SET status='RUNNING' WHERE id=$1`, [batchId]);

      for (const destination of destinations) {
        const rates = await this.adapter.getRates({ origin, destination, package: input.package });
        const eligibleRates = rates
          .filter((r) => !input.carrierCode || r.carrierCode === input.carrierCode)
          .filter((r) => !input.serviceCode || r.serviceCode === input.serviceCode);

        const best = eligibleRates.sort((a, b) => a.quotedCostUsd - b.quotedCostUsd)[0];
        if (!best) continue;

        await this.insertResult(batchId, destination, best);
      }

      const summary = await this.calculateSummary(batchId);

      await this.recordPredictionEvent({
        candidateId: input.candidateId,
        sourceListingNormalizedId: input.sourceListingNormalizedId,
        categoryKey: input.categoryKey,
        modelKey: input.destinationModelKey ?? DEFAULT_WEIGHTED_DESTINATION_MODEL_KEY,
        batchId,
        predictedCostUsd: summary.weightedAverageCostUsd,
        payload: { summary, package: input.package },
      });

      return { batchId, summary };
    } catch (error) {
      await this.db.query(
        `UPDATE arb.shipping_weighted_rate_batches SET status='FAILED', error_message=$2, completed_at=now() WHERE id=$1`,
        [batchId, error instanceof Error ? error.message : String(error)],
      );
      throw error;
    }
  }

  async simulateForDigitalTwin(input: {
    candidateId?: number;
    sourceListingNormalizedId?: number;
    categoryKey?: string;
    expectedGrossProfitUsd: number;
    minimumProfitFloorUsd: number;
    package: Record<string, unknown>;
    carrierCode?: string;
    serviceCode?: string;
    destinationModelKey?: string;
  }): Promise<{ batchId: number; summary: WeightedRateSummary; twin: ShippingDestinationDigitalTwinResult }> {
    const { batchId, summary } = await this.estimatePrePurchaseRate(input);

    const expectedProfitAfterWeightedShippingUsd = round(input.expectedGrossProfitUsd - summary.weightedAverageCostUsd);
    const expectedProfitAfterP90ShippingUsd = round(input.expectedGrossProfitUsd - summary.p90CostUsd);
    const expectedProfitAfterWorstCaseShippingUsd = round(input.expectedGrossProfitUsd - summary.worstCaseCostUsd);

    const decision =
      expectedProfitAfterWorstCaseShippingUsd >= input.minimumProfitFloorUsd ? "BUY_SAFE" :
      expectedProfitAfterP90ShippingUsd >= input.minimumProfitFloorUsd ? "BUY_REVIEW" :
      expectedProfitAfterWeightedShippingUsd >= input.minimumProfitFloorUsd ? "WATCH" :
      "REJECT";

    const twin: ShippingDestinationDigitalTwinResult = {
      decision,
      weightedAverageCostUsd: summary.weightedAverageCostUsd,
      p90CostUsd: summary.p90CostUsd,
      worstCaseCostUsd: summary.worstCaseCostUsd,
      expectedProfitAfterWeightedShippingUsd,
      expectedProfitAfterP90ShippingUsd,
      expectedProfitAfterWorstCaseShippingUsd,
      confidenceScore: summary.confidenceScore,
      explanation:
        decision === "BUY_SAFE"
          ? "Worst-case representative destination still clears profit floor."
          : decision === "BUY_REVIEW"
            ? "P90 shipping clears profit floor but worst-case destination does not."
            : decision === "WATCH"
              ? "Weighted average clears profit floor but conservative shipping does not."
              : "Shipping estimate does not clear profit floor.",
    };

    await this.db.query(
      `
      INSERT INTO arb.shipping_destination_digital_twin_runs (
        candidate_id, source_listing_normalized_id, category_key, destination_model_key, warehouse_key,
        expected_gross_profit_usd, weighted_average_cost_usd, p90_cost_usd, worst_case_cost_usd,
        expected_profit_after_weighted_shipping_usd, expected_profit_after_p90_shipping_usd,
        expected_profit_after_worst_case_shipping_usd, minimum_profit_floor_usd,
        decision, confidence_score, simulation_json
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)
      `,
      [
        input.candidateId ?? null,
        input.sourceListingNormalizedId ?? null,
        input.categoryKey ?? null,
        input.destinationModelKey ?? DEFAULT_WEIGHTED_DESTINATION_MODEL_KEY,
        defaultWarehouseProfile.warehouseKey,
        input.expectedGrossProfitUsd,
        summary.weightedAverageCostUsd,
        summary.p90CostUsd,
        summary.worstCaseCostUsd,
        expectedProfitAfterWeightedShippingUsd,
        expectedProfitAfterP90ShippingUsd,
        expectedProfitAfterWorstCaseShippingUsd,
        input.minimumProfitFloorUsd,
        twin.decision,
        twin.confidenceScore,
        JSON.stringify({ summary, twin, package: input.package }),
      ],
    );

    return { batchId, summary, twin };
  }

  async recordPredictionEvent(input: {
    candidateId?: number;
    sourceListingNormalizedId?: number;
    shipmentId?: number;
    categoryKey?: string;
    modelKey: string;
    batchId?: number;
    predictedCostUsd: number;
    quotedCostUsd?: number;
    actualCostUsd?: number;
    carrierCode?: string;
    serviceCode?: string;
    regionGroup?: string;
    destinationPostalCode?: string;
    packageProfileKey?: string;
    weightBand?: string;
    payload?: Record<string, unknown>;
  }): Promise<number> {
    const payload = {
      candidate_id: input.candidateId,
      source_listing_normalized_id: input.sourceListingNormalizedId,
      shipment_id: input.shipmentId,
      category_key: input.categoryKey,
      model_key: input.modelKey,
      batch_id: input.batchId,
      predicted_cost_usd: input.predictedCostUsd,
      quoted_cost_usd: input.quotedCostUsd,
      actual_cost_usd: input.actualCostUsd,
      carrier_code: input.carrierCode,
      service_code: input.serviceCode,
      region_group: input.regionGroup,
      destination_postal_code: input.destinationPostalCode,
      package_profile_key: input.packageProfileKey,
      weight_band: input.weightBand,
      ...(input.payload ?? {}),
    };

    const { rows } = await this.db.query(
      `SELECT arb.fn_record_shipping_cost_prediction_event($1::jsonb) AS id`,
      [JSON.stringify(payload)],
    );

    return Number(rows[0].id);
  }

  async learnWeightsFromOrders(input?: {
    destinationModelKey?: string;
    categoryKey?: string;
    windowDays?: number;
    learningRate?: number;
  }): Promise<Record<string, unknown>> {
    const { rows } = await this.db.query(
      `SELECT arb.fn_learn_shipping_destination_weights_from_orders($1,$2,$3,$4) AS result`,
      [
        input?.destinationModelKey ?? DEFAULT_WEIGHTED_DESTINATION_MODEL_KEY,
        input?.categoryKey ?? null,
        input?.windowDays ?? 90,
        input?.learningRate ?? 0.25,
      ],
    );
    return rows[0].result;
  }

  private async createBatch(input: {
    candidateId?: number;
    sourceListingNormalizedId?: number;
    categoryKey?: string;
    warehouseKey: string;
    destinationModelKey: string;
    carrierCode?: string;
    serviceCode?: string;
    packageJson: Record<string, unknown>;
  }): Promise<number> {
    const { rows } = await this.db.query(
      `
      INSERT INTO arb.shipping_weighted_rate_batches (
        candidate_id, source_listing_normalized_id, category_key, warehouse_key, destination_model_key,
        carrier_code, service_code, package_json
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
      RETURNING id
      `,
      [
        input.candidateId ?? null,
        input.sourceListingNormalizedId ?? null,
        input.categoryKey ?? null,
        input.warehouseKey,
        input.destinationModelKey,
        input.carrierCode ?? null,
        input.serviceCode ?? null,
        JSON.stringify(input.packageJson),
      ],
    );
    return Number(rows[0].id);
  }

  private async insertResult(
    batchId: number,
    destination: WeightedDestinationZip,
    rate: {
      carrierCode: string;
      serviceCode?: string;
      serviceName?: string;
      quotedCostUsd: number;
      estimatedDeliveryDays?: number;
      rawRateJson?: Record<string, unknown>;
    },
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO arb.shipping_weighted_rate_results
       (batch_id, region_group, market_name, destination_postal_code, destination_city, destination_state_code,
        destination_weight, seasonal_cost_multiplier, carrier_code, service_code, service_name,
        quoted_cost_usd, estimated_delivery_days, raw_rate_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)`,
      [
        batchId,
        destination.regionGroup,
        destination.marketName,
        destination.postalCode,
        destination.city,
        destination.stateCode,
        destination.weight,
        destination.seasonalCostMultiplier ?? 1,
        rate.carrierCode,
        rate.serviceCode ?? null,
        rate.serviceName ?? null,
        rate.quotedCostUsd,
        rate.estimatedDeliveryDays ?? null,
        JSON.stringify(rate.rawRateJson ?? {}),
      ],
    );
  }

  private async calculateSummary(batchId: number): Promise<WeightedRateSummary> {
    const { rows } = await this.db.query(`SELECT arb.fn_calculate_weighted_rate_summary($1) AS summary`, [batchId]);
    const summary = rows[0].summary;
    return {
      weightedAverageCostUsd: Number(summary.weighted_average_cost_usd),
      minCostUsd: Number(summary.min_cost_usd),
      medianCostUsd: Number(summary.median_cost_usd),
      maxCostUsd: Number(summary.max_cost_usd),
      costStddevUsd: Number(summary.cost_stddev_usd),
      p80CostUsd: Number(summary.p80_cost_usd),
      p90CostUsd: Number(summary.p90_cost_usd),
      worstCaseCostUsd: Number(summary.worst_case_cost_usd),
      conservativeCostUsd: Number(summary.conservative_cost_usd),
      destinationCount: Number(summary.destination_count),
      confidenceScore: Number(summary.confidence_score),
    };
  }
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
