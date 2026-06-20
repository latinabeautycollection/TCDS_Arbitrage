export type AcquisitionDecisionStatus = 'BUY' | 'WATCH' | 'REVIEW' | 'REJECT';
export type AcquisitionDecisionRank = 'BUY_A_PLUS' | 'BUY_A' | 'BUY_B' | 'WATCH_A' | 'WATCH_B' | 'REVIEW' | 'REJECT';
export type ConfidenceBand = 'HIGH' | 'MEDIUM' | 'LOW';

export interface AcquisitionCandidate {
  opportunityQueueId: number;
  candidateId: number | null;
  listingId: string;
  watchlistId: number | null;
  title: string;
  normalizedTitle: string | null;
  description: string | null;
  brand: string | null;
  model: string | null;
  categoryKey: string | null;
  conditionText: string | null;
  currentPrice: number | null;
  currentBidPrice: number | null;
  buyNowPrice: number | null;
  inboundShippingUsd: number | null;
  quantityAvailable: number;
  opportunityReasonJson: Record<string, unknown>;
  watchlistJson: Record<string, unknown>;
  ebayMarketJson: Record<string, unknown>;
}

export interface AcquisitionCategoryPolicy {
  policyVersion: string;
  scoringVersion: string;
  categoryKey: string;
  minSoldCount: number;
  minProfitUsd: number;
  minRoi: number;
  maxActiveSoldRatio: number;
  minIdentityConfidence: number;
  minCompQuality: number;
  maxVolatility: number;
  returnRiskRate: number;
  damageRiskRate: number;
  disputeRiskRate: number;
  marketplaceFeeRate: number;
  paymentFeeRate: number;
  salesTaxRate: number;
  warehouseHandlingUsd: number;
  storageReserveUsd: number;
  packagingCostUsd: number;
  insuranceReserveRate: number;
  signatureReserveUsd: number;
  carrierRiskRate: number;
  shippingBufferUsd: number;
  maxItemCapitalPct: number;
  maxCategoryCapitalPct: number;
  maxFamilyCapitalPct: number;
  cashReservePct: number;
  highProfitReviewMultiplier: number;
  minSafetyScoreForBuy: number;
  categoryRankWeight: number;
}

export interface NormalizedIdentity {
  originalTitle: string;
  normalizedTitle: string;
  categoryKey: string;
  familyKey: string;
  brand: string | null;
  model: string | null;
  variant: string | null;
  storageGb: number | null;
  color: string | null;
  carrierState: 'unlocked' | 'locked' | 'unknown';
  bundleState: 'bare' | 'kit' | 'bundle' | 'body_only' | 'lens_only' | 'accessory_only' | 'unknown';
  conditionState: 'new' | 'open_box' | 'used' | 'parts_only' | 'untested' | 'unknown';
  accessorySignals: string[];
  requiredAttributesMissing: string[];
  ambiguityFlags: string[];
  identityConfidence: number;
  fingerprint: string;
}

export interface NormalizedComp {
  source: 'sold' | 'active';
  itemId: string | null;
  title: string;
  normalizedTitle: string;
  priceUsd: number;
  conditionText: string | null;
  accepted: boolean;
  rejectionReason: string | null;
  similarityScore: number;
  raw: Record<string, unknown>;
}

export interface CompSelectionResult {
  soldComps: NormalizedComp[];
  activeComps: NormalizedComp[];
  acceptedComps: NormalizedComp[];
  rejectedComps: NormalizedComp[];
  outlierCount: number;
  compQualityScore: number;
  reasonCodes: string[];
  riskFlags: string[];
}

export interface MarketProfile {
  soldCount: number;
  activeCount: number;
  activeToSoldRatio: number | null;
  sellThroughRate: number;
  soldMedian: number | null;
  soldP25: number | null;
  soldP75: number | null;
  activeMedian: number | null;
  volatilityScore: number;
  saturationScore: number;
  liquidityScore: number;
  estimatedDaysToSale: number | null;
}

export interface ShippingSignal {
  source: 'shipengine' | 'direct_carrier' | 'policy_estimate' | 'candidate_estimate' | 'missing';
  outboundShippingUsd: number;
  confidence: number;
  carrierCode: string | null;
  serviceCode: string | null;
  requestId: string | null;
  riskFlags: string[];
}

export interface CapitalExposureSnapshot {
  categoryExposureUsd: number;
  familyExposureUsd: number;
  skuExposureUsd: number;
}

export interface FinancialModelOutput {
  estimatedPurchasePriceUsd: number;
  purchasePriceBasis: string;
  aggressiveResaleUsd: number | null;
  expectedResaleUsd: number | null;
  conservativeResaleUsd: number | null;
  feesEstimateUsd: number;
  shippingEstimateUsd: number;
  taxEstimateUsd: number;
  warehouseHandlingUsd: number;
  storageReserveUsd: number;
  insuranceReserveUsd: number;
  signatureReserveUsd: number;
  returnReserveUsd: number;
  disputeReserveUsd: number;
  damageReserveUsd: number;
  carrierRiskReserveUsd: number;
  riskReserveUsd: number;
  expectedNetUsd: number | null;
  estimatedProfitUsd: number | null;
  estimatedRoi: number | null;
  maxBidUsd: number | null;
  deployableUnits: number;
  deployableCapitalUsd: number;
  deployableProfitUsd: number;
  capitalEfficiency: number | null;
  velocityEfficiency: number | null;
  cashTurnProfit: number | null;
  shippingSignal: ShippingSignal;
}

export interface SafetyEvaluation {
  ok: boolean;
  safetyScore: number;
  blockingReasons: string[];
  reviewReasons: string[];
  replayCertificationStatus: 'PASSED' | 'FAILED' | 'NOT_AVAILABLE';
  compGroundingStatus: 'PASSED' | 'FAILED' | 'NOT_AVAILABLE';
  mutationLedgerStatus: 'READY' | 'NOT_AVAILABLE';
}

export interface RuleEvaluation {
  status: AcquisitionDecisionStatus;
  rank: AcquisitionDecisionRank;
  reasonCodes: string[];
  riskFlags: string[];
  confidenceScore: number;
  confidenceBand: ConfidenceBand;
  riskScore: number;
  priorityScore: number;
  explanationSummary: string;
}

export interface ScoredAcquisitionDecision {
  candidate: AcquisitionCandidate;
  policy: AcquisitionCategoryPolicy;
  identity: NormalizedIdentity;
  comps: CompSelectionResult;
  market: MarketProfile;
  financial: FinancialModelOutput;
  safety: SafetyEvaluation;
  rules: RuleEvaluation;
  correlationId: string;
  portfolioBatchId: string;
  inputHash: string;
  allocationPosition: number | null;
}

export interface AllocationResult {
  decisions: ScoredAcquisitionDecision[];
  allocatedCapitalUsd: number;
  remainingCapitalUsd: number;
  skippedForCapitalCount: number;
}
