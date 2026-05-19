import type { CarrierCode, ShippingClass, ShippingModelInput, ShippingModelOutput } from '../contracts/acquisitionExecutionIntegrity';

const CATEGORY_OVERSIZE_HINTS = ['appliance', 'monitor', 'speaker', 'printer', 'receiver', 'tool_chest'];
const CATEGORY_FRAGILE_HINTS = ['camera', 'lens', 'glass', 'appliance', 'monitor', 'audio', 'tablet', 'phone'];
const TITLE_FRAGILE_HINTS = ['glass', 'lens', 'camera', 'screen', 'monitor', 'receiver', 'speaker', 'ceramic'];
const TITLE_OVERSIZE_HINTS = ['floorstanding', 'subwoofer', 'printer', 'projector screen', 'large', 'oversize'];

export function modelAcquisitionShipping(input: ShippingModelInput): ShippingModelOutput {
  const highValueThreshold = input.highValueThresholdUsd ?? 250;
  const estimatedSalePriceUsd = positive(input.estimatedSalePriceUsd);
  const itemCostUsd = positive(input.itemCostUsd);
  const title = `${input.title ?? ''} ${input.descriptionClean ?? ''}`.toLowerCase();
  const category = (input.categoryKey ?? '').toLowerCase();

  const dimensionalWeightLb = calculateDimensionalWeight(input.lengthIn, input.widthIn, input.heightIn);
  const physicalWeightLb = positive(input.weightLb) || estimateWeightFromSignals(category, title);
  const billableWeightLb = round(Math.max(physicalWeightLb, dimensionalWeightLb ?? 0), 2);

  const oversized = isOversized(input, billableWeightLb, category, title);
  const fragile = Boolean(input.fragileSignal) || hasAny(category, CATEGORY_FRAGILE_HINTS) || hasAny(title, TITLE_FRAGILE_HINTS);
  const highValue = estimatedSalePriceUsd >= highValueThreshold;
  const shippingClass = classifyShipping({ billableWeightLb, oversized, fragile, highValue, category, title });

  const inboundShippingUsd = round(input.sourceShippingUsd ?? estimateInboundShipping(shippingClass, billableWeightLb), 2);
  const outboundShippingUsd = round(estimateOutboundShipping(shippingClass, billableWeightLb, input.destinationZone), 2);
  const packagingCostUsd = round(estimatePackagingCost(shippingClass, fragile), 2);
  const insuranceReserveUsd = round(highValue ? Math.max(2.5, estimatedSalePriceUsd * 0.0125) : 0, 2);
  const signatureReserveUsd = round(estimatedSalePriceUsd >= 750 ? 7.5 : highValue ? 4.25 : 0, 2);
  const damageReserveUsd = round(estimatedSalePriceUsd * damageReserveRate(shippingClass, fragile), 2);
  const shippingRiskScore = clamp01(
    (oversized ? 0.28 : 0) +
      (fragile ? 0.24 : 0) +
      (highValue ? 0.12 : 0) +
      (billableWeightLb > 20 ? 0.14 : 0) +
      (input.sourceShippingUsd == null ? 0.10 : 0) +
      (input.weightLb == null ? 0.08 : 0),
  );
  const shippingConfidenceScore = clamp01(
    1 -
      (input.sourceShippingUsd == null ? 0.18 : 0) -
      (input.weightLb == null ? 0.18 : 0) -
      (input.lengthIn == null || input.widthIn == null || input.heightIn == null ? 0.16 : 0) -
      (shippingClass === 'UNKNOWN' ? 0.18 : 0),
  );

  const returnReserveUsd = round(estimatedSalePriceUsd * (fragile ? 0.035 : 0.02), 2);
  const disputeReserveUsd = round(estimatedSalePriceUsd * (highValue || fragile ? 0.025 : 0.01), 2);
  const outboundCarrierPreference = chooseCarrier(shippingClass, billableWeightLb, highValue);

  const reasonCodes: string[] = [];
  if (oversized) reasonCodes.push('OVERSIZE_SHIPPING_RISK');
  if (fragile) reasonCodes.push('FRAGILE_SHIPPING_RISK');
  if (highValue) reasonCodes.push('HIGH_VALUE_SHIPPING_PROTECTION_REQUIRED');
  if (shippingConfidenceScore < 0.65) reasonCodes.push('LOW_SHIPPING_CONFIDENCE');
  if (input.sourceShippingUsd == null) reasonCodes.push('INBOUND_SHIPPING_ESTIMATED');

  return {
    inboundShippingUsd,
    outboundShippingUsd,
    packagingCostUsd,
    insuranceReserveUsd,
    signatureReserveUsd,
    returnReserveUsd,
    disputeReserveUsd,
    damageReserveUsd,
    shippingClass,
    outboundCarrierPreference,
    dimensionalWeightLb,
    billableWeightLb,
    oversized,
    fragile,
    highValue,
    shippingRiskScore,
    shippingConfidenceScore,
    reasonCodes,
    evidence: {
      title: input.title,
      categoryKey: input.categoryKey,
      physicalWeightLb,
      dimensionalWeightLb,
      itemCostUsd,
      estimatedSalePriceUsd,
      destinationZone: input.destinationZone ?? null,
    },
  };
}

