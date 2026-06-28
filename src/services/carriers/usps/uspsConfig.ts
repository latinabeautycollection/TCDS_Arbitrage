import { z } from 'zod';

const UspsConfigSchema = z.object({
  USPS_CLIENT_ID: z.string().min(1),
  USPS_CLIENT_SECRET: z.string().min(1),
  USPS_BASE_URL: z.string().url().default('https://api.usps.com'),
  USPS_OAUTH_URL: z.string().url().default('https://api.usps.com/oauth2/v3/token'),
  USPS_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  USPS_ENV: z.enum(['sandbox', 'production']).default('production')
});

export type UspsConfig = z.infer<typeof UspsConfigSchema>;

export function loadUspsConfig(): UspsConfig {
  const parsed = UspsConfigSchema.safeParse(process.env);

  if (!parsed.success) {
    throw new Error(
      `Invalid USPS configuration: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`
    );
  }

  return parsed.data;
}
