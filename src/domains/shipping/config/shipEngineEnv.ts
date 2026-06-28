import { z } from "zod";

const boolFromEnv = z.string().optional().transform((v) => v === "true");

export const shipEngineEnvSchema = z.object({
  SHIPENGINE_ENABLED: boolFromEnv.default("false" as any),
  SHIPENGINE_ENVIRONMENT: z.enum(["sandbox", "test", "production"]).default("production"),
  SHIPENGINE_API_KEY: z.string().optional(),
  SHIPENGINE_BASE_URL: z.string().url().default("https://api.shipengine.com"),
  SHIPENGINE_API_VERSION: z.string().default("v1"),

  SHIPENGINE_DEFAULT_LABEL_FORMAT: z.enum(["pdf", "png", "zpl"]).default("pdf"),
  SHIPENGINE_DEFAULT_LABEL_LAYOUT: z.enum(["4x6", "letter", "A4", "A6"]).default("4x6"),
  SHIPENGINE_DEFAULT_LABEL_DOWNLOAD_TYPE: z.enum(["url", "inline"]).default("url"),
  SHIPENGINE_DEFAULT_VALIDATE_ADDRESS: z.enum(["no_validation", "validate_only", "validate_and_clean"]).default("validate_and_clean"),
  SHIPENGINE_DEFAULT_DISPLAY_SCHEME: z.enum(["label", "paperless", "label_and_paperless"]).default("label"),
  SHIPENGINE_DEFAULT_RATE_SHOPPER_ID: z.enum(["best_value", "cheapest", "fastest"]).default("cheapest"),

  SHIPENGINE_WEBHOOK_URL: z.string().url().optional(),
  SHIPENGINE_WEBHOOK_SECRET: z.string().optional(),
  SHIPENGINE_WEBHOOK_REQUIRE_SECRET: boolFromEnv.default("true" as any),

  SHIPENGINE_HUMAN_REVIEW_RISK_SCORE: z.coerce.number().default(70),
  SHIPENGINE_EXECUTIVE_HOLD_RISK_SCORE: z.coerce.number().default(90),
  SHIPENGINE_MIN_ADDRESS_CONFIDENCE_SCORE: z.coerce.number().default(0.85),
  SHIPENGINE_MIN_SHIPMENT_RECOGNITION_SCORE: z.coerce.number().default(0.85),
  SHIPENGINE_SMOKE_USE_LIVE_API: boolFromEnv.default("false" as any),
});

export type ShipEngineEnv = z.infer<typeof shipEngineEnvSchema>;

export function getShipEngineEnv(raw: NodeJS.ProcessEnv = process.env): ShipEngineEnv {
  const parsed = shipEngineEnvSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`Invalid ShipEngine env: ${parsed.error.message}`);
  return parsed.data;
}
