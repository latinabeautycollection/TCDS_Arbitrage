import { carrierMeetsProtectionRequirements } from "../policies/carrierEligibilityPolicy";
import { isServiceEligible } from "../policies/serviceLevelPolicy";
import { scoreCarrierReliability, type CarrierPerformance } from "../scoring/carrierReliabilityScorer";
import { scoreLanePerformance } from "../scoring/lanePerformanceScorer";
import type { CarrierDecision, ScoredRateQuote } from "../models/carrierDecision";
import type { DestinationClass } from "../models/destinationIntelligence";
import type { RateQuote } from "../models/pricingIntelligence";

export class CarrierSelectionIntelligenceEngine {
  select(input: {
    quotes: RateQuote[];
    now: Date;
    maxQuoteAgeMinutes: number;
    destinationClass: DestinationClass;
    requirements: {
      signatureRequired: boolean;
      adultSignatureRequired: boolean;
      restrictedDeliveryRequired: boolean;
      insuranceRequired: boolean;
      insuranceMechanism: "NONE" | "THIRD_PARTY" | "CARRIER_DECLARED_VALUE";
      insuredValueCents: number;
    };
    carrierPerformance?: Record<string, CarrierPerformance | undefined>;
    lanePerformance?: Record<string, {
      onTimeRate: number; exceptionRate: number; claimRate: number; sampleSize: number;
    } | undefined>;
  }): CarrierDecision {
    const rejected: string[] = [];
    const eligible = input.quotes.filter((quote) => {
      const fresh = input.now.getTime() - quote.quotedAt.getTime() <= input.maxQuoteAgeMinutes * 60_000 &&
        (!quote.validUntil || quote.validUntil.getTime() > input.now.getTime());
      const pass =
        quote.purpose === "ACTUAL_DESTINATION" &&
        fresh &&
        isServiceEligible(quote, input.destinationClass) &&
        carrierMeetsProtectionRequirements(quote, input.requirements);
      if (!pass) rejected.push(quote.quoteId);
      return pass;
    });

    if (!eligible.length) {
      return { ranked: [], rejectedQuoteIds: rejected, noEligibleRate: true, reasonCodes: ["NO_FRESH_ELIGIBLE_ACTUAL_DESTINATION_RATE"] };
    }

    const minCost = Math.min(...eligible.map((q) => q.totalChargeCents));
    const maxCost = Math.max(...eligible.map((q) => q.totalChargeCents));
    const spread = Math.max(1, maxCost - minCost);

    const ranked: ScoredRateQuote[] = eligible.map((quote) => {
      const reliability = scoreCarrierReliability(input.carrierPerformance?.[quote.carrierCode]);
      const lane = scoreLanePerformance(input.lanePerformance?.[`${quote.carrierCode}:${quote.serviceCode}`]);
      const normalizedCostScore = 100 - ((quote.totalChargeCents - minCost) / spread) * 100;
      const trackingScore = quote.trackingQualityScore ?? 0;
      const dataConfidence = [
        quote.onTimeProbability !== undefined,
        quote.trackingQualityScore !== undefined,
        quote.commitmentType !== "UNKNOWN"
      ].filter(Boolean).length / 3;
      const confidencePenalty = (1 - dataConfidence) * 25;
      const onTimeScore = (quote.onTimeProbability ?? 0) * 100;

      const totalScore =
        normalizedCostScore * 0.35 +
        reliability * 0.20 +
        lane * 0.15 +
        trackingScore * 0.10 +
        onTimeScore * 0.20 -
        confidencePenalty;

      return {
        quote,
        totalScore,
        normalizedCostScore,
        reliabilityScore: reliability,
        laneScore: lane,
        trackingScore,
        confidencePenalty,
        serviceCommitmentPass: true,
        reasonCodes: ["ACTUAL_DESTINATION_RATE", "FRESH_RATE", "PROTECTION_CAPABILITIES_VERIFIED"]
      };
    }).sort((a, b) =>
      b.totalScore - a.totalScore ||
      a.quote.totalChargeCents - b.quote.totalChargeCents ||
      a.quote.carrierCode.localeCompare(b.quote.carrierCode)
    );

    return {
      selected: ranked[0],
      ranked,
      rejectedQuoteIds: rejected,
      noEligibleRate: false,
      reasonCodes: ["BEST_RISK_ADJUSTED_ACTUAL_DESTINATION_RATE_SELECTED"]
    };
  }
}
