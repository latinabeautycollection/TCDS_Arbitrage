import{Router}from'express';import{z}from'zod';import{ACCESS_SCOPES,ACCESS_SUBJECT_TYPES}from'../models/accessTypes';
import{resolveCorrelationId}from'./correlationId';import type{BreakGlassService}from'../services/breakGlassService';
const scope=z.enum(ACCESS_SCOPES),subject=z.enum(ACCESS_SUBJECT_TYPES);
export function createAccessRoutes(service:BreakGlassService){const r=Router();
 r.post('/break-glass',async(req,res,next)=>{try{const i=z.object({subjectType:subject,subjectReference:z.string().min(1).max(512),
  reason:z.string().min(30).max(4000),scopes:z.array(scope).min(1).max(6),expiresAt:z.iso.datetime(),idempotencyKey:z.uuid()}).strict().parse(req.body);
  res.status(201).json(await service.request(req.accessPrincipal!,i,resolveCorrelationId(req.headers['x-correlation-id'])))}catch(e){next(e)}});
 r.post('/break-glass/:id/decision',async(req,res,next)=>{try{const i=z.object({decision:z.enum(['APPROVE','REJECT']),
  reason:z.string().min(10).max(2000)}).strict().parse(req.body);res.json(await service.decide(req.accessPrincipal!,req.params.id!,i.decision,i.reason,
  resolveCorrelationId(req.headers['x-correlation-id'])))}catch(e){next(e)}});
 r.post('/break-glass/:id/close',async(req,res,next)=>{try{const i=z.object({mode:z.enum(['CLOSE','REVOKE']),
  reason:z.string().min(10).max(2000)}).strict().parse(req.body);await service.close(req.accessPrincipal!,req.params.id!,i.mode,i.reason,
  resolveCorrelationId(req.headers['x-correlation-id']));res.status(204).end()}catch(e){next(e)}});
 return r}
