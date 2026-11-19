// Software platform authenticator (as Face ID / Touch ID / Windows Hello) for the central ceremony tests.
// Based on our R11 certification helper; adds control over the UV flag, the counter and the origin.
import crypto from 'node:crypto';

const b64u=(b:Uint8Array|Buffer)=>Buffer.from(b).toString('base64url');
function cbor(v:any):Buffer{
  const head=(major:number,n:number)=>n<24?Buffer.from([major<<5|n]):n<256?Buffer.from([major<<5|24,n])
    :n<65536?Buffer.from([major<<5|25,n>>8,n&255]):(()=>{const b=Buffer.alloc(5);b[0]=major<<5|26;b.writeUInt32BE(n,1);return b})();
  if(typeof v==='number')return v>=0?head(0,v):head(1,-1-v);
  if(Buffer.isBuffer(v))return Buffer.concat([head(2,v.length),v]);
  if(typeof v==='string'){const s=Buffer.from(v,'utf8');return Buffer.concat([head(3,s.length),s])}
  if(v instanceof Map)return Buffer.concat([head(5,v.size),...[...v].flatMap(([k,x])=>[cbor(k),cbor(x)])]);
  throw new Error('cbor: unsupported');
}
type Cred={privateKey:crypto.KeyObject;userHandle:string;signCount:number};

export class SoftAuthenticator{
  credentials=new Map<string,Cred>();
  constructor(public rpId:string,public origin:string){}
  private rpIdHash(){return crypto.createHash('sha256').update(this.rpId).digest()}
  private clientData(type:string,challenge:string,origin=this.origin){return Buffer.from(JSON.stringify({type,challenge,origin,crossOrigin:false}))}

  create(options:any,o:{uv?:boolean;origin?:string}={}){
    if(options.rp?.id!==this.rpId)throw new Error('rp id mismatch');
    const {publicKey,privateKey}=crypto.generateKeyPairSync('ec',{namedCurve:'P-256'});
    const jwk:any=publicKey.export({format:'jwk'});
    const credId=crypto.randomBytes(32);
    const cose=cbor(new Map<any,any>([[1,2],[3,-7],[-1,1],[-2,Buffer.from(jwk.x,'base64url')],[-3,Buffer.from(jwk.y,'base64url')]]));
    const len=Buffer.alloc(2);len.writeUInt16BE(credId.length);
    const flags=o.uv===false?0x41:0x45; // UP|AT (+UV)
    const authData=Buffer.concat([this.rpIdHash(),Buffer.from([flags]),Buffer.alloc(4),Buffer.alloc(16),len,credId,cose]);
    const attestationObject=cbor(new Map<any,any>([['fmt','none'],['attStmt',new Map()],['authData',authData]]));
    const id=b64u(credId);
    this.credentials.set(id,{privateKey,userHandle:options.user.id,signCount:0});
    return {id,rawId:id,type:'public-key',response:{attestationObject:b64u(attestationObject),
      clientDataJSON:b64u(this.clientData('webauthn.create',options.challenge,o.origin)),transports:['internal']},
      clientExtensionResults:{},authenticatorAttachment:'platform'};
  }

  /** Discoverable: no allowCredentials, the authenticator chooses (here: the given or first credential). */
  get(options:any,o:{credentialId?:string;uv?:boolean;origin?:string;counter?:number;badSignature?:boolean;userHandle?:string}={}){
    const id=o.credentialId??[...this.credentials.keys()][0];
    const c=this.credentials.get(id)!;
    if(o.counter===undefined)c.signCount+=1;else c.signCount=o.counter;
    const count=Buffer.alloc(4);count.writeUInt32BE(c.signCount);
    const authData=Buffer.concat([this.rpIdHash(),Buffer.from([o.uv===false?0x01:0x05]),count]);
    const clientDataJSON=this.clientData('webauthn.get',options.challenge,o.origin);
    const signed=Buffer.concat([authData,crypto.createHash('sha256').update(clientDataJSON).digest()]);
    const signature=crypto.sign('sha256',o.badSignature?Buffer.from('not what was asked'):signed,c.privateKey);
    return {id,rawId:id,type:'public-key',response:{authenticatorData:b64u(authData),clientDataJSON:b64u(clientDataJSON),
      signature:b64u(signature),userHandle:o.userHandle??c.userHandle},clientExtensionResults:{},authenticatorAttachment:'platform'};
  }
}
