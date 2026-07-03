export type ListingDecision = 'APPROVE_DRAFT' | 'HUMAN_REVIEW' | 'BLOCK';
export type DraftStatus = 'GENERATED' | 'APPROVED' | 'REJECTED' | 'PUBLISHED' | 'ERROR';

export interface ListingSourceInput {
  sourceListingNormalizedId: number;
  arbitrageDecisionId?: number | null;
  title: string;
  brand?: string | null;
  model?: string | null;
  mpn?: string | null;
  gtin?: string | null;
  conditionText?: string | null;
  category?: string | null;
  imageUrls: string[];
  descriptionRaw?: string | null;
  descriptionClean?: string | null;
  listingUrl?: string | null;
  recommendedSalePriceUsd: number;
  minAcceptablePriceUsd?: number | null;
  inboundShippingUsd?: number | null;
  totalCostBasisUsd?: number | null;
  expectedProfitUsd?: number | null;
  riskFlags?: string[];
  processRunId?: string | null;
}

export interface GeneratedListingDraft {
  title: string;
  subtitle?: string | null;
  descriptionHtml: string;
  bulletPoints: string[];
  seoKeywords: string[];
  itemSpecifics: Record<string, string | string[]>;
  conditionId?: string | null;
  conditionText: string;
  defectDisclosures: string[];
  listingFormat: 'FIXED_PRICE' | 'AUCTION';
  listingDuration: 'GTC' | 'DAYS_7' | 'DAYS_10';
  quantity: number;
  listingPriceUsd: number;
  minAcceptablePriceUsd?: number | null;
  categoryId?: string | null;
  photoUrls: string[];
}

export interface ListingQualityScores {
  titleCompletenessScore: number;
  keywordCoverageScore: number;
  itemSpecificsCompletenessScore: number;
  conditionClarityScore: number;
  flawDisclosureScore: number;
  imageQualityScore: number;
  shippingPromiseScore: number;
  returnPolicyScore: number;
  priceCompetitivenessScore: number;
  expectedConversionProbability: number;
  persuasiveCopyScore: number;
  complianceScore: number;
  overallScore: number;
}

export interface ConsensusDecision {
  decision: ListingDecision;
  score: number;
  reasons: string[];
  blockers: string[];
  revisionRequired: boolean;
  humanReviewRequired: boolean;
  trace: Record<string, unknown>;
}
