import { z } from "zod";

export const shipEngineAddressSchema = z.object({
  name: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().nullable(),
  company_name: z.string().optional().nullable(),
  address_line1: z.string().min(1),
  address_line2: z.string().optional().nullable(),
  address_line3: z.string().optional().nullable(),
  city_locality: z.string().min(1),
  state_province: z.string().min(1),
  postal_code: z.string().optional(),
  country_code: z.string().length(2),
  address_residential_indicator: z.enum(["unknown", "yes", "no"]).optional(),
}).passthrough();

export const shipEngineValidateAddressesSchema = z.array(shipEngineAddressSchema).min(1);

export const shipEngineRecognizeTextSchema = z.object({
  text: z.string().min(1),
  address: z.object({}).passthrough().optional(),
  shipment: z.object({}).passthrough().optional(),
});

export const shipEngineTrackSchema = z.object({
  carrier_code: z.string().optional(),
  carrier_id: z.string().optional(),
  tracking_number: z.string().min(1),
}).refine((v) => Boolean(v.carrier_code || v.carrier_id), {
  message: "carrier_code or carrier_id is required.",
});

export const shipEngineWebhookSchema = z.object({
  event: z.enum(["batch", "carrier_connected", "order_source_refresh_complete", "rate", "report_complete", "sales_orders_imported", "track"]),
  url: z.string().url(),
  headers: z.array(z.object({}).passthrough()).optional(),
  name: z.string().optional(),
  store_id: z.coerce.number().int().optional(),
});

export const shipEngineRateShopperSchema = z.object({
  shipment: z.object({}).passthrough(),
  label_format: z.enum(["pdf", "png", "zpl"]).optional(),
  label_layout: z.enum(["4x6", "letter", "A4", "A6"]).optional(),
  label_download_type: z.enum(["url", "inline"]).optional(),
  display_scheme: z.enum(["label", "paperless", "label_and_paperless"]).optional(),
});
