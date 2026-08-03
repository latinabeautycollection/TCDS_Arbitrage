import { Router,type NextFunction,type Request,type Response } from 'express';
import { z } from 'zod';
import type { ReturnPrincipal } from '../models/returnEvidenceTypes';
import { ReturnForensicError } from '../errors/ReturnForensicError';
import { ReturnAdjudicationService } from '../services/returnAdjudicationService';
interface R extends Request{returnPrincipal?:ReturnPrincipal;correlationId?:string}
const uuid=z.string().uuid(),key=z.string().min(8).max(250);
const assess=z.object({warehouseAssessmentId:uuid.optional()});
const decision=z.object({decisionType:z.enum(['FRAUD_ASSESSMENT','IDENTITY_CONFLICT','CONDITION_DELTA',
 'WEIGHT_DELTA','COMPONENT_DELTA','TAMPER_EVIDENCE','DISPOSITION']),
 decision:z.enum(['APPROVED','REJECTED','REMEDIATION_REQUIRED']),approvedOutcome:z.enum([
 'RESTOCK','QUARANTINE','CLAIM','REPAIR','DISPOSE','RETURN_TO_CUSTOMER','REVIEW_REQUIRED']).optional(),
 warehouseOverrideId:uuid.optional(),reason:z.string().min(10).max(2000),
 supersedesDecisionId:uuid.optional(),idempotencyKey:key});
const execution=z.object({recommendationId:uuid,gateId:uuid,warehouseDispositionId:uuid,
 warehouseOverrideId:uuid.optional(),idempotencyKey:key});
export function createReturnAdjudicationRouter(s:ReturnAdjudicationService){const r=Router();
 r.post('/adjudication/:id/assess',wrap(async(q,x)=>{const b=assess.parse(q.body);x.json({ok:true,data:await s.assess(p(q),param(q,'id'),b.warehouseAssessmentId,q.correlationId)})}));
 r.post('/adjudication/:id/decisions',wrap(async(q,x)=>{const data=await s.decide(p(q),{linkId:param(q,'id'),...decision.parse(q.body)},q.correlationId);x.status(201).json({ok:true,data})}));
 r.post('/adjudication/:id/evaluate',wrap(async(q,x)=>{const b=z.object({idempotencyKey:key}).parse(q.body);const data=await s.evaluate(p(q),param(q,'id'),b.idempotencyKey,q.correlationId);x.status(data.result==='APPROVED'?200:409).json({ok:data.result==='APPROVED',data})}));
 r.post('/adjudication/:id/disposition-executions',wrap(async(q,x)=>{const data=await s.linkExecution(p(q),{linkId:param(q,'id'),...execution.parse(q.body)},q.correlationId);x.status(201).json({ok:true,data})}));
 r.use((e:unknown,_q:Request,x:Response,n:NextFunction)=>{if(e instanceof ReturnForensicError){x.status(e.status).json({ok:false,error:e.code,message:e.message});return}if(e instanceof z.ZodError){x.status(400).json({ok:false,error:'VALIDATION_ERROR',issues:e.issues});return}n(e)});return r}
function p(q:R):ReturnPrincipal{if(!q.returnPrincipal)throw new ReturnForensicError('UNAUTHENTICATED','Authentication required',401);return q.returnPrincipal}
function param(q:R,n:string):string{const raw=q.params[n];const v=Array.isArray(raw)?raw[0]:raw;if(!v)throw new ReturnForensicError('INVALID_PATH','Missing path parameter',400);return v}
function wrap(f:(q:R,x:Response,n:NextFunction)=>Promise<void>){return(q:R,x:Response,n:NextFunction):void=>{void f(q,x,n).catch(n)}}
