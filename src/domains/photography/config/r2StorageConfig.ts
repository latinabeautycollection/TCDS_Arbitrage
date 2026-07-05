import { z } from 'zod';

const R2Schema = z.object({
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_ENDPOINT: z.string().url().optional(),
  R2_REGION: z.string().default('auto'),
  R2_PUBLIC_MEDIA_BASE_URL: z.string().url().optional(),
  R2_LOCATION_HINT: z.string().optional(),
  R2_BUCKET_ORIGINALS: z.string().default('tcds-photo-originals-prod'),
  R2_BUCKET_PROCESSED: z.string().default('tcds-photo-processed-prod'),
  R2_BUCKET_THUMBNAILS: z.string().default('tcds-photo-thumbnails-prod'),
  R2_BUCKET_EVIDENCE: z.string().default('tcds-photo-evidence-prod'),
  R2_BUCKET_REVIEW: z.string().default('tcds-photo-review-prod'),
  R2_BUCKET_TEMP: z.string().default('tcds-photo-temp-prod'),
  R2_BUCKET_DEADLETTER: z.string().default('tcds-photo-deadletter-prod'),
  R2_BUCKET_ANALYTICS: z.string().default('tcds-photo-analytics-prod'),
  R2_PRESIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  R2_MULTIPART_THRESHOLD_BYTES: z.coerce.number().int().positive().default(50 * 1024 * 1024),
  R2_ENABLE_SSE_C: z.coerce.boolean().default(false),
  R2_SSE_C_KEY_HEX: z.string().optional(),
});

export type R2StorageConfig = z.infer<typeof R2Schema>;

export const R2_BUCKET_PURPOSES = [
  'originals',
  'processed',
  'thumbnails',
  'evidence',
  'review',
  'temp',
  'deadletter',
  'analytics',
] as const;

export type R2BucketPurpose = typeof R2_BUCKET_PURPOSES[number];

export function loadR2StorageConfig(env: NodeJS.ProcessEnv = process.env): R2StorageConfig {
  const cfg = R2Schema.parse(env);
  return {
    ...cfg,
    R2_ENDPOINT: cfg.R2_ENDPOINT ?? `https://${cfg.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  };
}

export function bucketForPurpose(cfg: R2StorageConfig, purpose: R2BucketPurpose): string {
  const map: Record<R2BucketPurpose, string> = {
    originals: cfg.R2_BUCKET_ORIGINALS,
    processed: cfg.R2_BUCKET_PROCESSED,
    thumbnails: cfg.R2_BUCKET_THUMBNAILS,
    evidence: cfg.R2_BUCKET_EVIDENCE,
    review: cfg.R2_BUCKET_REVIEW,
    temp: cfg.R2_BUCKET_TEMP,
    deadletter: cfg.R2_BUCKET_DEADLETTER,
    analytics: cfg.R2_BUCKET_ANALYTICS,
  };
  return map[purpose];
}
