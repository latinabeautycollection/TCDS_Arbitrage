import { z } from 'zod';

const Schema = z.object({
  DATABASE_URL: z.string().min(1),
  PHOTO_STORAGE_ROOT: z.string().default('/var/lib/tcds-arb/photos'),
  PHOTO_PUBLIC_BASE_URL: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_VISION_MODEL: z.string().default('gpt-4.1-mini'),
  ANTHROPIC_API_KEY: z.string().optional(),
  CLAUDE_VISION_MODEL: z.string().default('claude-3-5-sonnet-latest'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_VISION_MODEL: z.string().default('gemini-1.5-flash'),
  REMOVEBG_API_KEY: z.string().optional(),
  PHOTOROOM_API_KEY: z.string().optional(),
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  PHOTO_ENABLE_EXTERNAL_BACKGROUND_REMOVAL: z.coerce.boolean().default(false),
  PHOTO_ENABLE_AI_RELIGHT: z.coerce.boolean().default(false),
  PHOTO_REVIEW_STRICT_MODE: z.coerce.boolean().default(true),
  PHOTO_WORKER_BATCH_SIZE: z.coerce.number().int().positive().default(5),
  PHOTO_WORKER_LOCK_SECONDS: z.coerce.number().int().positive().default(300),
  PHOTO_PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  PHOTO_STORAGE_BACKEND: z.enum(['local','r2']).default('r2'),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_PUBLIC_MEDIA_BASE_URL: z.string().url().optional()
});
export type PhotographyEnv = z.infer<typeof Schema>;
export function loadPhotographyEnv(env: NodeJS.ProcessEnv = process.env): PhotographyEnv {
  return Schema.parse(env);
}
