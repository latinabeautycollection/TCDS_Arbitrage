import type {
  AcquisitionCandidate,
  AcquisitionCategoryPolicy,
  FinancialModelOutput,
  MarketProfile,
  NormalizedIdentity,
  ShippingSignal,
} from '../contracts/acquisitionDecision';

/**
 * Financial model — Green Tier 1 production rewrite.
 *
 * Design goals:
 * - Accurate max bid for dynamic auctions.
 * - Conservative enough to protect profit, not so conservative that good $1 bid auctions disappear.
 * - Shipping uncertainty affects reserves/confidence, not automatic rejection.
 */
export function buildAcquisitionFinancialModel(input: {
  candidate: AcquisitionCandidate;
  policy: AcquisitionCategoryPolicy;
  market: MarketProfile;
  identity: NormalizedIdentity;
  cashOnHandUsd: number;
  shippingSignal?: Partial<ShippingSignal> | null;
}): FinancialModelOutput {
  const estimatedPurchasePriceUsd = estimatePurchasePrice(input.candidate, input.market.soldMedian);
  const purchasePriceBasis = purchaseBasis(input.candidate);
  const aggressiveResaleUsd = input.market.soldP75 ?? input.market.soldMedian ?? input.market.activeMedian;
  const expectedResaleUsd = input.market.soldMedian ?? input.market.activeMedian;
  const conservativeResaleUsd = conservativeResale(input.market);
  const resaleForModel = conservativeResaleUsd ?? expectedResaleUsd;
  const shippingSignal = normalizeShippingSignal(input.candidate, input.policy, input.identity, input.shippingSignal);
  const inboundShippingUsd = money(input.candidate.inboundShippingUsd ?? 0);
  const shippingEstimateUsd = money(inboundShippingUsd + shippingSignal.outboundShippingUsd + input.policy.shippingBufferUsd);

  if (!resaleForModel || estimatedPurchasePriceUsd <= 0) {
    return emptyFinancial({ estimatedPurchasePriceUsd, purchasePriceBasis, shippingEstimateUsd, shippingSignal, policy: input.policy });
  }

  const marketplaceFee = resaleForModel * input.policy.marketplaceFeeRate;
  const paymentFee = resaleForModel * input.policy.paymentFeeRate;
  const taxEstimateUsd = estimatedPurchasePriceUsd * input.policy.salesTaxRate;
  const warehouseHandlingUsd = input.policy.warehouseHandlingUsd;
  const storageReserveUsd = input.policy.storageReserveUsd;
  const insuranceReserveUsd = resaleForModel * input.policy.insuranceReserveRate;
  const signatureReserveUsd = resaleForModel >= 250 ? input.policy.signatureReserveUsd : 0;
  const returnReserveUsd = resaleForModel * input.policy.returnRiskRate;
  const disputeReserveUsd = resaleForModel * input.policy.disputeRiskRate;
  const damageReserveUsd = resaleForModel * input.policy.damageRiskRate;
  const carrierRiskReserveUsd = resaleForModel * input.policy.carrierRiskRate * (1 - shippingSignal.confidence);
  const feesEstimateUsd = money(marketplaceFee + paymentFee);
  const riskReserveUsd = money(
    returnReserveUsd
      + disputeReserveUsd
      + damageReserveUsd
      + insuranceReserveUsd
      + signatureReserveUsd
      + carrierRiskReserveUsd,
  );

  const variableNonPurchaseCosts = money(
    feesEstimateUsd
      + shippingEstimateUsd
      + input.policy.packagingCostUsd
      + taxEstimateUsd
      + warehouseHandlingUsd
      + storageReserveUsd
      + riskReserveUsd,
  );

  const expectedNetUsd = money(resaleForModel - variableNonPurchaseCosts);
  const totalCostBasis = money(estimatedPurchasePriceUsd + variableNonPurchaseCosts);
  const estimatedProfitUsd = money(expectedNetUsd - estimatedPurchasePriceUsd);
  const estimatedRoi = totalCostBasis > 0 ? round(estimatedProfitUsd / totalCostBasis, 6) : null;

  // Max bid is the most important acquisition number. It preserves required profit after all modeled costs.
  const maxBidUsd = money(Math.max(0, expectedNetUsd - input.policy.minProfitUsd));

  const availableForItems = Math.max(0, input.cashOnHandUsd * (1 - input.policy.cashReservePct));
  const maxItemCapital = Math.max(0, input.cashOnHandUsd * input.policy.maxItemCapitalPct);
  const capLimitedCash = Math.min(availableForItems, maxItemCapital);
  const quantityAvailable = Math.max(1, input.candidate.quantityAvailable || 1);
  const affordableUnits = totalCostBasis > 0 ? Math.floor(capLimitedCash / totalCostBasis) : 0;
  const deployableUnits = Math.max(0, Math.min(quantityAvailable, affordableUnits));
  const deployableCapitalUsd = money(deployableUnits * totalCostBasis);
  const deployableProfitUsd = money(deployableUnits * estimatedProfitUsd);
  const capitalEfficiency = deployableCapitalUsd > 0 ? round(deployableProfitUsd / deployableCapitalUsd, 6) : null;
  const days = input.market.estimatedDaysToSale ?? 60;
  const velocityEfficiency = deployableProfitUsd > 0 ? round(deployableProfitUsd / Math.max(1, days), 6) : null;
  const cashTurnProfit = capitalEfficiency !== null ? round(capitalEfficiency / Math.max(1, days), 8) : null;

  return {
    estimatedPurchasePriceUsd,
    purchasePriceBasis,
    aggressiveResaleUsd: roundNullable(aggressiveResaleUsd),
    expectedResaleUsd: roundNullable(expectedResaleUsd),
    conservativeResaleUsd: roundNullable(conservativeResaleUsd),
    feesEstimateUsd,
    shippingEstimateUsd,
    taxEstimateUsd: money(taxEstimateUsd),
    warehouseHandlingUsd,
    storageReserveUsd,
    insuranceReserveUsd: money(insuranceReserveUsd),
    signatureReserveUsd: money(signatureReserveUsd),
    returnReserveUsd: money(returnReserveUsd),
    disputeReserveUsd: money(disputeReserveUsd),
    damageReserveUsd: money(damageReserveUsd),
    carrierRiskReserveUsd: money(carrierRiskReserveUsd),
    riskReserveUsd,
    expectedNetUsd,
    estimatedProfitUsd,
    estimatedRoi,
    maxBidUsd,
    deployableUnits,
    deployableCapitalUsd,
    deployableProfitUsd,
    capitalEfficiency,
    velocityEfficiency,
    cashTurnProfit,
    shippingSignal,
  };
}

