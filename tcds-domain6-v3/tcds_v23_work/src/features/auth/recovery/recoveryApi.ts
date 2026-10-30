/** Additive V1.5 recovery client. Server owns every authorization decision. */
import {deviceCredentialStore} from '../storage/deviceCredentialStore';
const BASE=(import.meta.env.VITE_API_BASE_URL??'').replace(/\/$/,'');
const PREFIX='/api/v1/auth/password-recovery';
export type Reason='FORGOT_PASSWORD'|'ACCOUNT_LOCKED'|'SUSPECTED_COMPROMISE'|'OTHER';
export type OverrideReason='CRITICAL_SHIFT_ACCESS'|'ACCOUNT_COMPROMISE'|'OPERATIONAL_EMERGENCY'|'PRIOR_RESET_FAILURE'|'OTHER_APPROVED_EXCEPTION';
export type Decision='APPROVE_RESET'|'REQUIRE_VERIFICATION'|'REJECT';
export interface Review { requestId:string; expectedRowVersion:string; employeeDisplayId:string; status:string; reason?:string; requestedAt?:string; facilityId?:string; }
export interface StepUpOptions {challengeId:string;options:import('../types/authTypes').PublicKeyCredentialRequestOptionsJSON;purpose:'WAREHOUSE_PASSWORD_RESET_APPROVAL';requestId:string;rowVersion:string}
function uuid(){return crypto.randomUUID()}
async function trustedHeaders():Promise<Headers>{
 const h=new Headers({'Content-Type':'application/json','Accept':'application/json','X-Request-ID':uuid(),'X-Correlation-ID':uuid()});
 const secrets=await deviceCredentialStore.secrets();
 if(secrets?.deviceAssertion) h.set('X-TCDS-Device-Assertion',secrets.deviceAssertion);
 const csrf=document.cookie.split('; ').find(v=>v.startsWith('__Host-tcds_csrf='))?.split('=').slice(1).join('=');
 if(csrf)h.set('X-CSRF-Token',decodeURIComponent(csrf));
 return h;
}
async function call<T>(path:string,body?:unknown,authenticated=false):Promise<T>{
 const c=new AbortController();const timer=setTimeout(()=>c.abort(),12000);
 try {
  const headers=authenticated?await trustedHeaders():new Headers({'Content-Type':'application/json','Accept':'application/json','X-Request-ID':uuid(),'X-Correlation-ID':uuid()});
  const r=await fetch(`${BASE}${PREFIX}${path}`,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body),credentials:'include',cache:'no-store',signal:c.signal});
  if(!r.ok)throw new Error(`RECOVERY_HTTP_${r.status}`);
  if(r.status===204)return undefined as T;
  return await r.json() as T;
 }finally{clearTimeout(timer)}
}
export const recoveryApi={
 request:(input:{identifier:string;reason:Reason;details?:string})=>call<{message:string}>('/request',input),
 pending:(options?:{facilityId?:string;cursor?:string;limit?:number})=>{const q=new URLSearchParams();if(options?.facilityId)q.set('facilityId',options.facilityId);if(options?.cursor)q.set('cursor',options.cursor);q.set('limit',String(options?.limit??20));return call<{items:Review[];nextCursor:string|null}>(`/admin/pending?${q}`,undefined,true)},
 invitationContext:(reference:string)=>call<{publicReference:string;requestId:string}>(`/invitation/context?ref=${encodeURIComponent(reference)}`),
 review:(id:string)=>call<Review>(`/admin/review/${encodeURIComponent(id)}`,undefined,true),
 beginApproval:(id:string)=>call<StepUpOptions>(`/admin/step-up/${encodeURIComponent(id)}`,{},true),
 adminDecision:(input:{requestId:string;expectedRowVersion:string;decision:Decision;notes:string;verificationReference?:string;challengeId?:string;passkeyResponse?:unknown})=>call<{status:string}>('/admin/approve',input,true),
 override:(input:{priorRequestId:string;reason:OverrideReason;justification:string})=>call<{status:string}>('/manager/override',input,true),
 /** Server must issue a short-lived browser binding, bound to an HttpOnly recovery cookie. Never self-generate one. */
 browserBinding:()=>call<void>('/binding',{}),
 claim:(input:{reference:string;code:string})=>call<void>('/claim',input),
 complete:(input:{reference:string;newPassword:string})=>call<{completed:true}>('/complete',input),
 history:()=>call<{items:Array<{requestId:string;status:string;createdAt:string;reasonCode:string}>}>('/me/history',undefined,true),
 totals:(targetUserId:string)=>call<unknown>(`/admin/totals/${encodeURIComponent(targetUserId)}`,undefined,true)
};
