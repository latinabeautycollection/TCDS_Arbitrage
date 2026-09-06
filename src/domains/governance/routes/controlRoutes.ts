import{Router,type RequestHandler}from'express';
import type{ControlService}from'../services/controlService';import type{ControlPrincipal}from'../models/controlTypes';
import{uuid,evaluateBody,recoveryBody,approvalBody,finalizeBody,nonEmpty}from'../validators/controlValidators';

export function createControlRoutes(x:{service:ControlService;read:RequestHandler;evaluate:RequestHandler;recovery:RequestHandler;approve:RequestHandler;admin:RequestHandler}){
 const r=Router();const p=(res:any)=>res.locals.controlPrincipal as ControlPrincipal;
 r.get('/governance/control/effective',x.read,async(_q,s,n)=>{try{s.json({items:await x.service.effective(p(s))})}catch(e){n(e)}});
 r.get('/governance/control/decisions/:id',x.read,async(q,s,n)=>{try{const z=await x.service.decision(p(s),uuid(q.params.id));if(!z){s.status(404).json({error:'CONTROL_DECISION_NOT_FOUND'});return}s.json(z)}catch(e){n(e)}});
 r.post('/governance/control/evaluate',x.evaluate,async(q,s,n)=>{try{s.status(201).json(await x.service.evaluate(p(s),evaluateBody(q.body)))}catch(e){n(e)}});
 r.post('/governance/control/recovery',x.recovery,async(q,s,n)=>{try{s.status(201).json(await x.service.requestRecovery(p(s),recoveryBody(q.body)))}catch(e){n(e)}});
 r.post('/governance/control/recovery/:id/approve',x.approve,async(q,s,n)=>{try{s.status(201).json(await x.service.approveRecovery(p(s),approvalBody(q.params.id,q.body)))}catch(e){n(e)}});
 r.post('/governance/control/recovery/:id/finalize',x.recovery,async(q,s,n)=>{try{s.status(201).json(await x.service.finalizeRecovery(p(s),finalizeBody(q.params.id,q.body)))}catch(e){n(e)}});
 r.post('/governance/control/admin/sync-policy',x.admin,async(q,s,n)=>{try{s.status(201).json(await x.service.syncPolicy(p(s),{requestId:uuid(q.body?.requestId),correlationId:uuid(q.body?.correlationId),idempotencyKey:nonEmpty(q.body?.idempotencyKey,'IDEMPOTENCY_KEY',300)}))}catch(e){n(e)}});
 return r;
}