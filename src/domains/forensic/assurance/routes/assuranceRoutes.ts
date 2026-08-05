import{Router,type NextFunction,type Request,type Response}from'express';import{z}from'zod';
import type{AssurancePrincipal}from'../models/assuranceTypes';import{AssuranceError}from'../errors/AssuranceError';
import{AssuranceService}from'../services/assuranceService';interface R extends Request{assurancePrincipal?:AssurancePrincipal;correlationId?:string}
const uuid=z.string().uuid(),key=z.string().min(8).max(250);
const subject=z.enum(['GLOBAL','FORENSIC_CHAIN','FACILITY','CLAIM_CASE','DISPUTE_CASE','LEGAL_HOLD','CASE_DOSSIER','RETAIL_PLATFORM','WORKER']);
const evaluate=z.object({controlCode:z.string().min(3),subjectType:subject,subjectReference:z.string().min(1),
evaluationWindowStart:z.string().datetime(),evaluationWindowEnd:z.string().datetime(),idempotencyKey:key});
export function createAssuranceRouter(s:AssuranceService){const r=Router();
r.post('/assurance/evaluations',wrap(async(q,x)=>{const d=await s.evaluate(p(q),evaluate.parse(q.body),q.correlationId);x.status(d.result==='PASS'?201:409).json({ok:d.result==='PASS',data:d})}));
r.get('/assurance/dashboard',wrap(async(q,x)=>x.json({ok:true,data:await s.dashboard(p(q))})));
r.get('/assurance/findings',wrap(async(q,x)=>{const f=z.object({status:z.string().optional(),severity:z.string().optional(),
controlCode:z.string().optional(),ownerUserId:uuid.optional(),overdue:z.coerce.boolean().optional(),facilityId:uuid.optional(),
limit:z.coerce.number().int().min(1).max(200).default(50),offset:z.coerce.number().int().min(0).default(0)}).parse(q.query);
x.json({ok:true,data:await s.list(p(q),f)})}));
r.post('/assurance/findings/:id/assignments',wrap(async(q,x)=>{const b=z.object({assigneeUserId:uuid,reason:z.string().min(10),idempotencyKey:key}).parse(q.body);x.status(201).json({ok:true,data:await s.assign(p(q),param(q,'id'),b.assigneeUserId,b.reason,b.idempotencyKey,q.correlationId)})}));
r.post('/assurance/findings/:id/containment-actions',wrap(async(q,x)=>{const b=z.object({actionCode:z.string().min(2),description:z.string().min(10),result:z.enum(['APPLIED','FAILED','PARTIAL']),evidence:z.record(z.string(),z.unknown()),idempotencyKey:key}).parse(q.body);x.status(201).json({ok:true,data:await s.contain(p(q),param(q,'id'),b,b.idempotencyKey,q.correlationId)})}));
r.post('/assurance/findings/:id/validations',wrap(async(q,x)=>{const b=z.object({evaluationRunId:uuid,idempotencyKey:key}).parse(q.body);x.status(201).json({ok:true,data:await s.validate(p(q),param(q,'id'),b.evaluationRunId,b.idempotencyKey,q.correlationId)})}));
r.use((e:unknown,_q:Request,x:Response,n:NextFunction)=>{if(e instanceof AssuranceError){x.status(e.status).json({ok:false,error:e.code,message:e.message});return}if(e instanceof z.ZodError){x.status(400).json({ok:false,error:'VALIDATION_ERROR',issues:e.issues});return}n(e)});return r}
function p(q:R){if(!q.assurancePrincipal)throw new AssuranceError('UNAUTHENTICATED','Authentication required',401);return q.assurancePrincipal}
function param(q:R,n:string):string{const raw=q.params[n];const v=Array.isArray(raw)?raw[0]:raw;if(!v)throw new AssuranceError('INVALID_PATH','Missing path parameter',400);return v}
function wrap(f:(q:R,x:Response,n:NextFunction)=>Promise<unknown>){return(q:R,x:Response,n:NextFunction):void=>{void f(q,x,n).catch(n)}}
