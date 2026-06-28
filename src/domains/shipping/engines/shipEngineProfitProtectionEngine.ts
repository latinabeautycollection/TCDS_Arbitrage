import { getShipEngineEnv } from "../config/shipEngineEnv";
import { trackingExceptionCode } from "../utils/shipEngineUtils";

export class ShipEngineProfitProtectionEngine {
  private readonly env = getShipEngineEnv();

  selectBestRate(rates: any[], expectedMaxCost?: number) {
    const validRates = rates
      .filter((r) => !r.error_messages?.length && (r.shipping_amount?.amount ?? Infinity) >= 0)
      .sort((a, b) => (a.shipping_amount?.amount ?? Infinity) - (b.shipping_amount?.amount ?? Infinity));

    const selected = validRates[0];
    const cost = Number(selected?.shipping_amount?.amount ?? 0);
    const riskScore = selected ? Math.min(100, Math.max(5, selected.delivery_days ? selected.delivery_days * 5 : 25)) : 90;
    const profitScore = expectedMaxCost && expectedMaxCost > 0 ? Math.max(0, Math.min(100, 100 - (cost / expectedMaxCost) * 100)) : 50;

    return {
      carrier: "SHIPENGINE" as const,
      selectedCarrierCode: selected?.carrier_code,
      selectedCarrierId: selected?.carrier_id,
      selectedServiceCode: selected?.service_code,
      selectedRateId: selected?.rate_id,
      selectedLabelId: undefined,
      selectedPriceUsd: cost || undefined,
      riskScore,
      profitScore,
      confidenceScore: selected ? 85 : 20,
      humanReviewRequired: !selected || riskScore >= this.env.SHIPENGINE_HUMAN_REVIEW_RISK_SCORE,
      executiveHoldRequired: riskScore >= this.env.SHIPENGINE_EXECUTIVE_HOLD_RISK_SCORE,
      reason: selected ? "Selected lowest valid ShipEngine rate." : "No valid ShipEngine rate available.",
      raw: { selected, rateCount: rates.length },
    };
  }

  scoreTracking(raw: any) {
    const code = trackingExceptionCode(raw?.status_code, raw?.status_detail_code, raw?.exception_description);
    const riskScore = code === "DELIVERED" ? 5 : code === "EXCEPTION" ? 90 : code === "IN_TRANSIT" ? 30 : 45;
    return {
      carrier: "SHIPENGINE" as const,
      riskScore,
      profitScore: Math.max(0, 100 - riskScore),
      confidenceScore: 80,
      humanReviewRequired: riskScore >= this.env.SHIPENGINE_HUMAN_REVIEW_RISK_SCORE,
      executiveHoldRequired: riskScore >= this.env.SHIPENGINE_EXECUTIVE_HOLD_RISK_SCORE,
      reason: `ShipEngine tracking status classified as ${code}.`,
      raw,
    };
  }
}
