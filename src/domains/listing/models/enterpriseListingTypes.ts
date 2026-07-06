export type AiProviderName = 'openai' | 'claude' | 'gemini';
export type EnterpriseListingDecision = 'APPROVE_DRAFT' | 'HUMAN_REVIEW' | 'BLOCK' | 'REVISE' | 'AUTO_OPTIMIZE';
export type CategorySpecialistName = 'electronics' | 'luxury' | 'collectibles' | 'gaming' | 'home_goods' | 'industrial' | 'generic';

export interface ProductDigitalTwin {
  sourceListingNormalizedId: number;
  candidateId?: number;
  listingId?: string;
  ebayListingFk?: number;
  categoryKey?: string;
  ebayCategoryId?: string;
  identity: {
    title?: string;
    brand?: string;
    model?: string;
    mpn?: string;
    gtin?: string;
    epid?: string;
    canonicalProductKey?: string;
    confidenceScore: number;
  };
  economics: {
    acquisitionPriceUsd?: number;
    expectedSalePriceUsd?: number;
    minAcceptablePriceUsd?: number;
    expectedProfitUsd?: number;
    roiPct?: number;
    marginPct?: number;
  };
  market: {
    soldCompCount?: number;
    activeCompCount?: number;
    medianSoldPriceUsd?: number;
    sellThroughRate?: number;
    expectedDaysToSell?: number;
  };
  condition: {
    sourceConditionText?: string;
    normalizedCondition?: string;
    defects: string[];
    missingAccessories: string[];
    disclosureRequired: boolean;
    conditionConfidenceScore: number;
  };
  photos: Array<{
    originalUrl: string;
    processedUrl?: string;
    role: 'PRIMARY' | 'DETAIL' | 'DEFECT' | 'ACCESSORY' | 'PACKAGING';
    complianceScore?: number;
    visualFindings?: string[];
  }>;
  risk: {
    returnRiskScore: number;
    disputeRiskScore: number;
    accountRiskScore: number;
    riskFlags: string[];
  };
  listing: {
    title?: string;
    descriptionHtml?: string;
    bulletPoints: string[];
    itemSpecifics: Record<string, string>;
    seoKeywords: string[];
    conversionScore?: number;
  };
}

export interface AiRoutePerformance {
  provider: AiProviderName;
  taskName: string;
  categorySpecialist: CategorySpecialistName;
  successRate: number;
  averageQualityScore: number;
  averageLatencyMs: number;
  averageCostUsd: number;
  lastUsedAt?: string;
}

export interface OptimizationObjectiveWeights {
  seo: number;
  conversion: number;
  profit: number;
  risk: number;
  accountHealth: number;
  velocity: number;
}

export interface MultiObjectiveScore {
  seoScore: number;
  conversionScore: number;
  profitScore: number;
  riskAdjustedScore: number;
  accountHealthScore: number;
  velocityScore: number;
  totalScore: number;
  explanation: string[];
}

export interface LiveListingFeedback {
  ebayListingFk: number;
  sourceListingNormalizedId?: number;
  impressions: number;
  clicks: number;
  watchers: number;
  offersReceived: number;
  conversions: number;
  sellThroughDays?: number;
  returnCount: number;
  disputeCount: number;
}

export interface AutonomousRevisionRecommendation {
  ebayListingFk: number;
  revisionType: 'PRICE' | 'TITLE' | 'DESCRIPTION' | 'SPECIFICS' | 'STATUS';
  reason: string;
  oldValue: unknown;
  newValue: unknown;
  expectedImpactScore: number;
  humanApprovalRequired: boolean;
}
