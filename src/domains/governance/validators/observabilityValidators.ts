import { createHash } from 'node:crypto';
import type { ObservationInput,QueryWindow } from '../models/observabilityTypes';
import { OBSERVATION_TYPES } from '../constants/observabilityConstants';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRACE=/^[0-9a-f]{32}$/i;
const SPAN=/^[0-9a-f]{16}$/i;
const SHA=/^[0-9a-f]{64}$/;
const UUID_NAMESPACE='2b62ae7a-2d4c-5d57-b2d7-11f000000007';

export function requireUuid(v:unknown,name:string):string{
  if(typeof v!=='string'||!UUID.test(v))throw bad(`INVALID_${name.toUpperCase()}`);
  return v.toLowerCase();
}
export function optionalUuid(v:unknown,name:string):string|undefined{
  if(v===undefined||v===null||v==='')return undefined;
  return requireUuid(v,name);
}
export function deterministicUuid(name:string):string{
  const ns=Buffer.from(UUID_NAMESPACE.replace(/-/g,''),'hex');
  const hash=createHash('sha1').update(ns).update(Buffer.from(name,'utf8')).digest();
  const b=Buffer.from(hash.subarray(0,16));
  b[6]=(b[6]!&0x0f)|0x50;b[8]=(b[8]!&0x3f)|0x80;
  const h=b.toString('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
export function resolveStableUuid(v:unknown,kind:'correlation'|'request',idempotencyKey:string):string{
  if(v===undefined||v===null||v==='')return deterministicUuid(`11G|HTTP|${kind}|${idempotencyKey}`);
  return requireUuid(v,`${kind}_id`);
}
export function validateTraceId(v:unknown):string|undefined{
  if(v===undefined||v===null||v==='')return undefined;
  if(typeof v!=='string'||!TRACE.test(v)||/^0+$/.test(v))throw bad('INVALID_TRACE_ID');
  return v.toLowerCase();
}
export function validateSpanId(v:unknown):string|undefined{
  if(v===undefined||v===null||v==='')return undefined;
  if(typeof v!=='string'||!SPAN.test(v)||/^0+$/.test(v))throw bad('INVALID_SPAN_ID');
  return v.toLowerCase();
}

export function parseObservation(body:unknown,headers:Record<string,unknown>):ObservationInput{
  const b=(body??{}) as Record<string,unknown>;
  const type=String(b.observationType??'');
  if(!OBSERVATION_TYPES.has(type as never))throw bad('INVALID_OBSERVATION_TYPE');
  const idempotencyKey=reqString(b.idempotencyKey,'idempotencyKey',300);
  const occurredAt=new Date(String(b.occurredAt??''));
  if(Number.isNaN(occurredAt.getTime()))throw bad('INVALID_OCCURRED_AT');
  const metadata=(b.metadata??{}) as unknown;
  if(!metadata||typeof metadata!=='object'||Array.isArray(metadata))throw bad('INVALID_METADATA');
  const duration=b.durationMs===undefined?undefined:Number(b.durationMs);
  if(duration!==undefined&&(!Number.isFinite(duration)||duration<0))throw bad('INVALID_DURATION_MS');
  const authSha=b.authoritativeRecordSha256===undefined?undefined:String(b.authoritativeRecordSha256);
  if(authSha!==undefined&&!SHA.test(authSha))throw bad('INVALID_AUTHORITATIVE_SHA256');
  const trace=parseTraceParent(headers.traceparent);
  return {
    observationType:type as ObservationInput['observationType'],
    subjectDomainCode:reqString(b.subjectDomainCode,'subjectDomainCode',16),
    subjectComponentId:optionalUuid(b.subjectComponentId,'subject_component_id'),
    operationCode:reqString(b.operationCode,'operationCode',128),
    outcome:enumValue(b.outcome,['SUCCESS','FAILURE','DEGRADED','RETRY','TIMEOUT','CANCELLED','UNKNOWN'],'outcome'),
    severity:enumValue(b.severity,['DEBUG','INFO','WARN','ERROR','CRITICAL'],'severity'),
    correlationId:resolveStableUuid(headers['x-correlation-id']??b.correlationId,'correlation',idempotencyKey),
    requestId:resolveStableUuid(headers['x-request-id']??b.requestId,'request',idempotencyKey),
    causationId:optionalUuid(b.causationId,'causation_id'),eventId:optionalUuid(b.eventId,'event_id'),
    traceId:validateTraceId(b.traceId)??trace?.traceId,spanId:validateSpanId(b.spanId)??trace?.spanId,
    parentSpanId:validateSpanId(b.parentSpanId),traceFlags:integerRange(b.traceFlags,0,255),
    traceState:optionalString(b.traceState,512),transactionId:optionalString(b.transactionId,128),
    jobId:optionalString(b.jobId,256),queueMessageId:optionalString(b.queueMessageId,256),
    authoritativeReference:optionalString(b.authoritativeReference,1024),authoritativeRecordSha256:authSha,
    durationMs:duration,metadata:metadata as Record<string,unknown>,sourceEventId:optionalString(b.sourceEventId,512),
    occurredAt,idempotencyKey
  };
}

export function parseQueryWindow(q:Record<string,unknown>):QueryWindow{
  const to=q.to?new Date(String(q.to)):new Date();const from=q.from?new Date(String(q.from)):new Date(to.getTime()-86400000);
  if(Number.isNaN(from.getTime())||Number.isNaN(to.getTime())||to<=from)throw bad('INVALID_QUERY_WINDOW');
  if(to.getTime()-from.getTime()>31*86400000)throw bad('QUERY_WINDOW_TOO_LARGE');
  const limit=Number(q.limit??500);if(!Number.isInteger(limit)||limit<1||limit>1000)throw bad('INVALID_LIMIT');
  return {from,to,limit};
}
export function parseTraceParent(v:unknown):{traceId:string;spanId:string;traceFlags:number}|undefined{
  if(typeof v!=='string'||!v.trim())return undefined;
  const m=/^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i.exec(v.trim());
  if(!m||/^0+$/.test(m[1]!)||/^0+$/.test(m[2]!))throw bad('INVALID_TRACEPARENT');
  return {traceId:m[1]!.toLowerCase(),spanId:m[2]!.toLowerCase(),traceFlags:parseInt(m[3]!,16)};
}
function reqString(v:unknown,n:string,max:number):string{if(typeof v!=='string'||!v.trim()||v.length>max)throw bad(`INVALID_${n.toUpperCase()}`);return v.trim();}
function optionalString(v:unknown,max:number):string|undefined{if(v===undefined||v===null||v==='')return undefined;if(typeof v!=='string'||v.length>max)throw bad('INVALID_STRING');return v;}
function enumValue<T extends string>(v:unknown,a:readonly T[],n:string):T{const x=String(v??'') as T;if(!a.includes(x))throw bad(`INVALID_${n.toUpperCase()}`);return x;}
function integerRange(v:unknown,min:number,max:number):number|undefined{if(v===undefined||v===null||v==='')return undefined;const n=Number(v);if(!Number.isInteger(n)||n<min||n>max)throw bad('INVALID_INTEGER');return n;}
function bad(code:string){return Object.assign(new Error(code),{statusCode:400});}
