import { z } from "zod";

const boolFromEnv = z.string().optional().transform((v) => v === "true");

export const dhlEnvSchema = z.object({
  DHL_ENABLED: boolFromEnv.default("false" as any),
  DHL_ENVIRONMENT: z.enum(["sandbox", "test", "production"]).default("production"),
  DHL_API_KEY: z.string().optional(),
  DHL_TRACKING_API_KEY: z.string().optional(),
  DHL_LOCATION_API_KEY: z.string().optional(),
  DHL_ECOMMERCE_API_KEY: z.string().optional(),

  DHL_TRACKING_BASE_URL: z.string().url().default("https://api-eu.dhl.com/track"),
  DHL_TRACKING_TEST_BASE_URL: z.string().url().default("https://api-test.dhl.com/track"),
  DHL_TRACKING_DEFAULT_LANGUAGE: z.string().default("en"),
  DHL_TRACKING_DEFAULT_LIMIT: z.coerce.number().int().positive().default(5),

  DHL_ECOMMERCE_BASE_URL: z.string().url().default("https://api.dhlecs.com"),
  DHL_ECOMMERCE_SANDBOX_BASE_URL: z.string().url().default("https://api-sandbox.dhlecs.com"),
  DHL_ECOMMERCE_PICKUP_ACCOUNT: z.string().optional(),
  DHL_ECOMMERCE_WEBHOOK_URL: z.string().optional(),
  DHL_ECOMMERCE_WEBHOOK_USERNAME: z.string().optional(),
  DHL_ECOMMERCE_WEBHOOK_PASSWORD: z.string().optional(),
  DHL_ECOMMERCE_WEBHOOK_HOOK_TYPE: z.string().default("TRACK_EVENTS"),

  DHL_LOCATION_BASE_URL: z.string().url().default("https://api.dhl.com/location-finder/v1"),
  DHL_LOCATION_DEFAULT_LIMIT: z.coerce.number().int().positive().default(20),
  DHL_LOCATION_DEFAULT_RADIUS: z.coerce.number().int().positive().default(5000),

  DHL_FREIGHT_ENABLED: boolFromEnv.default("false" as any),
  DHL_FREIGHT_API_KEY: z.string().optional(),
  DHL_FREIGHT_API_SECRET: z.string().optional(),
  DHL_FREIGHT_EID_USERNAME: z.string().optional(),
  DHL_FREIGHT_EID_PASSWORD: z.string().optional(),
  DHL_FREIGHT_PRICEQUOTE_BASE_URL: z.string().url().default("https://api.dhl.com/freight/info/pricequote/v1"),
  DHL_FREIGHT_PRICEQUOTE_SANDBOX_BASE_URL: z.string().url().default("https://api-sandbox.dhl.com/freight/info/pricequote/v1"),
  DHL_FREIGHT_BOOKING_BASE_URL: z.string().url().default("https://api.dhl.com/freight/shipping/orders/v1"),
  DHL_FREIGHT_BOOKING_SANDBOX_BASE_URL: z.string().url().default("https://api-sandbox.dhl.com/freight/shipping/orders/v1"),

  DHL_HUMAN_REVIEW_RISK_SCORE: z.coerce.number().default(70),
  DHL_EXECUTIVE_HOLD_RISK_SCORE: z.coerce.number().default(90),
  DHL_WEBHOOK_REQUIRE_BASIC_AUTH: boolFromEnv.default("true" as any),
  DHL_SMOKE_USE_LIVE_API: boolFromEnv.default("false" as any),
});

export type DhlEnv = z.infer<typeof dhlEnvSchema>;

export function getDhlEnv(raw: NodeJS.ProcessEnv = process.env): DhlEnv {
  const parsed = dhlEnvSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`Invalid DHL env: ${parsed.error.message}`);
  return parsed.data;
}
