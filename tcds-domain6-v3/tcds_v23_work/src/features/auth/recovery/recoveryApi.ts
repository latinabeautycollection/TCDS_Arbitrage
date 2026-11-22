/** Warehouse password recovery client (server contract: Login V2 /api/v1/auth/password-recovery, TCDS 644). The server owns every decision. */
import {deviceCredentialStore} from '../storage/deviceCredentialStore';
const BASE=(import.meta.env.VITE_API_BASE_URL??'').replace(/\/$/,'');
const PREFIX='/api/v1/auth/password-recovery';
export type Reason='FORGOT_PASSWORD'|'ACCOUNT_LOCKED'|'SUSPECTED_COMPROMISE'|'OTHER';
export type OverrideReason='CRITICAL_SHIFT_ACCESS'|'ACCOUNT_COMPROMISE'|'OPERATIONAL_EMERGENCY'|'PRIOR_RESET_FAILURE'|'OTHER_APPROVED_EXCEPTION';
/** The server only approves here; reject / extra verification are not offered (it answers 422 for them). */
export type Decision='APPROVE_RESET';
export interface Review { requestId:string; expectedRowVersion:string; employeeDisplayId:string; status:string; reasonCode?:string; reason?:string; requestedAt?:string; facilityId?:string; }
export interface StepUpOptions {challengeId:string;options:import('../types/authTypes').PublicKeyCredentialRequestOptionsJSON;purpose:'WAREHOUSE_PASSWORD_RESET_APPROVAL';requestId:string;rowVersion:string}

/** Carries the server's error code (e.g. OTP_INVALID, PASSWORD_BREACHED) so screens can say what to do next. */
export class RecoveryApiError extends Error{constructor(public readonly status:number,public readonly code:string){super(code);this.name='RecoveryApiError';}}

function uuid(){return crypto.randomUUID()}
function csrfToken(){return document.cookie.split('; ').find(v=>v.startsWith('__Host-tcds_csrf='))?.split('=').slice(1).join('=')}
async function headers(authenticated:boolean):Promise<Headers>{
 const h=new Headers({'Content-Type':'application/json','Accept':'application/json','X-Request-ID':uuid(),'X-Correlation-ID':uuid()});
 if(authenticated){const secrets=await deviceCredentialStore.secrets();if(secrets?.deviceAssertion)h.set('X-TCDS-Device-Assertion',secrets.deviceAssertion);}
 // Login V2 checks CSRF whenever this browser holds a session cookie - also on the public recovery steps (shared device).
 const csrf=csrfToken();if(csrf)h.set('X-CSRF-Token',decodeURIComponent(csrf));
 return h;
}
async function call<T>(path:string,body?:unknown,authenticated=false):Promise<T>{
 const c=new AbortController();const timer=setTimeout(()=>c.abort(),15000);
 try {
  let r:Response;
  try{r=await fetch(`${BASE}${PREFIX}${path}`,{method:body===undefined?'GET':'POST',headers:await headers(authenticated),body:body===undefined?undefined:JSON.stringify(body),credentials:'include',cache:'no-store',signal:c.signal});}
  catch{throw new RecoveryApiError(0,'NETWORK_ERROR');}
  if(!r.ok){let code=`HTTP_${r.status}`;try{const j=await r.json();if(typeof j?.error?.code==='string')code=j.error.code}catch{/* no JSON body */}throw new RecoveryApiError(r.status,code);}
  if(r.status===204)return undefined as T;
  return await r.json() as T;
 }finally{clearTimeout(timer)}
}
export const recoveryApi={
 request:(input:{identifier:string;reason:Reason;details?:string})=>call<{message:string}>('/request',input),
 pending:(options?:{cursor?:string;limit?:number})=>{const q=new URLSearchParams();if(options?.cursor)q.set('cursor',options.cursor);q.set('limit',String(options?.limit??25));return call<{items:Review[];nextCursor:string|null}>(`/admin/pending?${q}`,undefined,true)},
 invitationContext:(reference:string)=>call<{publicReference:string}>(`/invitation/context?ref=${encodeURIComponent(reference)}`),
 review:(id:string)=>call<Review>(`/admin/review/${encodeURIComponent(id)}`,undefined,true),
 beginApproval:(id:string)=>call<StepUpOptions>(`/admin/step-up/${encodeURIComponent(id)}`,{},true),
 adminDecision:(input:{requestId:string;expectedRowVersion:string;decision:Decision;challengeId:string;passkeyResponse:unknown})=>call<{status:string;deliveryStatus?:string}>('/admin/approve',input,true),
 override:(input:{priorRequestId:string;reason:OverrideReason;justification:string})=>call<{status:string}>('/manager/override',input,true),
 /** Server issues the browser binding as an HttpOnly __Host- cookie for this invitation. Call once per page. */
 browserBinding:(reference:string)=>call<void>('/binding',{reference}),
 /** Code + new password in one request: the server checks the code, claims the reset and sets the password. */
 complete:(input:{reference:string;newPassword:string;code?:string})=>call<{completed:true}>('/complete',input),
};
