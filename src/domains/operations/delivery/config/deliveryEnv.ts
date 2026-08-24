import { z } from "zod";

const bool = (def: "true" | "false") => z.enum(["true", "false"]).default(def).transform((v: string) => v === "true");

const schema = z.object({
  // Executor/process switches only. 10A channel_controls remains authoritative.
  DOMAIN10_DELIVERY_ENABLED: bool("false"),
  DOMAIN10_DELIVERY_EMAIL_ENABLED: bool("false"),
  DOMAIN10_DELIVERY_SMS_ENABLED: bool("false"),

  DOMAIN10_DELIVERY_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(20),
  DOMAIN10_DELIVERY_LEASE_SECONDS: z.coerce.number().int().min(30).max(600).default(120),
  DOMAIN10_DELIVERY_RETRY_BASE_MS: z.coerce.number().int().min(500).max(60_000).default(5000),
  DOMAIN10_DELIVERY_RETRY_MAX_MS: z.coerce.number().int().min(1000).max(3_600_000).default(300000),

  DOMAIN10_RECONCILIATION_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(25),
  DOMAIN10_RECONCILIATION_LEASE_SECONDS: z.coerce.number().int().min(30).max(900).default(180),

  DOMAIN10_PROVIDER_ERROR_MAX_CHARS: z.coerce.number().int().min(100).max(4000).default(1000)
});

export type DeliveryEnv = z.infer<typeof schema>;
let cached: DeliveryEnv | undefined;

export function deliveryEnv(): DeliveryEnv {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Domain 10C delivery environment invalid: ${parsed.error.message}`);
  }
  cached = parsed.data;
  return cached;
}