function estimatePurchasePrice(candidate: AcquisitionCandidate, acceptedCompMedian: number | null): number {
  if (candidate.buyNowPrice && candidate.buyNowPrice > 0) return money(candidate.buyNowPrice);
  if (candidate.currentBidPrice && candidate.currentBidPrice > 0) {
    const bid = candidate.currentBidPrice;
    const compFloor = acceptedCompMedian && acceptedCompMedian > 0 ? acceptedCompMedian * 0.35 : 0;
    return money(Math.max(bid * 1.75, compFloor, bid + 25));
  }
  if (candidate.currentPrice && candidate.currentPrice > 0) return money(candidate.currentPrice);
  return 0;
}

function purchaseBasis(candidate: AcquisitionCandidate): string {
  if (candidate.buyNowPrice && candidate.buyNowPrice > 0) return 'BUY_NOW_PRICE';
  if (candidate.currentBidPrice && candidate.currentBidPrice > 0) return 'CURRENT_BID_PRICE_PLUS_BID_BUFFER';
  if (candidate.currentPrice && candidate.currentPrice > 0) return 'CURRENT_PRICE';
  return 'MISSING_PRICE';
}

function conservativeResale(market: MarketProfile): number | null {
  if (market.soldP25) return market.soldP25;
  if (market.soldMedian) return market.soldMedian * 0.92;
  if (market.activeMedian) return market.activeMedian * 0.82;
  return null;
}

