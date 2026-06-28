import { z } from "zod";
const boolFromEnv = z.string().optional().transform((v) => v === "true");
export const upsEnvSchema = z.object({
  UPS_ENABLED: boolFromEnv.default("false" as any), UPS_ENVIRONMENT: z.enum(["cie","production"]).default("production"),
  UPS_BASE_URL: z.string().url().default("https://onlinetools.ups.com/api"), UPS_CIE_BASE_URL: z.string().url().default("https://wwwcie.ups.com/api"),
  UPS_SECURITY_BASE_URL: z.string().url().default("https://onlinetools.ups.com/security"), UPS_CIE_SECURITY_BASE_URL: z.string().url().default("https://wwwcie.ups.com/security"),
  UPS_CLIENT_ID: z.string().optional(), UPS_CLIENT_SECRET: z.string().optional(), UPS_ACCESS_TOKEN: z.string().optional(), UPS_REFRESH_TOKEN: z.string().optional(),
  UPS_TRANSACTION_SRC: z.string().default("TCDS_ARBITRAGE"), UPS_TRANS_ID_PREFIX: z.string().default("TCDSUPS"), UPS_TIMEOUT_MS: z.coerce.number().int().positive().default(20000), UPS_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2), UPS_TOKEN_REFRESH_SKEW_SECONDS: z.coerce.number().int().positive().default(300), UPS_LOCALE: z.string().default("en_US"),
  UPS_ADDRESS_VALIDATION_VERSION: z.string().default("v2"), UPS_ADDRESS_VALIDATION_REQUEST_OPTION: z.coerce.number().int().min(1).default(3), UPS_SHIP_VERSION: z.string().default("v2409"), UPS_VOID_VERSION: z.string().default("v2409"), UPS_LABEL_RECOVERY_VERSION: z.string().default("v1"), UPS_TIME_IN_TRANSIT_VERSION: z.string().default("v1"), UPS_TRACK_SUBSCRIPTION_VERSION: z.string().default("v1"),
  UPS_DEFAULT_SERVICE_CODE: z.string().default("03"), UPS_DEFAULT_SERVICE_NAME: z.string().default("UPS Ground"), UPS_DEFAULT_WEIGHT_UNIT: z.string().default("LBS"), UPS_DEFAULT_RESIDENTIAL_INDICATOR: z.string().default("01"),
  UPS_INSURANCE_REQUIRED_MIN_VALUE_USD: z.coerce.number().default(100), UPS_SIGNATURE_REQUIRED_MIN_VALUE_USD: z.coerce.number().default(500), UPS_ADULT_SIGNATURE_REQUIRED_MIN_VALUE_USD: z.coerce.number().default(1000), UPS_HUMAN_REVIEW_RISK_SCORE: z.coerce.number().default(70), UPS_EXECUTIVE_HOLD_RISK_SCORE: z.coerce.number().default(90),
  UPS_TRACKING_WEBHOOK_CREDENTIAL: z.string().optional(), UPS_TRACKING_WEBHOOK_REQUIRE_CREDENTIAL: boolFromEnv.default("true" as any), UPS_SMOKE_USE_LIVE_API: boolFromEnv.default("false" as any),
});
export type UpsEnv = z.infer<typeof upsEnvSchema>;
export function getUpsEnv(raw: NodeJS.ProcessEnv = process.env): UpsEnv { const parsed = upsEnvSchema.safeParse(raw); if (!parsed.success) throw new Error(`Invalid UPS env: ${parsed.error.message}`); return parsed.data; }
