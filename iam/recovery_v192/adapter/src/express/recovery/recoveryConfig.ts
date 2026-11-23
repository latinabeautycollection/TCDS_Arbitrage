import crypto from 'node:crypto';
import {z} from 'zod';

// Warehouse password recovery (vendor V1.9.2 contract, TCDS 644 database interface). Off unless RECOVERY_ENABLED=true.
// zod 4: .default() must come before .transform().
const bool=z.enum(['true','false']).default('false').transform(v=>v==='true');
const schema=z.object({
  RECOVERY_ENABLED:bool,
  RECOVERY_WORKERS_ENABLED:bool,
  RECOVERY_MASTER_KEY:z.string().regex(/^[0-9a-f]{64}$/i,'RECOVERY_MASTER_KEY must be 32 bytes hex'),
  RECOVERY_LINK_BASE:z.string().url().refine(u=>u.startsWith('https://')&&!u.includes('?')&&!u.includes('#'),'https, no query'),
  RECOVERY_DELIVERY_MODE:z.enum(['graph','capture']).default('graph'),
  RECOVERY_CAPTURE_FILE:z.string().optional(),
  RECOVERY_DEPS_DIR:z.string().min(1),
  RECOVERY_TICK_MS:z.coerce.number().int().min(1000).max(60000).default(5000),
  M365_TENANT_ID:z.string().optional(),
  M365_CLIENT_ID:z.string().optional(),
  M365_CLIENT_SECRET:z.string().optional(),
  M365_SENDER:z.string().optional(),
  // 645: who is told that a confirmed recovery email waits for approval, and where they approve it (login-stg page).
  RECOVERY_APPROVER_EMAILS:z.string().optional(),
  RECOVERY_APPROVAL_LINK_BASE:z.string().url().refine(u=>u.startsWith('https://')&&!u.includes('?')&&!u.includes('#'),'https, no query').optional()
}).superRefine((c,ctx)=>{
  if(c.RECOVERY_DELIVERY_MODE==='graph'&&!(c.M365_TENANT_ID&&c.M365_CLIENT_ID&&c.M365_CLIENT_SECRET&&c.M365_SENDER))
    ctx.addIssue({code:'custom',message:'graph delivery needs M365_TENANT_ID, M365_CLIENT_ID, M365_CLIENT_SECRET, M365_SENDER'});
  if(c.RECOVERY_DELIVERY_MODE==='capture'&&!c.RECOVERY_CAPTURE_FILE)
    ctx.addIssue({code:'custom',message:'capture delivery needs RECOVERY_CAPTURE_FILE'});
});
export type RecoveryConfig=z.infer<typeof schema>;

export interface RecoveryKeys{
  ref:Buffer;        // HMAC of invitation references
  otp:Buffer;        // HMAC of one-time codes
  outbox:Buffer;     // AES-256-GCM of outbox payloads (code + reference)
  contact:Buffer;    // AES-256-GCM of recovery-contact destinations
  contactFp:Buffer;  // HMAC fingerprint of recovery-contact destinations
  token:Buffer;      // AES-256-GCM of reset tokens / claim secrets held in Redis
  cookie:Buffer;     // HMAC of the recovery cookie (Redis key + browser binding)
  cursor:Buffer;     // HMAC of admin queue cursors
}

/** One master secret, one derived key per purpose (HKDF-SHA256). Enrollment and test tooling use the same labels. */
export function deriveRecoveryKeys(masterHex:string):RecoveryKeys{
  const ikm=Buffer.from(masterHex,'hex');
  const k=(label:string)=>Buffer.from(crypto.hkdfSync('sha256',ikm,Buffer.from('tcds-warehouse-recovery-v192'),Buffer.from(label),32));
  return {ref:k('invitation-ref'),otp:k('otp'),outbox:k('outbox'),contact:k('contact'),contactFp:k('contact-fingerprint'),
    token:k('token-vault'),cookie:k('recovery-cookie'),cursor:k('queue-cursor')};
}

export function loadRecoveryConfig(source:NodeJS.ProcessEnv=process.env):RecoveryConfig|null{
  if(source.RECOVERY_ENABLED!=='true')return null;
  return schema.parse(source);
}
