import type { AcquisitionCandidate, AcquisitionCategoryPolicy, FinancialModelOutput, MarketProfile, NormalizedIdentity, ShippingSignal } from '../contracts/acquisitionDecision';

export function buildAcquisitionFinancialModel(input: {
  candidate: AcquisitionCandidate;
  policy: AcquisitionCategoryPolicy;
  market: MarketProfile;
  identity: NormalizedIdentity;
  cashOnHandUsd: number;
  shippingSignal?: Partial<ShippingSignal> | null;
}): FinancialModelOutput {
  const estimatedPurchasePriceUsd = estimatePurchasePrice(input.candidate);
  const purchasePriceBasis = input.candidate.buyNowPrice && input.candidate.buyNowPrice > 0
    ? 'BUY_NOW_PRICE'
    : input.candidate.currentBidPrice && input.candidate.currentBidPrice > 0
      ? 'CURRENT_BID_PRICE'
      : input.candidate.currentPrice && input.candidate.currentPrice > 0
        ? 'CURRENT_PRICE'
        : 'MISSING_PRICE';
  const aggressiveResaleUsd = input.market.soldP75 ?? input.market.soldMedian ?? input.market.activeMedian;
  const expectedResaleUsd = input.market.soldMedian ?? input.market.activeMedian;
  const conservativeResaleUsd = conservativeResale(input.market);
  const shippingSignal = normalizeShippingSignal(input.candidate, input.policy, input.shippingSignal);
  const shippingEstimateUsd = round((input.candidate.inboundShippingUsd ?? 0) + shippingSignal.outboundShippingUsd + input.policy.shippingBufferUsd, 2);
  const resaleForModel = conservativeResaleUsd ?? expectedResaleUsd;

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
  const feesEstimateUsd = round(marketplaceFee + paymentFee, 2);
  const riskReserveUsd = round(returnReserveUsd + disputeReserveUsd + damageReserveUsd + insuranceReserveUsd + signatureReserveUsd + carrierRiskReserveUsd, 2);
  const expectedNetUsd = round(resaleForModel - feesEstimateUsd - shippingEstimateUsd - input.policy.packagingCostUsd - taxEstimateUsd - warehouseHandlingUsd - storageReserveUsd - riskReserveUsd, 2);
  const totalCostBasis = round(estimatedPurchasePriceUsd + taxEstimateUsd + shippingEstimateUsd + input.policy.packagingCostUsd + warehouseHandlingUsd + storageReserveUsd + riskReserveUsd, 2);
  const estimatedProfitUsd = round(expectedNetUsd - estimatedPurchasePriceUsd, 2);
  const estimatedRoi = totalCostBasis > 0 ? round(estimatedProfitUsd / totalCostBasis, 6) : null;
  const maxBidUsd = round(Math.max(0, expectedNetUsd - input.policy.minProfitUsd), 2);
  const availableForItems = Math.max(0, input.cashOnHandUsd * (1 - input.policy.cashReservePct));
  const capLimitedCash = Math.min(availableForItems, input.cashOnHandUsd * input.policy.maxItemCapitalPct);
  const affordableUnits = totalCostBasis > 0 ? Math.floor(capLimitedCash / totalCostBasis) : 0;
  const deployableUnits = Math.max(0, Math.min(input.candidate.quantityAvailable || 1, affordableUnits));
  const deployableCapitalUsd = round(deployableUnits * totalCostBasis, 2);
  const deployableProfitUsd = round(deployableUnits * estimatedProfitUsd, 2);
  const capitalEfficiency = deployableCapitalUsd > 0 ? round(deployableProfitUsd / deployableCapitalUsd, 6) : null;
  const days = input.market.estimatedDaysToSale ?? 60;
  const velocityEfficiency = deployableProfitUsd > 0 ? round(deployableProfitUsd / Math.max(1, days), 6) : null;
  const cashTurnProfit = capitalEfficiency !== null ? round(capitalEfficiency / Math.max(1, days), 8) : null;

  return { estimatedPurchasePriceUsd, purchasePriceBasis, aggressiveResaleUsd: roundNullable(aggressiveResaleUsd), expectedResaleUsd: roundNullable(expectedResaleUsd), conservativeResaleUsd: roundNullable(conservativeResaleUsd), feesEstimateUsd, shippingEstimateUsd, taxEstimateUsd: round(taxEstimateUsd, 2), warehouseHandlingUsd, storageReserveUsd, insuranceReserveUsd: round(insuranceReserveUsd, 2), signatureReserveUsd: round(signatureReserveUsd, 2), returnReserveUsd: round(returnReserveUsd, 2), disputeReserveUsd: round(disputeReserveUsd, 2), damageReserveUsd: round(damageReserveUsd, 2), carrierRiskReserveUsd: round(carrierRiskReserveUsd, 2), riskReserveUsd, expectedNetUsd, estimatedProfitUsd, estimatedRoi, maxBidUsd, deployableUnits, deployableCapitalUsd, deployableProfitUsd, capitalEfficiency, velocityEfficiency, cashTurnProfit, shippingSignal };
}

