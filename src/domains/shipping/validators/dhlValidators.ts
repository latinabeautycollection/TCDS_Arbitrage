import { z } from "zod";

export const dhlTrackInputSchema = z.object({
  trackingNumber: z.string().trim().min(1),
  service: z.string().optional(),
  requesterCountryCode: z.string().length(2).optional(),
  originCountryCode: z.string().length(2).optional(),
  recipientPostalCode: z.string().optional(),
  language: z.string().length(2).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const dhlWebhookSubscriptionSchema = z.object({
  pickup: z.string().optional(),
  trackingId: z.string().optional(),
  hookType: z.literal("TRACK_EVENTS").default("TRACK_EVENTS"),
  url: z.string().url(),
  username: z.string().optional(),
  password: z.string().optional(),
  active: z.boolean().default(true),
}).refine((v) => Boolean(v.pickup || v.trackingId), {
  message: "DHL webhook subscription requires pickup or trackingId.",
});

export const dhlReturnLabelSchema = z.object({
  pickup: z.string().min(1),
  orderedProductId: z.string().min(1),
  merchantId: z.string().optional(),
  labelFormat: z.enum(["PNG", "ZPL", "PDF", "QR"]).optional(),
  shipperAddress: z.object({}).passthrough(),
  returnAddress: z.object({}).passthrough(),
  packageDetail: z.object({}).passthrough(),
});

export const dhlLocationAddressSchema = z.object({
  countryCode: z.string().length(2),
  postalCode: z.string().optional(),
  addressLocality: z.string().optional(),
  streetAddress: z.string().optional(),
  serviceType: z.string().optional(),
  providerType: z.string().optional(),
  locationType: z.string().optional(),
  radius: z.coerce.number().optional(),
  limit: z.coerce.number().optional(),
});
