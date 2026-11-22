import crypto from 'node:crypto';
import type {Pool} from 'pg';
import type {RecoveryKeys} from './recoveryConfig';
import type {RecoveryTransport,DeliveryOutcome} from './recoveryDelivery';
import {hmac,otpDigest,randomCode,randomRef,seal,unseal} from './recoveryCrypto';

const POLICY_CODES=new Set(['VERIFIED_RECOVERY_DESTINATION_REQUIRED','RESET_NOT_APPROVED','RECOVERY_CHALLENGE_ALREADY_OUTSTANDING',
  'INVITATION_ISSUE_NOT_AUTHORIZED','OTP_ISSUE_INPUT_INVALID']);
const log=(level:string,msg:string,extra:Record<string,unknown>={})=>console.log(JSON.stringify({level,msg,component:'recovery-v192',...extra}));

/**
 * One single-flight loop inside the login API process (PM2 fork mode = one instance):
 *   quarantine stale SENDING rows -> issue the code for one approved reset -> deliver one queued code.
 * The worker never approves anything and never sees the reset token. Codes exist in plaintext only in memory
 * and inside the AES-GCM outbox payload, which the database scrubs once delivery settles.
 */
export class RecoveryWorkers{
  private timer:NodeJS.Timeout|null=null;private running=false;
  constructor(private pool:Pool,private keys:RecoveryKeys,private transport:RecoveryTransport,private linkBase:string,private tickMs:number){}

  start(){if(!this.timer){this.timer=setInterval(()=>void this.tick(),this.tickMs);this.timer.unref();log('info','workers started',{transport:this.transport.name});}}
  async stop(){if(this.timer){clearInterval(this.timer);this.timer=null;}for(let i=0;i<50&&this.running;i++)await new Promise(r=>setTimeout(r,100));}

  async tick(){
    if(this.running)return;this.running=true;
    try{
      const q=await this.pool.query('SELECT warehouse_identity.recovery_delivery_quarantine_v192(90) n');
      if(Number(q.rows[0]?.n)>0)log('warn','deliveries quarantined as UNKNOWN',{count:Number(q.rows[0].n)});
      await this.issueOne();
      await this.deliverOne();
    }catch(e:any){log('error','worker tick failed',{error:String(e?.message??e).slice(0,120)});}
    finally{this.running=false;}
  }

  async issueOne():Promise<string>{
    const r=(await this.pool.query('SELECT * FROM warehouse_identity.recovery_issuance_lease_v192()')).rows[0];
    if(!r)return 'EMPTY';
    const requestId:string=r.reset_request_id;
    try{
      if(r.code_status==='REVIEW'){await this.settle(requestId,'POLICY_BLOCKED');log('warn','issuance needs operator review',{requestId});return 'REVIEW';}
      if(r.code_status==='NONE'){
        const ref=randomRef(),code=randomCode(),salt=crypto.randomBytes(16);
        await this.pool.query('SELECT warehouse_identity.recovery_invitation_issue_v192($1,$2)',[requestId,hmac(this.keys.ref,'invitation',ref)]);
        const payload=seal(JSON.stringify({code,ref}),this.keys.outbox);
        await this.pool.query('SELECT * FROM warehouse_identity.recovery_otp_issue_v192($1,$2,$3,$4,$5,$6,$7,$8)',
          [requestId,'EMAIL',otpDigest(code,salt,this.keys.otp),salt,payload.ciphertext,payload.iv,payload.tag,r.correlation_id]);
      }
      await this.settle(requestId,'PREPARED');
      return 'PREPARED';
    }catch(e:any){
      const code=String(e?.message??'');const policy=POLICY_CODES.has(code);
      await this.settle(requestId,policy?'POLICY_BLOCKED':'TRANSIENT').catch(()=>{});
      log(policy?'warn':'error','issuance blocked',{requestId,reason:policy?code:'TRANSIENT'});
      return policy?'POLICY_BLOCKED':'TRANSIENT';
    }
  }
  private settle(requestId:string,outcome:string){
    return this.pool.query('SELECT warehouse_identity.recovery_issuance_settle_v192($1,$2)',[requestId,outcome]);
  }

  async deliverOne():Promise<DeliveryOutcome|'EMPTY'>{
    const d=(await this.pool.query('SELECT * FROM warehouse_identity.recovery_delivery_claim_v192()')).rows[0];
    if(!d)return 'EMPTY';
    let outcome:DeliveryOutcome='UNKNOWN';
    try{
      const {code,ref}=JSON.parse(unseal({ciphertext:d.encrypted_payload,iv:d.payload_iv,tag:d.payload_tag},this.keys.outbox).toString('utf8'));
      const to=unseal({ciphertext:d.destination_ciphertext,iv:d.destination_iv,tag:d.destination_tag},this.keys.contact).toString('utf8');
      if(d.channel!=='EMAIL')outcome='FAILED';
      else outcome=await this.transport.sendEmail({to,code,link:`${this.linkBase}?ref=${encodeURIComponent(ref)}`,requestHint:String(d.challenge_id).slice(0,8)});
    }catch(e:any){outcome='UNKNOWN';log('error','delivery attempt failed',{deliveryId:d.delivery_id,error:String(e?.message??e).slice(0,80)});}
    await this.pool.query('SELECT warehouse_identity.recovery_delivery_settle_v192($1,$2)',[d.delivery_id,outcome]);
    log(outcome==='ACCEPTED'?'info':'warn','delivery settled',{deliveryId:d.delivery_id,outcome});
    return outcome;
  }
}
