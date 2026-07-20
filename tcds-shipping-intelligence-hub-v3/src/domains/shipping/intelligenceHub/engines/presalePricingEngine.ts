import { pricingZonePolicy } from "../config/pricingZoneConfig";
import { calculateWorstCaseAnchorRate } from "../calculators/worstCaseRateCalculator";
import type { PricingIntelligence, ZoneRateSnapshot } from "../models/pricingIntelligence";

const round = (n: number): number => Math.max(0, Math.round(n));

export class PresalePricingEngine {
  calculate(input: {
    zoneSnapshots: ZoneRateSnapshot[];
    shippingPaidCents: number;
    insuredValueCents: number;
    insuranceRequired: boolean;
    signatureRequired: boolean;
    adultSignatureRequired: boolean;
    restrictedDeliveryRequired: boolean;
    residential: boolean;
    remoteArea: boolean;
    dimensionsVerified: boolean;
    weightVerified: boolean;
  }): PricingIntelligence {
    const worst = calculateWorstCaseAnchorRate(input.zoneSnapshots, "CONTIGUOUS_US");
    const insuranceCostCents = input.insuranceRequired
      ? Math.max(125, Math.ceil(input.insuredValueCents / 10_000) * 80)
      : 0;
    const signatureCostCents = !input.signatureRequired ? 0 :
      input.restrictedDeliveryRequired ? 1200 :
      input.adultSignatureRequired ? 800 : 600;
    const surchargeReserveCents =
      (input.remoteArea ? Math.max(500, round(worst.amountCents * 0.08)) : 0) +
      (input.residential ? Math.max(200, round(worst.amountCents * 0.03)) : 0);
    let adjustmentPct = 0.05;
    if (!input.dimensionsVerified) adjustmentPct += 0.10;
    if (!input.weightVerified) adjustmentPct += 0.08;
    const adjustmentReserveCents = round(worst.amountCents * Math.min(adjustmentPct, 0.30));
    const subtotal = worst.amountCents + insuranceCostCents + signatureCostCents +
      surchargeReserveCents + adjustmentReserveCents;
    const protectedShippingChargeCents = round(subtotal * (1 + pricingZonePolicy.zoneProtectionBufferPct));

    const newest = Math.max(...input.zoneSnapshots.map((x) => x.capturedAt.getTime()), 0);
    const quoteDataFresh = newest > 0 && Date.now() - newest <= pricingZonePolicy.staleAfterHours * 3_600_000;

    return {
      protectedBaseRateCents: worst.amountCents,
      insuranceCostCents,
      signatureCostCents,
      surchargeReserveCents,
      adjustmentReserveCents,
      protectedShippingChargeCents,
      shippingMarginCents: input.shippingPaidCents - protectedShippingChargeCents,
      quoteConfidenceScore: worst.complete && quoteDataFresh ? 95 : worst.amountCents > 0 ? 55 : 0,
      quoteDataComplete: worst.complete,
      quoteDataFresh,
      zoneSnapshots: input.zoneSnapshots,
      reasonCodes: [
        ...worst.reasonCodes,
        ...(!quoteDataFresh ? ["STALE_ZONE_QUOTES"] : [])
      ]
    };
  }
}
