import { z } from 'zod';
const schema=z.object({
 NODE_ENV:z.string().default('development'), R2_ACCOUNT_ID:z.string().min(1), R2_ACCESS_KEY_ID:z.string().min(1), R2_SECRET_ACCESS_KEY:z.string().min(1), R2_FORENSIC_BUCKET:z.string().min(1),
 FORENSIC_UPLOAD_URL_TTL_SECONDS:z.coerce.number().int().min(60).max(3600).default(900), FORENSIC_DOWNLOAD_URL_TTL_SECONDS:z.coerce.number().int().min(30).max(900).default(300), FORENSIC_MAX_FILE_BYTES:z.coerce.number().int().positive().default(5_368_709_120),
 FORENSIC_VERIFICATION_CLAIM_SECONDS:z.coerce.number().int().min(60).max(3600).default(1800), FORENSIC_QUARANTINE_PREFIX:z.string().default('forensic-quarantine'), MALWARE_SCANNER_MODE:z.enum(['clamav','noop']).default('noop'), CLAMAV_HOST:z.string().default('127.0.0.1'), CLAMAV_PORT:z.coerce.number().int().default(3310)
});
export type ForensicStorageEnv=z.infer<typeof schema>;
export function loadForensicStorageEnv(env:NodeJS.ProcessEnv=process.env):ForensicStorageEnv { const v=schema.parse(env); if(v.NODE_ENV==='production'&&v.MALWARE_SCANNER_MODE==='noop') throw new Error('Production requires a real malware scanner'); return v; }
