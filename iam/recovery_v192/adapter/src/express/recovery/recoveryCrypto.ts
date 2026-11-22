import crypto from 'node:crypto';

export const hmac=(key:Buffer,label:string,value:string|Buffer)=>
  crypto.createHmac('sha256',key).update(label).update('\0').update(value).digest();

export const sha256hex=(b:Buffer)=>crypto.createHash('sha256').update(b).digest('hex');

export function seal(plain:Buffer|string,key:Buffer){
  const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv);
  const ciphertext=Buffer.concat([c.update(plain),c.final()]);
  return {ciphertext,iv,tag:c.getAuthTag()};
}
export function unseal(x:{ciphertext:Buffer;iv:Buffer;tag:Buffer},key:Buffer):Buffer{
  const d=crypto.createDecipheriv('aes-256-gcm',key,x.iv);d.setAuthTag(x.tag);
  return Buffer.concat([d.update(x.ciphertext),d.final()]);
}
/** Compact single-string form for Redis values: base64url(iv).base64url(tag).base64url(ciphertext). */
export const sealString=(plain:string,key:Buffer)=>{const s=seal(plain,key);return [s.iv,s.tag,s.ciphertext].map(b=>b.toString('base64url')).join('.');};
export function unsealString(v:string,key:Buffer):string{
  const [iv,tag,ct]=v.split('.').map(p=>Buffer.from(p,'base64url'));
  if(!iv||!tag||!ct||iv.length!==12||tag.length!==16)throw new Error('RECOVERY_SEALED_VALUE_INVALID');
  return unseal({ciphertext:ct,iv,tag},key).toString('utf8');
}

export const randomRef=()=>crypto.randomBytes(32).toString('base64url');          // 43 chars
export const randomCode=()=>crypto.randomInt(0,100_000_000).toString().padStart(8,'0');
export const otpDigest=(code:string,salt:Buffer,key:Buffer)=>
  crypto.createHmac('sha256',key).update('TCDS-RECOVERY-OTP-V192\0').update(salt).update(code,'utf8').digest();
export const safeEqual=(a:Buffer,b:Buffer)=>a.length===b.length&&crypto.timingSafeEqual(a,b);
export const REF_RE=/^[A-Za-z0-9_-]{43}$/;
