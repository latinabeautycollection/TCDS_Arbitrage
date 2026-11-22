import crypto from 'node:crypto';
import {hmac,sealString,unsealString} from './recoveryCrypto';

/** The subset of ioredis this store uses (lets tests use a fake). */
export interface RedisLike{
  set(key:string,value:string,ex:'EX',seconds:number,nx?:'NX'):Promise<'OK'|null>;
  get(key:string):Promise<string|null>;
  del(...keys:string[]):Promise<number>;
  eval(script:string,numKeys:number,...args:(string|number)[]):Promise<unknown>;
}

export const RECOVERY_COOKIE='__Host-tcds_recovery';
export const COOKIE_RE=/^[A-Za-z0-9_-]{43}$/;

export interface ClaimedSecrets{claimToken:string;browserBinding:string;proofId:string}
export type BrowserState={stage:'RESERVED';requestId:string}|{stage:'CLAIMED';requestId:string;secrets:ClaimedSecrets};

// Replace RESERVED with CLAIMED only for the same request; never extend or overwrite a CLAIMED entry.
const CLAIM_LUA=`local v=redis.call('GET',KEYS[1]) if not v then return 0 end
local x=cjson.decode(v) if x.r~=ARGV[1] or x.s~='R' then return 0 end
redis.call('SET',KEYS[1],ARGV[2],'EX',tonumber(ARGV[3])) return 1`;

/**
 * Redis holds only short-lived, encrypted browser state and the reset token between approval and claim.
 * The database stays the authority: losing Redis can only make a reset unusable (re-approve), never weaker.
 */
export class RecoveryStore{
  constructor(private redis:RedisLike,private cookieKey:Buffer,private tokenKey:Buffer){}

  newCookieValue(){return crypto.randomBytes(32).toString('base64url');}
  bindingHash(cookie:string){return hmac(this.cookieKey,'browser-binding',cookie);}               // 32 bytes, stored in DB
  private ckey(cookie:string){
    if(!COOKIE_RE.test(cookie))throw new Error('RECOVERY_COOKIE_INVALID');
    return 'rcv192:b:'+hmac(this.cookieKey,'redis-key',cookie).toString('hex');
  }
  private tkey(requestId:string){return 'rcv192:t:'+hmac(this.cookieKey,'token-key',requestId).toString('hex');}

  async reserve(cookie:string,requestId:string,ttl=900){
    return (await this.redis.set(this.ckey(cookie),JSON.stringify({s:'R',r:requestId}),'EX',ttl,'NX'))==='OK';
  }
  async state(cookie:string):Promise<BrowserState|null>{
    const v=await this.redis.get(this.ckey(cookie));if(!v)return null;
    try{
      const x=JSON.parse(v);
      if(x.s==='R'&&typeof x.r==='string')return {stage:'RESERVED',requestId:x.r};
      if(x.s==='C'&&typeof x.r==='string'&&typeof x.c==='string')
        return {stage:'CLAIMED',requestId:x.r,secrets:JSON.parse(unsealString(x.c,this.tokenKey))};
    }catch{/* unreadable entry = no state */}
    return null;
  }
  async markClaimed(cookie:string,requestId:string,secrets:ClaimedSecrets,ttl=300){
    const value=JSON.stringify({s:'C',r:requestId,c:sealString(JSON.stringify(secrets),this.tokenKey)});
    return (await this.redis.eval(CLAIM_LUA,1,this.ckey(cookie),requestId,value,ttl))===1;
  }
  async forget(cookie:string){await this.redis.del(this.ckey(cookie));}

  /** Reset token between approval and claim. TTL = the reset's own expiry. */
  async putToken(requestId:string,token:string,ttl:number){
    if((await this.redis.set(this.tkey(requestId),sealString(token,this.tokenKey),'EX',ttl))!=='OK')throw new Error('RECOVERY_TOKEN_STORE_FAILED');
  }
  async getToken(requestId:string){const v=await this.redis.get(this.tkey(requestId));return v?unsealString(v,this.tokenKey):null;}
  async dropToken(requestId:string){await this.redis.del(this.tkey(requestId));}
}