function estimatePurchasePrice(candidate: AcquisitionCandidate): number {
  const price = candidate.buyNowPrice ?? candidate.currentBidPrice ?? candidate.currentPrice ?? 0;
  if (candidate.buyNowPrice && candidate.buyNowPrice > 0) return round(candidate.buyNowPrice, 2);
  if (candidate.currentBidPrice && candidate.currentBidPrice > 0) return round(candidate.currentBidPrice * 1.08, 2);
  return round(price, 2);
}
function conservativeResale(market: MarketProfile): number | null { if (market.soldP25) return market.soldP25; if (market.soldMedian) return market.soldMedian * 0.9; if (market.activeMedian) return market.activeMedian * 0.8; return null; }
function normalizeShippingSignal(
  candidate: AcquisitionCandidate,
  policy: AcquisitionCategoryPolicy,
  signal?: Partial<ShippingSignal> | null,
): ShippingSignal {
  const fallbackEstimate = Number(readNested(candidate.opportunityReasonJson, ['shipping', 'outboundEstimateUsd']));
  const fallbackValue = Number.isFinite(fallbackEstimate) && fallbackEstimate > 0
    ? fallbackEstimate
    : policy.shippingBufferUsd;

  if (!signal || signal.source !== 'shipengine' || !Number.isFinite(Number(signal.outboundShippingUsd)) || Number(signal.outboundShippingUsd) <= 0) {
    return {
      source: signal?.source ?? 'missing',
      outboundShippingUsd: round(fallbackValue, 2),
      confidence: 0.35,
      carrierCode: signal?.carrierCode ?? null,
      serviceCode: signal?.serviceCode ?? null,
      requestId: signal?.requestId ?? null,
      riskFlags: unique([
        ...(signal?.riskFlags ?? []),
        'SHIPENGINE_RATE_MISSING_OR_INVALID',
        'SHIPPING_UNCERTAINTY',
      ]),
    };
  }

  const confidence = clamp(signal.confidence ?? 0.92, 0, 1);
  const riskFlags = [...(signal.riskFlags ?? [])];
  if (confidence < 0.80) riskFlags.push('SHIPENGINE_LOW_CONFIDENCE_RATE');
  if (confidence < 0.70) riskFlags.push('SHIPPING_UNCERTAINTY');

  return {
    source: 'shipengine',
    outboundShippingUsd: round(Number(signal.outboundShippingUsd), 2),
    confidence,
    carrierCode: signal.carrierCode ?? null,
    serviceCode: signal.serviceCode ?? null,
    requestId: signal.requestId ?? null,
    riskFlags: unique(riskFlags),
  };
}
function readNested(obj: Record<string, unknown>, path: string[]): unknown { let current: unknown = obj; for (const key of path) { if (!current || typeof current !== 'object') return undefined; current = (current as Record<string, unknown>)[key]; } return current; }
function emptyFinancial(input: { estimatedPurchasePriceUsd: number; purchasePriceBasis: string; shippingEstimateUsd: number; shippingSignal: ShippingSignal; policy: AcquisitionCategoryPolicy }): FinancialModelOutput { return { estimatedPurchasePriceUsd: input.estimatedPurchasePriceUsd, purchasePriceBasis: input.purchasePriceBasis, aggressiveResaleUsd: null, expectedResaleUsd: null, conservativeResaleUsd: null, feesEstimateUsd: 0, shippingEstimateUsd: input.shippingEstimateUsd, taxEstimateUsd: 0, warehouseHandlingUsd: input.policy.warehouseHandlingUsd, storageReserveUsd: input.policy.storageReserveUsd, insuranceReserveUsd: 0, signatureReserveUsd: 0, returnReserveUsd: 0, disputeReserveUsd: 0, damageReserveUsd: 0, carrierRiskReserveUsd: 0, riskReserveUsd: 0, expectedNetUsd: null, estimatedProfitUsd: null, estimatedRoi: null, maxBidUsd: null, deployableUnits: 0, deployableCapitalUsd: 0, deployableProfitUsd: 0, capitalEfficiency: null, velocityEfficiency: null, cashTurnProfit: null, shippingSignal: input.shippingSignal }; }
function unique<T>(arr: T[]): T[] { return Array.from(new Set(arr)); }
function roundNullable(value: number | null | undefined, places = 2): number | null { return typeof value === 'number' && Number.isFinite(value) ? round(value, places) : null; }
function round(value: number, places = 2): number { const factor = 10 ** places; return Math.round(value * factor) / factor; }
function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)); }

export const computeAcquisitionFinancialModel = buildAcquisitionFinancialModel;
