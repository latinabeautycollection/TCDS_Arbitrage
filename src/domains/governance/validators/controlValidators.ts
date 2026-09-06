const U=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function bad(m:string){return Object.assign(new Error(m),{statusCode:400})}
export function uuid(v:unknown){const s=String(v??'');if(!U.test(s))throw bad('INVALID_UUID');return s}
export function optionalUuid(v:unknown){if(v===undefined||v===null||v==='')return undefined;return uuid(v)}
export function nonEmpty(v:unknown,name:string,max=300){const s=String(v??'').trim();if(!s||s.length>max)throw bad(`INVALID_${name}`);return s}
export function evaluateBody(b:any){return{ruleCode:nonEmpty(b?.ruleCode,'RULE_CODE',128),triggerReference:nonEmpty(b?.triggerReference,'TRIGGER_REFERENCE',256),requestId:uuid(b?.requestId),correlationId:uuid(b?.correlationId),causationId:optionalUuid(b?.causationId),idempotencyKey:nonEmpty(b?.idempotencyKey,'IDEMPOTENCY_KEY',300)}}
export function recoveryBody(b:any){return{restrictedControlDecisionId:uuid(b?.restrictedControlDecisionId),recoveryTriggerReference:nonEmpty(b?.recoveryTriggerReference,'RECOVERY_TRIGGER_REFERENCE',256),requestId:uuid(b?.requestId),correlationId:uuid(b?.correlationId),idempotencyKey:nonEmpty(b?.idempotencyKey,'IDEMPOTENCY_KEY',300)}}
export function approvalBody(id:unknown,b:any){const d=String(b?.decision??'');if(!['APPROVE','REJECT'].includes(d))throw bad('INVALID_APPROVAL_DECISION');return{recoveryAttemptId:uuid(id),decision:d as'APPROVE'|'REJECT',justification:nonEmpty(b?.justification,'JUSTIFICATION',2000),requestId:uuid(b?.requestId),correlationId:uuid(b?.correlationId)}}
export function finalizeBody(id:unknown,b:any){return{recoveryAttemptId:uuid(id),requestId:uuid(b?.requestId),correlationId:uuid(b?.correlationId),idempotencyKey:nonEmpty(b?.idempotencyKey,'IDEMPOTENCY_KEY',300)}}
