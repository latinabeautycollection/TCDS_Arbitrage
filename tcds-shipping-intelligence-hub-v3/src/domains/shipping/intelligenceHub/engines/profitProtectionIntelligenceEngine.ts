import type { IntelligenceHubConfig } from "../config/intelligenceHubConfig";
import type { ProfitDecision } from "../models/profitDecision";
import type { ShippingIntelligenceContext } from "../models/intelligenceContext";

export class ProfitProtectionIntelligenceEngine {
  constructor(private readonly config: IntelligenceHubConfig) {}

  evaluate(
    context: ShippingIntelligenceContext,
    expectedShippingCostCents: number,
    protectedShippingCostCents: number
  ): ProfitDecision {
    const fixedCosts =
      context.acquisitionCostCents +
      context.marketplaceFeesCents +
      context.inboundShippingCents +
      context.packagingCostCents +
      context.returnReserveCents +
      context.disputeReserveCents;

    const revenue = context.itemSubtotalCents + context.shippingPaidCents;
    const expectedNetProfitCents = revenue - fixedCosts - expectedShippingCostCents;
    const worstCaseNetProfitCents = revenue - fixedCosts - protectedShippingCostCents;
    const expectedMarginPct = revenue > 0 ? expectedNetProfitCents / revenue * 100 : -100;
    const worstCaseMarginPct = revenue > 0 ? worstCaseNetProfitCents / revenue * 100 : -100;
    const profitFloorCents = Math.round(this.config.minimumNetProfitUsd * 100);
    const passed =
      worstCaseNetProfitCents >= profitFloorCents &&
      worstCaseMarginPct >= this.config.minimumMarginPct;
    const additional = Math.max(0, protectedShippingCostCents - context.shippingPaidCents);

    return {
      expectedShippingCostCents,
      protectedShippingCostCents,
      expectedNetProfitCents,
      worstCaseNetProfitCents,
      expectedMarginPct,
      worstCaseMarginPct,
      profitFloorCents,
      profitFloorPassed: passed,
      repriceRequired: !passed || additional > 0,
      additionalShippingChargeRequiredCents: additional,
      reasonCodes: [
        ...(!passed ? ["PROTECTED_PROFIT_FLOOR_FAILED"] : []),
        ...(additional > 0 ? ["BUYER_SHIPPING_UNDERCHARGED"] : [])
      ]
    };
  }
}
