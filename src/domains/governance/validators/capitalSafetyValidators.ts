import crypto from 'node:crypto';
import type { CapitalSafetyRequest } from '../models/capitalSafetyTypes';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function parseCapitalSafetyRequest(body:unknown,correlationHeader:unknown):CapitalSafetyRequest{
  const b=(body??{}) as Record<string,unknown>;
  const runId=Number(b.capitalAllocationRunId);
  if(!Number.isSafeInteger(runId)||runId<=0)throw bad('capitalAllocationRunId');
  const sourceRecordId=reqString(b.sourceRecordId,'sourceRecordId',200);
  const idempotencyKey=reqString(b.idempotencyKey,'idempotencyKey',240);
  let correlationId=typeof correlationHeader==='string'?correlationHeader:String(b.correlationId??'');
  if(!correlationId)correlationId=crypto.randomUUID();
  if(!UUID.test(correlationId))throw bad('correlationId');
  return {capitalAllocationRunId:runId,sourceRecordId,idempotencyKey,correlationId};
}
export function requireExternalDecisionId(v:unknown):string{return reqString(v,'externalDecisionId',300);}
export function parseLimit(v:unknown):number{const n=Number(v??50);return Number.isInteger(n)&&n>0&&n<=500?n:50;}
function reqString(v:unknown,name:string,max:number):string{if(typeof v!=='string'||!v.trim()||v.length>max)throw bad(name);return v.trim();}
function bad(field:string){return Object.assign(new Error(`INVALID_${field.toUpperCase()}`),{statusCode:400});}
