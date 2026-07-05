import { z } from 'zod';

export const R2_OPTIMIZATION_VERSION = 'domain5-r2-v4.0.0';

export const r2OptimizationEnvSchema = z.object({
  R2_PUBLIC_MEDIA_BASE_URL: z.string().url().optional(),
  R2_PRIVATE_GATEWAY_BASE_URL: z.string().url().optional(),
  R2_STORAGE_STANDARD_GB_MONTH_USD: z.coerce.number().default(0.015),
  R2_STORAGE_IA_GB_MONTH_USD: z.coerce.number().default(0.01),
  R2_CLASS_A_MILLION_OPS_USD: z.coerce.number().default(4.50),
  R2_CLASS_B_MILLION_OPS_USD: z.coerce.number().default(0.36),
  R2_TEMP_RETENTION_DAYS: z.coerce.number().int().default(7),
  R2_REVIEW_RETENTION_DAYS: z.coerce.number().int().default(180),
  R2_DEADLETTER_RETENTION_DAYS: z.coerce.number().int().default(60),
  R2_PROCESSED_ACTIVE_DAYS: z.coerce.number().int().default(180),
  R2_ORIGINAL_ACTIVE_DAYS: z.coerce.number().int().default(180),
  R2_EVIDENCE_HOLD_DAYS: z.coerce.number().int().default(730),
  R2_HIGH_VALUE_EVIDENCE_HOLD_DAYS: z.coerce.number().int().default(1095),
  R2_HIGH_VALUE_USD: z.coerce.number().default(250),
  R2_RETENTION_BATCH_SIZE: z.coerce.number().int().default(500),
  R2_COST_ROLLUP_BATCH_SIZE: z.coerce.number().int().default(5000),
});

export type R2OptimizationConfig = z.infer<typeof r2OptimizationEnvSchema>;

export function getR2OptimizationConfig(env: NodeJS.ProcessEnv = process.env): R2OptimizationConfig {
  return r2OptimizationEnvSchema.parse(env);
}

export const unsupportedR2Features = [
  'object_tagging',
  'object_lock',
  's3_acl',
  'bucket_policy',
  'bucket_versioning',
  'bucket_replication',
  'intelligent_tiering',
  'bucket_notification_configuration',
] as const;
