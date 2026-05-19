import { computeIdentityMatchScore } from '../services/identity/identityMatchScoring';
import type { NormalizedProductIdentity } from '../services/identity/commonIdentity';

function makeIdentity(partial: Partial<NormalizedProductIdentity>): NormalizedProductIdentity {
  return {
    categoryKey: null,
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
    identityConfidence: 0.5,
    isAccessory: false,
    isBundle: false,
    rawTokens: [],
    matchedSignals: [],
    ...partial,
  };
}

describe('computeIdentityMatchScore', () => {
  it('scores exact same product strongly', () => {
    const candidate = makeIdentity({
      categoryKey: 'audio',
      normalizedBrand: 'apple',
      normalizedProductType: 'earbuds',
      normalizedModelFamily: 'airpods_pro',
      canonicalProductKey: 'audio|apple|earbuds|airpods_pro|gen2',
      normalizedGeneration: 'gen2',
      identityConfidence: 0.9,
    });

    const watchlist = makeIdentity({
      categoryKey: 'audio',
      normalizedBrand: 'apple',
      normalizedProductType: 'earbuds',
      normalizedModelFamily: 'airpods_pro',
      canonicalProductKey: 'audio|apple|earbuds|airpods_pro|gen2',
      normalizedGeneration: 'gen2',
      identityConfidence: 0.9,
    });

    const score = computeIdentityMatchScore({
      candidate,
      watchlist,
      candidateTitle: 'Apple AirPods Pro 2nd Gen',
      watchlistFamilyName: 'Apple AirPods Pro 2nd Generation',
      candidateTotalCost: 120,
      predictedBuyCostUsd: 130,
    });

    expect(['exact_match', 'strong_family_match']).toContain(score.matchClass);
  });
});
