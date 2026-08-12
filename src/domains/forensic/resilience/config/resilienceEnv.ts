import { z } from 'zod';

const schema = z.object({
  FORENSIC_BACKUP_SOURCE_DATABASE_URL: z.string().min(1),
  FORENSIC_RECOVERY_ALLOWED_HOSTS: z.string().min(1),
  FORENSIC_RECOVERY_DATABASE_PREFIX: z.string().regex(/^[a-z][a-z0-9_]*$/),
  FORENSIC_BACKUP_STAGING_DIR: z.string().min(1),
  FORENSIC_BACKUP_MAX_BYTES: z.coerce.number().int().positive().default(21474836480),
  FORENSIC_BACKUP_TIMEOUT_MS: z.coerce.number().int().positive().default(3600000),
  PG_DUMP_PATH: z.string().default('pg_dump'),
  PG_RESTORE_PATH: z.string().default('pg_restore'),
  R2_ENDPOINT: z.url(),
  R2_REGION: z.string().default('auto'),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_FORENSIC_BACKUP_BUCKET: z.string().min(3),
  R2_FORENSIC_SECONDARY_BUCKET: z.string().min(3),
}).strict();

export type ResilienceEnv = z.infer<typeof schema>;
export function parseResilienceEnv(env: NodeJS.ProcessEnv): ResilienceEnv {
  return schema.parse(env);
}
