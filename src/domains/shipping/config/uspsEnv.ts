import { z } from "zod";
const boolFromEnv = z.string().optional().transform((v) => v === "true");
export const uspsEnvSchema = z.object({
  USPS_ENABLED: boolFromEnv.default("false" as any),
  USPS_ENVIRONMENT: z.enum(["sandbox", "production"]).default("production"),
  USPS_BASE_URL: z.string().url().default("https://api.usps.com"),
  USPS_OAUTH_URL: z.string().url().default("https://api.usps.com/oauth2/v3/token"),
  USPS_OAUTH_REVOKE_URL: z.string().url().default("https://api.usps.com/oauth2/v3/revoke"),
  USPS_CLIENT_ID: z.string().optional(),
  USPS_CLIENT_SECRET: z.string().optional(),
  USPS_OAUTH_SCOPE: z.string().optional(),
  USPS_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  USPS_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  USPS_TOKEN_REFRESH_SKEW_SECONDS: z.coerce.number().int().positive().default(300),
  USPS_DEFAULT_PRICE_TYPE: z.enum(["RETAIL","COMMERCIAL","CONTRACT","NSA"]).default("COMMERCIAL"),
  USPS_DEFAULT_MAIL_CLASSES: z.string().default("USPS_GROUND_ADVANTAGE,PRIORITY_MAIL"),
  USPS_INSURANCE_REQUIRED_MIN_VALUE_USD: z.coerce.number().default(100),
  USPS_SIGNATURE_REQUIRED_MIN_VALUE_USD: z.coerce.number().default(500),
  USPS_RESTRICTED_DELIVERY_REQUIRED_MIN_VALUE_USD: z.coerce.number().default(1000),
  USPS_HUMAN_REVIEW_RISK_SCORE: z.coerce.number().default(70),
  USPS_EXECUTIVE_HOLD_RISK_SCORE: z.coerce.number().default(90),
  USPS_AI_ENABLED: boolFromEnv.default("false" as any),
  USPS_AI_MODEL: z.string().default("gpt-5.5-thinking"),
  USPS_AI_MAX_DAILY_COST_USD: z.coerce.number().default(5),
  USPS_SMOKE_USE_LIVE_API: boolFromEnv.default("false" as any),
});
export type UspsEnv = z.infer<typeof uspsEnvSchema>;
export function getUspsEnv(raw: NodeJS.ProcessEnv = process.env): UspsEnv {
  const parsed = uspsEnvSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`Invalid USPS env: ${parsed.error.message}`);
  return parsed.data;
}