function normalizeShippingSignal(
  candidate: AcquisitionCandidate,
  policy: AcquisitionCategoryPolicy,
  identity: NormalizedIdentity,
  signal?: Partial<ShippingSignal> | null,
): ShippingSignal {
  const fallbackEstimate = Number(readNested(candidate.opportunityReasonJson, ['shipping', 'outboundEstimateUsd']));
  const categoryDefault = defaultOutboundShipping(identity.categoryKey, policy.shippingBufferUsd);
  const fallbackValue = Number.isFinite(fallbackEstimate) && fallbackEstimate > 0 ? fallbackEstimate : categoryDefault;

  if (!signal || signal.source !== 'shipengine' || !Number.isFinite(Number(signal.outboundShippingUsd)) || Number(signal.outboundShippingUsd) <= 0) {
    return {
      source: signal?.source ?? 'candidate_estimate',
      outboundShippingUsd: money(fallbackValue),
      confidence: 0.58,
      carrierCode: signal?.carrierCode ?? null,
      serviceCode: signal?.serviceCode ?? null,
      requestId: signal?.requestId ?? null,
      riskFlags: unique([
        ...(signal?.riskFlags ?? []),
        'SHIPENGINE_RATE_MISSING_OR_INVALID',
        'SHIPPING_ESTIMATE_USED',
      ]),
    };
  }

  const confidence = clamp(signal.confidence ?? 0.92, 0, 1);
  const riskFlags = [...(signal.riskFlags ?? [])];
  if (confidence < 0.80) riskFlags.push('SHIPENGINE_LOW_CONFIDENCE_RATE');
  if (confidence < 0.70) riskFlags.push('SHIPPING_UNCERTAINTY');

  return {
    source: 'shipengine',
    outboundShippingUsd: money(Number(signal.outboundShippingUsd)),
    confidence,
    carrierCode: signal.carrierCode ?? null,
    serviceCode: signal.serviceCode ?? null,
    requestId: signal.requestId ?? null,
    riskFlags: unique(riskFlags),
  };
}

function defaultOutboundShipping(categoryKey: string, fallback: number): number {
  const key = categoryKey.toLowerCase();
  if (key.includes('phone') || key.includes('watch')) return 6.95;
  if (key.includes('audio') || key.includes('headphone')) return 7.95;
  if (key.includes('game') || key.includes('console')) return 12.95;
  if (key.includes('camera') || key.includes('lens')) return 10.95;
  if (key.includes('computer') || key.includes('laptop')) return 16.95;
  return fallback > 0 ? fallback : 9.95;
}

function readNested(obj: Record<string, unknown> | undefined, path: string[]): unknown {
  let current: unknown = obj;
  for (const key of path) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function emptyFinancial(input: {
  estimatedPurchasePriceUsd: number;
  purchasePriceBasis: string;
  shippingEstimateUsd: number;
  shippingSignal: ShippingSignal;
  policy: AcquisitionCategoryPolicy;
}): FinancialModelOutput {
  return {
    estimatedPurchasePriceUsd: input.estimatedPurchasePriceUsd,
    purchasePriceBasis: input.purchasePriceBasis,
    aggressiveResaleUsd: null,
    expectedResaleUsd: null,
    conservativeResaleUsd: null,
    feesEstimateUsd: 0,
    shippingEstimateUsd: input.shippingEstimateUsd,
    taxEstimateUsd: 0,
    warehouseHandlingUsd: input.policy.warehouseHandlingUsd,
    storageReserveUsd: input.policy.storageReserveUsd,
    insuranceReserveUsd: 0,
    signatureReserveUsd: 0,
    returnReserveUsd: 0,
    disputeReserveUsd: 0,
    damageReserveUsd: 0,
    carrierRiskReserveUsd: 0,
    riskReserveUsd: 0,
    expectedNetUsd: null,
    estimatedProfitUsd: null,
    estimatedRoi: null,
    maxBidUsd: null,
    deployableUnits: 0,
    deployableCapitalUsd: 0,
    deployableProfitUsd: 0,
    capitalEfficiency: null,
    velocityEfficiency: null,
    cashTurnProfit: null,
    shippingSignal: input.shippingSignal,
  };
}

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function roundNullable(value: number | null | undefined, places = 2): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? round(value, places) : null;
}

function money(value: number): number {
  return round(value, 2);
}

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export const computeAcquisitionFinancialModel = buildAcquisitionFinancialModel;