function calculateDimensionalWeight(lengthIn?: number | null, widthIn?: number | null, heightIn?: number | null): number | null {
  if (!positive(lengthIn) || !positive(widthIn) || !positive(heightIn)) return null;
  return round((Number(lengthIn) * Number(widthIn) * Number(heightIn)) / 139, 2);
}

function estimateWeightFromSignals(category: string, title: string): number {
  if (category.includes('phone')) return 1;
  if (category.includes('tablet')) return 2;
  if (category.includes('laptop')) return 6;
  if (category.includes('camera') || category.includes('lens')) return 4;
  if (category.includes('tool')) return title.includes('kit') ? 14 : 7;
  if (category.includes('monitor')) return 18;
  if (category.includes('appliance')) return 20;
  return 5;
}

function classifyShipping(input: { billableWeightLb: number; oversized: boolean; fragile: boolean; highValue: boolean; category: string; title: string }): ShippingClass {
  if (input.oversized || input.billableWeightLb >= 70) return 'OVERSIZE';
  if (input.title.includes('freight') || input.billableWeightLb >= 100) return 'FREIGHT';
  if (input.fragile) return 'FRAGILE';
  if (input.highValue) return 'HIGH_VALUE';
  if (input.billableWeightLb <= 1) return 'ENVELOPE';
  if (input.billableWeightLb <= 5) return 'SMALL_PARCEL';
  if (input.billableWeightLb <= 20) return 'MEDIUM_BOX';
  return 'LARGE_BOX';
}

function isOversized(input: ShippingModelInput, billableWeightLb: number, category: string, title: string): boolean {
  const maxSide = Math.max(positive(input.lengthIn), positive(input.widthIn), positive(input.heightIn));
  const girth = 2 * (positive(input.widthIn) + positive(input.heightIn)) + positive(input.lengthIn);
  return billableWeightLb > 50 || maxSide > 48 || girth > 108 || hasAny(category, CATEGORY_OVERSIZE_HINTS) || hasAny(title, TITLE_OVERSIZE_HINTS);
}

function estimateInboundShipping(shippingClass: ShippingClass, billableWeightLb: number): number {
  const base: Record<ShippingClass, number> = {
    ENVELOPE: 4.5,
    SMALL_PARCEL: 8.5,
    MEDIUM_BOX: 15,
    LARGE_BOX: 28,
    OVERSIZE: 65,
    FREIGHT: 150,
    FRAGILE: 22,
    HIGH_VALUE: 14,
    UNKNOWN: 20,
  };
  return base[shippingClass] + Math.max(0, billableWeightLb - 5) * 0.65;
}

function estimateOutboundShipping(shippingClass: ShippingClass, billableWeightLb: number, zone?: number | null): number {
  const zoneMultiplier = zone && zone >= 6 ? 1.18 : zone && zone <= 3 ? 0.92 : 1;
  const base: Record<ShippingClass, number> = {
    ENVELOPE: 5,
    SMALL_PARCEL: 9.5,
    MEDIUM_BOX: 17.5,
    LARGE_BOX: 32,
    OVERSIZE: 85,
    FREIGHT: 225,
    FRAGILE: 28,
    HIGH_VALUE: 18,
    UNKNOWN: 24,
  };
  return (base[shippingClass] + Math.max(0, billableWeightLb - 5) * 0.95) * zoneMultiplier;
}

function estimatePackagingCost(shippingClass: ShippingClass, fragile: boolean): number {
  const base: Record<ShippingClass, number> = {
    ENVELOPE: 0.75,
    SMALL_PARCEL: 2.25,
    MEDIUM_BOX: 4.5,
    LARGE_BOX: 8,
    OVERSIZE: 18,
    FREIGHT: 45,
    FRAGILE: 10,
    HIGH_VALUE: 6,
    UNKNOWN: 5,
  };
  return base[shippingClass] + (fragile ? 4 : 0);
}

function damageReserveRate(shippingClass: ShippingClass, fragile: boolean): number {
  if (shippingClass === 'FREIGHT') return 0.06;
  if (shippingClass === 'OVERSIZE') return fragile ? 0.055 : 0.04;
  if (fragile) return 0.035;
  return 0.0125;
}

function chooseCarrier(shippingClass: ShippingClass, billableWeightLb: number, highValue: boolean): CarrierCode {
  if (shippingClass === 'FREIGHT') return 'UNKNOWN';
  if (shippingClass === 'ENVELOPE' || billableWeightLb <= 2) return 'USPS';
  if (highValue || shippingClass === 'FRAGILE' || shippingClass === 'OVERSIZE') return 'UPS';
  return 'UPS';
}

function hasAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function positive(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
