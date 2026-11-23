/** Recovery-email enrollment for the signed-in employee (Login V2 /api/v1/auth/recovery-email, TCDS 645). */
import {deviceCredentialStore} from '../storage/deviceCredentialStore';
import {RecoveryApiError} from './recoveryApi';

const BASE=(import.meta.env.VITE_API_BASE_URL??'').replace(/\/$/,'');
const PATH='/api/v1/auth/recovery-email';
export type EnrollmentStatus='AWAITING_CODE'|'AWAITING_APPROVAL';
export interface RecoveryEmailView{
 active:{email:string;since:string}|null;
 pending:{email:string;status:EnrollmentStatus;requestedAt:string;expiresAt:string;approvals:number;required:number}|null;
}

async function call(method:'GET'|'POST',path:string,body?:unknown):Promise<RecoveryEmailView>{
 const h=new Headers({'Content-Type':'application/json','Accept':'application/json','X-Request-ID':crypto.randomUUID(),'X-Correlation-ID':crypto.randomUUID()});
 const secrets=await deviceCredentialStore.secrets();if(secrets?.deviceAssertion)h.set('X-TCDS-Device-Assertion',secrets.deviceAssertion);
 const csrf=document.cookie.split('; ').find(v=>v.startsWith('__Host-tcds_csrf='))?.split('=').slice(1).join('=');if(csrf)h.set('X-CSRF-Token',decodeURIComponent(csrf));
 const c=new AbortController();const t=setTimeout(()=>c.abort(),15000);
 try{
  let r:Response;
  try{r=await fetch(`${BASE}${PATH}${path}`,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body),credentials:'include',cache:'no-store',signal:c.signal});}
  catch{throw new RecoveryApiError(0,'NETWORK_ERROR');}
  if(!r.ok){let code=`HTTP_${r.status}`;try{const j=await r.json();if(typeof j?.error?.code==='string')code=j.error.code}catch{/* no body */}throw new RecoveryApiError(r.status,code);}
  return await r.json() as RecoveryEmailView;
 }finally{clearTimeout(t)}
}
export const recoveryEmailApi={
 view:()=>call('GET',''),
 start:(email:string)=>call('POST','',{email}),
 verify:(code:string)=>call('POST','/verify',{code}),
 cancel:()=>call('POST','/cancel',{}),
};
