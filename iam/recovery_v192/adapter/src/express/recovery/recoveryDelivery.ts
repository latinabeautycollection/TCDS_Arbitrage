import fs from 'node:fs';
import type {RecoveryConfig} from './recoveryConfig';

export type DeliveryOutcome='ACCEPTED'|'FAILED'|'UNKNOWN';
export interface RecoveryMessage{to:string;code:string;link:string;requestHint:string}
export interface RecoveryTransport{readonly name:string;sendEmail(m:RecoveryMessage):Promise<DeliveryOutcome>}

const body=(m:RecoveryMessage)=>
  `Your TCDS Warehouse password recovery code is ${m.code}\n\n`+
  `It expires in 10 minutes. Open this link on the device you are resetting from and enter the code:\n${m.link}\n\n`+
  `If you did not ask to reset your password, do not use the code and tell your administrator.`;

/** Microsoft Graph sendMail with the existing Domain 10 application identity (Mail.Send). */
export class GraphTransport implements RecoveryTransport{
  readonly name='graph';
  private token:{value:string;until:number}|null=null;
  constructor(private c:Required<Pick<RecoveryConfig,'M365_TENANT_ID'|'M365_CLIENT_ID'|'M365_CLIENT_SECRET'|'M365_SENDER'>>){}
  private async accessToken(){
    if(this.token&&this.token.until>Date.now())return this.token.value;
    const r=await fetch(`https://login.microsoftonline.com/${encodeURIComponent(this.c.M365_TENANT_ID)}/oauth2/v2.0/token`,{method:'POST',
      headers:{'content-type':'application/x-www-form-urlencoded'},signal:AbortSignal.timeout(10000),
      body:new URLSearchParams({client_id:this.c.M365_CLIENT_ID,client_secret:this.c.M365_CLIENT_SECRET,
        scope:'https://graph.microsoft.com/.default',grant_type:'client_credentials'})});
    const j:any=await r.json().catch(()=>({}));
    if(!r.ok||typeof j.access_token!=='string')throw new Error('GRAPH_TOKEN_UNAVAILABLE');
    this.token={value:j.access_token,until:Date.now()+Math.max(60,Number(j.expires_in??3600)-120)*1000};
    return this.token.value;
  }
  async sendEmail(m:RecoveryMessage):Promise<DeliveryOutcome>{
    const token=await this.accessToken();
    const r=await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(this.c.M365_SENDER)}/sendMail`,{method:'POST',
      headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},signal:AbortSignal.timeout(12000),
      body:JSON.stringify({message:{subject:'TCDS Warehouse password recovery code',body:{contentType:'Text',content:body(m)},
        toRecipients:[{emailAddress:{address:m.to}}]},saveToSentItems:false})});
    if(r.status===202)return 'ACCEPTED';
    if(r.status===429||r.status>=500)return 'UNKNOWN';
    return 'FAILED';
  }
}

/** STAGING TEST ONLY: appends the message to a 0600 file instead of sending it, so the test harness can read the code. */
export class CaptureTransport implements RecoveryTransport{
  readonly name='capture';
  constructor(private file:string){}
  async sendEmail(m:RecoveryMessage):Promise<DeliveryOutcome>{
    fs.appendFileSync(this.file,JSON.stringify({at:new Date().toISOString(),...m})+'\n',{mode:0o600});
    fs.chmodSync(this.file,0o600);
    return 'ACCEPTED';
  }
}

export function transportFor(c:RecoveryConfig):RecoveryTransport{
  if(c.RECOVERY_DELIVERY_MODE==='capture')return new CaptureTransport(c.RECOVERY_CAPTURE_FILE as string);
  return new GraphTransport({M365_TENANT_ID:c.M365_TENANT_ID!,M365_CLIENT_ID:c.M365_CLIENT_ID!,M365_CLIENT_SECRET:c.M365_CLIENT_SECRET!,M365_SENDER:c.M365_SENDER!});
}
