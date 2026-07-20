import { z } from "zod";
import type { EvaluationStage, ShippingIntelligenceContext } from "../models/intelligenceContext";

const finiteNonNegativeInt = z.number().int().finite().nonnegative();
const positiveFinite = z.number().finite().positive();

const addressSchema = z.object({
  name: z.string().trim().max(200).optional(),
  company: z.string().trim().max(200).optional(),
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1).max(120),
  stateOrProvince: z.string().trim().min(1).max(80),
  postalCode: z.string().trim().min(2).max(20),
  countryCode: z.string().trim().length(2),
  residential: z.boolean().optional(),
  verifiedMarketplaceAddress: z.boolean().optional()
});

const packageSchema = z.object({
  packageId: z.string().trim().min(1).max(100),
  actualWeightOz: positiveFinite,
  lengthIn: positiveFinite.max(200),
  widthIn: positiveFinite.max(200),
  heightIn: positiveFinite.max(200),
  packagingCode: z.string().trim().max(100).optional(),
  fragile: z.boolean().optional(),
  hazardous: z.boolean().optional(),
  serialNumbers: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
  dimensionsVerified: z.boolean(),
  weightVerified: z.boolean(),
  measuredAt: z.date().optional(),
  scaleDeviceId: z.string().trim().max(200).optional()
});

const contextSchema = z.object({
  correlationId: z.string().trim().min(8).max(200),
  idempotencyKey: z.string().trim().min(8).max(300),
  processRunId: z.string().uuid().optional(),
  listingId: z.string().uuid().optional(),
  candidateId: finiteNonNegativeInt.optional(),
  sourceListingNormalizedId: finiteNonNegativeInt.optional(),
  ebayListingFk: finiteNonNegativeInt.optional(),
  ebayOrderFk: finiteNonNegativeInt.optional(),
  shipmentId: finiteNonNegativeInt.optional(),
  sku: z.string().trim().max(200).optional(),
  categoryKey: z.string().trim().max(200).optional(),
  itemTitle: z.string().trim().max(1000).optional(),

  salePriceCents: finiteNonNegativeInt,
  itemSubtotalCents: finiteNonNegativeInt,
  shippingPaidCents: finiteNonNegativeInt,
  taxCents: finiteNonNegativeInt,
  totalPaidCents: finiteNonNegativeInt,
  acquisitionCostCents: finiteNonNegativeInt,
  marketplaceFeesCents: finiteNonNegativeInt,
  inboundShippingCents: finiteNonNegativeInt,
  packagingCostCents: finiteNonNegativeInt,
  returnReserveCents: finiteNonNegativeInt,
  disputeReserveCents: finiteNonNegativeInt,

  originPostalCode: z.string().trim().min(3).max(20),
  destination: addressSchema.optional(),
  packages: z.array(packageSchema).min(1).max(50),
  shipDate: z.date(),
  orderPlacedAt: z.date().optional(),
  handlingCutoffTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  requestedDeliveryBy: z.date().optional(),
  highFraudCategory: z.boolean().optional(),
  marketplace: z.string().trim().min(1).max(50),
  mode: z.enum([
    "DISABLED","OBSERVE_ONLY","SHADOW","RECOMMEND",
    "ENFORCE_NON_BLOCKING","ENFORCE_BLOCKING"
  ]),
  metadata: z.record(z.string(), z.unknown()).optional()
}).superRefine((ctx, issue) => {
  const expected = ctx.itemSubtotalCents + ctx.shippingPaidCents + ctx.taxCents;
  if (Math.abs(expected - ctx.totalPaidCents) > 1) {
    issue.addIssue({
      code: "custom",
      path: ["totalPaidCents"],
      message: "totalPaidCents must equal item subtotal + shipping + tax"
    });
  }
});

export function validateIntelligenceContext(
  input: ShippingIntelligenceContext,
  stage: EvaluationStage
): ShippingIntelligenceContext {
  const parsed = contextSchema.parse(input);
  if (stage !== "PRESALE" && !parsed.destination) {
    throw new Error(`Destination is required for ${stage}`);
  }
  if (stage === "LABEL_AUTHORIZATION") {
    if (!parsed.ebayOrderFk || !parsed.shipmentId) {
      throw new Error("ebayOrderFk and shipmentId are required for LABEL_AUTHORIZATION");
    }
    if (!parsed.packages.every((pkg) => pkg.weightVerified && pkg.dimensionsVerified)) {
      throw new Error("Verified weight and dimensions are required for LABEL_AUTHORIZATION");
    }
  }
  return parsed;
}
