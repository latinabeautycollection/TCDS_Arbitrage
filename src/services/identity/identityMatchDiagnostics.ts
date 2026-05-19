import type {
  IdentityMatchDiagnostics,
  IdentityMatchScore,
  NormalizedProductIdentity,
} from './commonIdentity';

export function buildIdentityMatchDiagnostics(input: {
  candidateIdentity: NormalizedProductIdentity;
  watchlistIdentity: NormalizedProductIdentity;
  score: IdentityMatchScore;
  narrowedBy: IdentityMatchDiagnostics['narrowedBy'];
}): IdentityMatchDiagnostics {
  const rejectionReasons: string[] = [];

  if (input.score.matchClass === 'weak_match' || input.score.matchClass === 'no_match') {
    if (input.score.brandScore === 0) rejectionReasons.push('brand_mismatch');
    if (input.score.productTypeScore === 0) rejectionReasons.push('product_type_mismatch');
    if (input.score.modelFamilyScore === 0) rejectionReasons.push('model_family_mismatch');
    if (input.score.accessoryCompatibilityScore === 0) rejectionReasons.push('accessory_mismatch');
    if (input.score.priceBandScore <= 0.10) rejectionReasons.push('price_band_mismatch');
  }

  return {
    candidateIdentity: input.candidateIdentity,
    watchlistIdentity: input.watchlistIdentity,
    score: input.score,
    rejectionReasons,
    narrowedBy: input.narrowedBy,
  };
}
