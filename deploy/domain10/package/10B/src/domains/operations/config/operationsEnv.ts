import { z } from "zod";

const boolString = z.enum(["true", "false"]).transform(v => v === "true");

const schema = z.object({
  DOMAIN10_PLANNER_ENABLED: boolString.default("false"),
  DOMAIN10_ENVIRONMENT: z.enum(["development", "test", "staging", "production"]).default("production"),
    DOMAIN10_EVENT_MAX_PAYLOAD_BYTES: z.coerce.number().int().min(1024).max(1_048_576).default(262144),
  DOMAIN10_EVENT_MAX_CLOCK_SKEW_SECONDS: z.coerce.number().int().min(0).max(3600).default(300),

  DOMAIN10_PLANNER_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(20),
  DOMAIN10_PLANNER_LEASE_SECONDS: z.coerce.number().int().min(30).max(600).default(120),
  DOMAIN10_PLANNER_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  DOMAIN10_PLANNER_RETRY_BASE_MS: z.coerce.number().int().min(100).max(60_000).default(5000),
  DOMAIN10_PLANNER_RETRY_MAX_MS: z.coerce.number().int().min(1000).max(3_600_000).default(300000),
  DOMAIN10_PLANNER_POLL_MS: z.coerce.number().int().min(100).max(60_000).default(1000),

  LOG_LEVEL: z.string().default("info")
});

export type OperationsEnv = z.infer<typeof schema>;
let cached: OperationsEnv | undefined;

export function operationsEnv(): OperationsEnv {
  if (cached) return cached;
  const result = schema.safeParse(process.env);
  if (!result.success) {
    throw new Error(`Domain 10B environment invalid: ${result.error.message}`);
  }
  cached = result.data;
  return cached;
}
