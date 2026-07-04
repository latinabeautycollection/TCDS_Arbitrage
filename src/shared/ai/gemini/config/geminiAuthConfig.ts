import { z } from 'zod';

export type GeminiAuthMode = 'AUTO' | 'SERVICE_ACCOUNT' | 'API_KEY' | 'VERTEX' | 'GOOGLE_MANAGED';

const schema = z.object({
  GEMINI_AUTH_MODE: z.enum(['AUTO', 'SERVICE_ACCOUNT', 'API_KEY', 'VERTEX', 'GOOGLE_MANAGED']).default('AUTO'),
  GEMINI_API_KEY: z.string().optional(),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
  GOOGLE_CLOUD_PROJECT: z.string().optional(),
  GOOGLE_CLOUD_LOCATION: z.string().default('us-central1'),
  GEMINI_MODEL_TEXT: z.string().default('gemini-1.5-pro'),
  GEMINI_MODEL_VISION: z.string().default('gemini-1.5-pro'),
  GEMINI_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  GEMINI_MAX_RETRIES: z.coerce.number().int().min(0).max(8).default(3),
  GEMINI_AUDIT_ENABLED: z.coerce.boolean().default(true),
  GEMINI_REQUIRE_HEALTHY_CREDENTIALS: z.coerce.boolean().default(true),
});

export type GeminiAuthConfig = z.infer<typeof schema>;

export function loadGeminiAuthConfig(env: NodeJS.ProcessEnv = process.env): GeminiAuthConfig {
  return schema.parse(env);
}
