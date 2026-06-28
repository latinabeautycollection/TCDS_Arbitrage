import { z } from "zod";

const boolFromEnv = z.string().optional().transform((v) => v === "true");

export const fedexEnvSchema = z.object({
  FEDEX_ENABLED: boolFromEnv.default("false" as any),
  FEDEX_ENVIRONMENT: z.enum(["sandbox", "production"]).default("production"),
  FEDEX_BASE_URL: z.string().url().default("https://apis.fedex.com"),
  FEDEX_OAUTH_PATH: z.string().default("/oauth/token"),
  FEDEX_CLIENT_ID: z.string().optional(),
  FEDEX_CLIENT_SECRET: z.string().optional(),
  FEDEX_ACCOUNT_NUMBER: z.string().optional(),
  FEDEX_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),
  FEDEX_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  FEDEX_TOKEN_REFRESH_SKEW_SECONDS: z.coerce.number().int().positive().default(300),
  FEDEX_DEFAULT_SERVICE_TYPES: z.string().default("FEDEX_GROUND,FEDEX_HOME_DELIVERY,FEDEX_2_DAY,STANDARD_OVERNIGHT"),
  FEDEX_DEFAULT_PACKAGING_TYPE: z.string().default("YOUR_PACKAGING"),
  FEDEX_DEFAULT_PICKUP_TYPE: z.string().default("USE_SCHEDULED_PICKUP"),
  FEDEX_DEFAULT_RATE_REQUEST_TYPE: z.string().default("LIST"),
  FEDEX_DEFAULT_CURRENCY: z.string().default("USD"),
  FEDEX_INSURANCE_REQUIRED_MIN_VALUE_USD: z.coerce.number().default(100),
  FEDEX_SIGNATURE_REQUIRED_MIN_VALUE_USD: z.coerce.number().default(500),
  FEDEX_HUMAN_REVIEW_RISK_SCORE: z.coerce.number().default(70),
  FEDEX_EXECUTIVE_HOLD_RISK_SCORE: z.coerce.number().default(90),
  FEDEX_WEBHOOK_SECRET: z.string().optional(),
  FEDEX_WEBHOOK_REQUIRE_SIGNATURE: boolFromEnv.default("false" as any),
  FEDEX_SMOKE_USE_LIVE_API: boolFromEnv.default("false" as any),
});

export type FedExEnv = z.infer<typeof fedexEnvSchema>;

export function getFedExEnv(raw: NodeJS.ProcessEnv = process.env): FedExEnv {
  const parsed = fedexEnvSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`Invalid FedEx environment: ${parsed.error.message}`);
  return parsed.data;
}
