import type { DispositionOption, ReturnOutcome, ReturnSession, ReturnType } from '../types/returnTypes';
import { mapReturnError } from '../messages/returnMessageCatalog';
const API_BASE=import.meta.env.VITE_API_BASE_URL??'';
const id=()=>crypto.randomUUID();
async function call<T>(path:string,init:RequestInit={}):Promise<T>{
 const rid=id(); let response:Response;
 try{response=await fetch(`${API_BASE}${path}`,{...init,credentials:'include',headers:{'Content-Type':'application/json','X-Request-ID':rid,'X-Correlation-ID':rid,'X-TCDS-App-Version':import.meta.env.VITE_APP_VERSION??'3.11.1',...(init.headers||{})}})}catch{throw mapReturnError({code:'RETURN_API_UNAVAILABLE',supportReference:rid});}
 const body=await response.json().catch(()=>({})); if(!response.ok)throw mapReturnError({...body,supportReference:body.supportReference??rid}); return body as T;
}
const mut=(path:string,payload:object)=>call<ReturnSession>(path,{method:'POST',body:JSON.stringify({...payload,idempotencyKey:id()})});
export const returnsApi={
 resolveScan:(value:string,returnType?:ReturnType)=>mut('/api/v1/returns/resolve-scan',{value,returnType}),
 get:(sessionId:string)=>call<ReturnSession>(`/api/v1/returns/sessions/${encodeURIComponent(sessionId)}`),
 claim:(sessionId:string)=>mut(`/api/v1/returns/sessions/${sessionId}/claim`,{}),
 renewClaim:(sessionId:string,claimToken:string,rowVersion:number)=>mut(`/api/v1/returns/sessions/${sessionId}/claim/renew`,{claimToken,rowVersion}),
 releaseClaim:(sessionId:string,claimToken:string,rowVersion:number)=>mut(`/api/v1/returns/sessions/${sessionId}/claim/release`,{claimToken,rowVersion}),
 requestTakeover:(sessionId:string,reason:string,rowVersion:number)=>mut(`/api/v1/returns/sessions/${sessionId}/takeover/request`,{reason,rowVersion}),
 approveTakeover:(sessionId:string,requestId:string,rowVersion:number)=>mut(`/api/v1/returns/sessions/${sessionId}/takeover/approve`,{requestId,rowVersion}),
 classify:(sessionId:string,returnType:ReturnType,rowVersion:number)=>mut(`/api/v1/returns/sessions/${sessionId}/classify`,{returnType,rowVersion}),
 savePackageInspection:(sessionId:string,payload:object,rowVersion:number)=>mut(`/api/v1/returns/sessions/${sessionId}/package-inspection`,{...payload,rowVersion}),
 reconcileContents:(sessionId:string,payload:object,rowVersion:number)=>mut(`/api/v1/returns/sessions/${sessionId}/contents`,{...payload,rowVersion}),
 compareEvidence:(sessionId:string,rowVersion:number)=>mut(`/api/v1/returns/sessions/${sessionId}/evidence/compare`,{rowVersion}),
 saveConditionSafety:(sessionId:string,payload:object,rowVersion:number)=>mut(`/api/v1/returns/sessions/${sessionId}/condition-safety`,{...payload,rowVersion}),
 assess:(sessionId:string,rowVersion:number)=>mut(`/api/v1/returns/sessions/${sessionId}/assess`,{rowVersion}),
 permittedDispositions:(sessionId:string)=>call<{options:DispositionOption[]}>(`/api/v1/returns/sessions/${sessionId}/dispositions/permitted`),
 saveDisposition:(sessionId:string,outcome:ReturnOutcome,reason:string,rowVersion:number)=>mut(`/api/v1/returns/sessions/${sessionId}/disposition`,{outcome,reason,rowVersion}),
 completePrerequisite:(sessionId:string,outcome:ReturnOutcome,payload:object,rowVersion:number)=>mut(`/api/v1/returns/sessions/${sessionId}/disposition/${outcome.toLowerCase()}/prerequisites`,{...payload,rowVersion}),
 completionCheck:(sessionId:string,rowVersion:number)=>mut(`/api/v1/returns/sessions/${sessionId}/completion-check`,{rowVersion}),
 complete:(sessionId:string,rowVersion:number)=>mut(`/api/v1/returns/sessions/${sessionId}/complete`,{rowVersion}),
};
