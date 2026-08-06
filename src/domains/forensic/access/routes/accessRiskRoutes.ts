import{Router}from'express';import{z}from'zod';import{ACCESS_SCOPES}from'../models/accessTypes';import{resolveCorrelationId}from'./correlationId';
import type{AccessRiskService}from'../services/accessRiskService';const scope=z.enum(ACCESS_SCOPES),cid=(r:any)=>resolveCorrelationId(r.headers['x-correlation-id']);
export function createAccessRiskRoutes(s:AccessRiskService){const r=Router();
 r.post('/risk/profiles',async(req,res,next)=>{try{const i=z.object({userId:z.uuid(),date:z.iso.date(),policyCode:z.string().min(1).max(80),idempotencyKey:z.uuid()}).strict().parse(req.body);
  res.status(201).json(await s.profile(req.accessPrincipal!,i,cid(req)))}catch(e){next(e)}});
 r.post('/certifications',async(req,res,next)=>{try{const i=z.object({campaignCode:z.string().min(3).max(80),title:z.string().min(3).max(200),
  periodStart:z.iso.date(),periodEnd:z.iso.date(),dueAt:z.iso.datetime(),scope:z.record(z.string(),z.unknown()),
  policyCode:z.string().min(1).max(80),idempotencyKey:z.uuid()}).strict().parse(req.body);res.status(201).json(await s.open(req.accessPrincipal!,i,cid(req)))}catch(e){next(e)}});
 r.get('/certifications',async(req,res,next)=>{try{res.json(await s.campaigns(req.accessPrincipal!,typeof req.query.status==='string'?req.query.status:undefined))}catch(e){next(e)}});
 r.get('/certifications/:id',async(req,res,next)=>{try{res.json(await s.campaign(req.accessPrincipal!,req.params.id!))}catch(e){next(e)}});
 r.get('/certifications/:id/items',async(req,res,next)=>{try{res.json(await s.items(req.accessPrincipal!,req.params.id!))}catch(e){next(e)}});
 const ds=z.discriminatedUnion('decision',[z.object({decision:z.literal('RETAIN'),reason:z.string().min(10),modifiedScopes:z.array(scope).max(0)}),
 z.object({decision:z.literal('REVOKE'),reason:z.string().min(10),modifiedScopes:z.array(scope).max(0)}),
 z.object({decision:z.literal('MODIFY'),reason:z.string().min(10),modifiedScopes:z.array(scope).min(1).max(6)})]);
 r.post('/certification-items/:id/decision',async(req,res,next)=>{try{const i=ds.parse(req.body);res.json(await s.decide(req.accessPrincipal!,req.params.id!,i.decision,i.reason,i.modifiedScopes,cid(req)))}catch(e){next(e)}});
 r.post('/certifications/:id/close',async(req,res,next)=>{try{res.json(await s.close(req.accessPrincipal!,req.params.id!,cid(req)))}catch(e){next(e)}});
 r.get('/risk/findings',async(req,res,next)=>{try{res.json(await s.findings(req.accessPrincipal!,typeof req.query.status==='string'?req.query.status:undefined))}catch(e){next(e)}});
 r.post('/risk/findings/:id/transition',async(req,res,next)=>{try{const i=z.object({state:z.enum(['ACKNOWLEDGED','INVESTIGATING','CONTAINED','RESOLVED','FALSE_POSITIVE']),
 reason:z.string().min(10),ownerUserId:z.uuid().optional()}).strict().parse(req.body);res.json(await s.transition(req.accessPrincipal!,req.params.id!,i.state,i.reason,i.ownerUserId,cid(req)))}catch(e){next(e)}});
 return r}
