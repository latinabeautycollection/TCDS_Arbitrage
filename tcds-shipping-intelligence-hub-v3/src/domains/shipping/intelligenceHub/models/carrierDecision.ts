import type { RateQuote } from "./pricingIntelligence";

export interface ScoredRateQuote {
  quote: RateQuote;
  totalScore: number;
  normalizedCostScore: number;
  reliabilityScore: number;
  laneScore: number;
  trackingScore: number;
  confidencePenalty: number;
  serviceCommitmentPass: boolean;
  reasonCodes: string[];
}

export interface CarrierDecision {
  selected?: ScoredRateQuote;
  ranked: ScoredRateQuote[];
  rejectedQuoteIds: string[];
  noEligibleRate: boolean;
  reasonCodes: string[];
}
