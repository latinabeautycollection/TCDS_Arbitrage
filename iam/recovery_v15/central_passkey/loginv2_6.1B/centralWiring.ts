import type {CentralPasskeyConfig} from './internalIamApi';

// Reads the central passkey settings (TCDS 626) from the 6.1B environment. All-or-none: absent -> the internal IAM
// API is exactly as before; partial -> refuse to start rather than run half-configured.
const KEYS=['EOC_IAM_ISSUER_PASSKEY_KEY','CENTRAL_OIDC_ISSUER','CENTRAL_RP_ID','CENTRAL_VERIFIER_URL','CENTRAL_WORKLOAD_SECRET',
  'CENTRAL_SUBJECT_KEY'] as const;
export function centralPasskeyFromEnv(env:Record<string,unknown>,resultPublicKeyPem:string):CentralPasskeyConfig|undefined{
  const set=KEYS.filter(k=>typeof env[k]==='string'&&env[k]!=='');
  if(set.length===0)return undefined;
  if(set.length!==KEYS.length)throw new Error('CENTRAL_PASSKEY_CONFIG_INCOMPLETE');
  const s=(k:string)=>String(env[k]);
  const rpId=s('CENTRAL_RP_ID');
  const cfg:CentralPasskeyConfig={issuerPasskeySecret:s('EOC_IAM_ISSUER_PASSKEY_KEY'),allowedIssuer:s('CENTRAL_OIDC_ISSUER').replace(/\/$/,''),
    subjectKey:s('CENTRAL_SUBJECT_KEY'),
    verifier:{baseUrl:s('CENTRAL_VERIFIER_URL'),workloadSecret:s('CENTRAL_WORKLOAD_SECRET'),resultPublicKeyPem,rpId}};
  if(env.CENTRAL_ENROLL_PORT!==undefined&&env.CENTRAL_ENROLL_ASSETS_DIR!==undefined)
    cfg.enrollment={host:'127.0.0.1',port:Number(env.CENTRAL_ENROLL_PORT),publicOrigin:`https://${rpId}/`,assetsDir:s('CENTRAL_ENROLL_ASSETS_DIR')};
  return cfg;
}
