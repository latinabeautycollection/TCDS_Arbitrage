import{Router,type NextFunction,type Request,type Response}from'express';import{z}from'zod';
import type{AssurancePrincipal}from'../models/assuranceTypes';import{AssuranceError}from'../errors/AssuranceError';
import{CertificationService}from'../services/certificationService';interface R extends Request{assurancePrincipal?:AssurancePrincipal;correlationId?:string}
const uuid=z.string().uuid(),key=z.string().min(8).max(250);
const open=z.object({campaignCode:z.string().min(3).max(100),campaignType:z.enum([
'MONTHLY_CONTROL','QUARTERLY_EXECUTIVE','ANNUAL_ENTERPRISE','REGULATORY','INCIDENT_POSTMORTEM','PRE_RELEASE']),
title:z.string().min(3),periodStart:z.string().date(),periodEnd:z.string().date(),dueAt:z.string().datetime(),
scopeJson:z.record(z.string(),z.unknown()),idempotencyKey:key});
export function createCertificationRouter(s:CertificationService){const r=Router();
r.post('/assurance/campaigns',wrap(async(q,x)=>x.status(201).json({ok:true,data:await s.open(p(q),open.parse(q.body),q.correlationId)})));
r.get('/assurance/campaigns/:id',wrap(async(q,x)=>x.json({ok:true,data:await s.get(p(q),param(q,'id'))})));
r.post('/assurance/signing-requests/:id/execute',wrap(async(q,x)=>{const b=z.object({idempotencyKey:key}).parse(q.body);x.status(201).json({ok:true,data:await s.sign(p(q),param(q,'id'),b.idempotencyKey,q.correlationId)})}));
r.post('/assurance/campaigns/:id/close',wrap(async(q,x)=>{const b=z.object({idempotencyKey:key}).parse(q.body);x.json({ok:true,data:await s.close(p(q),param(q,'id'),b.idempotencyKey,q.correlationId)})}));
r.post('/assurance/certificates/:id/revoke',wrap(async(q,x)=>{const b=z.object({reason:z.string().min(20),idempotencyKey:key}).parse(q.body);x.json({ok:true,data:await s.revokeCertificate(p(q),param(q,'id'),b.reason,b.idempotencyKey,q.correlationId)})}));
r.get('/assurance/findings/:id/remediation-plans',wrap(async(q,x)=>x.json({ok:true,data:await s.plans(p(q),param(q,'id'))})));
r.get('/assurance/findings/:id/risk-acceptances',wrap(async(q,x)=>x.json({ok:true,data:await s.riskAcceptances(p(q),param(q,'id'))})));
r.use((e:unknown,_q:Request,x:Response,n:NextFunction)=>{if(e instanceof AssuranceError){x.status(e.status).json({ok:false,error:e.code,message:e.message});return}if(e instanceof z.ZodError){x.status(400).json({ok:false,error:'VALIDATION_ERROR',issues:e.issues});return}n(e)});return r}
function p(q:R){if(!q.assurancePrincipal)throw new AssuranceError('UNAUTHENTICATED','Authentication required',401);return q.assurancePrincipal}
function param(q:R,n:string):string{const raw=q.params[n];const v=Array.isArray(raw)?raw[0]:raw;if(!v)throw new AssuranceError('INVALID_PATH','Missing path parameter',400);return v}
function wrap(f:(q:R,x:Response,n:NextFunction)=>Promise<unknown>){return(q:R,x:Response,n:NextFunction):void=>{void f(q,x,n).catch(n)}}
