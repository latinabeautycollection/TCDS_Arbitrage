import { z } from "zod";

const postalCode = z.string().trim().min(3).max(12);
const positive = z.coerce.number().positive();

export const fedexAddressValidateSchema = z.object({
  addressesToValidate: z.array(z.object({
    address: z.object({
      streetLines: z.array(z.string()).min(1),
      city: z.string().optional(),
      stateOrProvinceCode: z.string().optional(),
      postalCode,
      countryCode: z.string().length(2).default("US"),
    }).passthrough(),
  }).passthrough()).min(1),
}).passthrough();

export const fedexRateShopSchema = z.object({
  originPostalCode: postalCode,
  originCountryCode: z.string().length(2).default("US").optional(),
  destinationPostalCode: postalCode,
  destinationCountryCode: z.string().length(2).default("US").optional(),
  weightLb: positive,
  lengthIn: positive,
  widthIn: positive,
  heightIn: positive,
  itemValueUsd: z.coerce.number().min(0).optional(),
  serviceTypes: z.array(z.string()).optional(),
  residential: z.boolean().optional(),
  fragile: z.boolean().optional(),
});

export const fedexTrackingSchema = z.object({
  trackingInfo: z.array(z.object({
    trackingNumberInfo: z.object({
      trackingNumber: z.string().min(4),
    }).passthrough(),
  }).passthrough()).min(1).max(30),
}).passthrough();

export const fedexWebhookBodySchema = z.record(z.string(), z.any());
