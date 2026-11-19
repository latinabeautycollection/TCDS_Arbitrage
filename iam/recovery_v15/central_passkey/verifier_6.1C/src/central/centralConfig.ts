import {z} from 'zod';

/**
 * Central issuer passkey ceremony (626). Optional: the central routes exist only when ALL of these are set.
 * The RP is the issuer's own host (staging login-stg.tcdsolutionsgroup.com), never the Warehouse RP.
 */
const C=z.object({
  CENTRAL_RP_ID:z.string().regex(/^[a-z0-9.-]{3,253}$/),
  CENTRAL_ORIGIN:z.string().url(),
  CENTRAL_RP_NAME:z.string().min(1).max(64).default('TCDS'),
  CENTRAL_DATABASE_URL:z.string().min(1),
  CENTRAL_WORKLOAD_SECRET:z.string().min(32),
  CENTRAL_LOGIN_TTL_SECONDS:z.coerce.number().int().min(30).max(120).default(120),
});
export type CentralConfig=z.infer<typeof C>&{verifierInstance:string;challengeHashKey:string;claimHashKey:string;
  resultSigningPrivateKeyPem:string};

const KEYS=['CENTRAL_RP_ID','CENTRAL_ORIGIN','CENTRAL_DATABASE_URL','CENTRAL_WORKLOAD_SECRET'] as const;

export function readCentralConfig(e:NodeJS.ProcessEnv,base:{VERIFIER_INSTANCE:string;CHALLENGE_HASH_KEY:string;CLAIM_HASH_KEY:string;
  RESULT_SIGNING_PRIVATE_KEY_PEM:string;RP_ID:string}):CentralConfig|null{
  const set=KEYS.filter(k=>e[k]!==undefined&&e[k]!=='');
  if(set.length===0)return null;
  if(set.length!==KEYS.length)throw new Error('CENTRAL_CONFIG_INCOMPLETE');
  const c=C.parse(e);
  if(c.CENTRAL_ORIGIN!==`https://${c.CENTRAL_RP_ID}`)throw new Error('CENTRAL_ORIGIN_MUST_BE_HTTPS_RP_ID');
  // The Warehouse RP stays the Warehouse RP: a central ceremony on it would mix the two credential sets.
  if(c.CENTRAL_RP_ID===base.RP_ID)throw new Error('CENTRAL_RP_ID_MUST_DIFFER_FROM_WAREHOUSE_RP_ID');
  return {...c,verifierInstance:base.VERIFIER_INSTANCE,challengeHashKey:base.CHALLENGE_HASH_KEY,claimHashKey:base.CLAIM_HASH_KEY,
    resultSigningPrivateKeyPem:base.RESULT_SIGNING_PRIVATE_KEY_PEM};
}
