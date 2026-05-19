export interface NormalizedProductIdentity {
  categoryKey: string | null;
  normalizedBrand: string | null;
  normalizedProductType: string | null;
  normalizedModelFamily: string | null;
  normalizedModelToken: string | null;
  normalizedGeneration: string | null;
  normalizedVariant: string | null;
  normalizedStorage: string | null;
  normalizedColor: string | null;
  normalizedPlatform: string | null;
  canonicalProductKey: string | null;
  identityConfidence: number;
  isAccessory: boolean;
  isBundle: boolean;
  rawTokens: string[];
  matchedSignals: string[];
}

export interface IdentityMatchScore {
  canonicalKeyScore: number;
  brandScore: number;
  productTypeScore: number;
  modelFamilyScore: number;
  modelTokenScore: number;
  generationScore: number;
  variantScore: number;
  storageScore: number;
  platformScore: number;
  accessoryCompatibilityScore: number;
  bundleCompatibilityScore: number;
  titleSimilarityScore: number;
  priceBandScore: number;
  identityConfidenceScore: number;
  finalScore: number;
  matchClass: 'exact_match' | 'strong_family_match' | 'probable_match' | 'weak_match' | 'no_match';
}

export interface IdentityMatchDiagnostics {
  candidateIdentity: NormalizedProductIdentity;
  watchlistIdentity: NormalizedProductIdentity;
  score: IdentityMatchScore;
  rejectionReasons: string[];
  narrowedBy: {
    category: boolean;
    brand: boolean;
    productType: boolean;
    accessoryCompatibility: boolean;
    bundleCompatibility: boolean;
  };
}

export function emptyIdentity(categoryKey: string | null = null): NormalizedProductIdentity {
  return {
    categoryKey,
    normalizedBrand: null,
    normalizedProductType: null,
    normalizedModelFamily: null,
    normalizedModelToken: null,
    normalizedGeneration: null,
    normalizedVariant: null,
    normalizedStorage: null,
    normalizedColor: null,
    normalizedPlatform: null,
    canonicalProductKey: null,
    identityConfidence: 0,
    isAccessory: false,
    isBundle: false,
    rawTokens: [],
    matchedSignals: [],
  };
}
