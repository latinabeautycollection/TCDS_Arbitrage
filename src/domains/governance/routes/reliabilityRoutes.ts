import{Router,type RequestHandler}from'express';
import type{ReliabilityService}from'../services/reliabilityService';import{uuid,parseEvaluateSlo,parseEvaluateDrift,parseBaseline}from'../validators/reliabilityValidators';
import type{ReliabilityPrincipal}from'../models/reliabilityTypes';
export function createReliabilityRoutes(x:{service:ReliabilityService;read:RequestHandler;evaluate:RequestHandler;admin:RequestHandler}){const r=Router();const p=(res:any)=>res.locals.reliabilityPrincipal as ReliabilityPrincipal;
r.post('/governance/reliability/slos/:id/evaluate',x.evaluate,async(q,s,n)=>{try{const b=parseEvaluateSlo(q.body);s.status(201).json(await x.service.evaluateSlo(p(s),{sloDefinitionId:uuid(q.params.id),...b}))}catch(e){n(e)}});
r.post('/governance/reliability/drift/:id/evaluate',x.evaluate,async(q,s,n)=>{try{const b=parseEvaluateDrift(q.body);s.status(201).json(await x.service.evaluateDrift(p(s),{baselineId:uuid(q.params.id),...b}))}catch(e){n(e)}});
r.post('/governance/reliability/drift/baselines',x.admin,async(q,s,n)=>{try{s.status(201).json(await x.service.createBaseline(p(s),parseBaseline(q.body)))}catch(e){n(e)}});
r.get('/governance/reliability/current',x.read,async(_q,s,n)=>{try{s.json({items:await x.service.current(p(s))})}catch(e){n(e)}});
r.get('/governance/reliability/drift/evaluations/:id',x.read,async(q,s,n)=>{try{const z=await x.service.drift(p(s),uuid(q.params.id));if(!z){s.status(404).json({error:'DRIFT_NOT_FOUND'});return}s.json(z)}catch(e){n(e)}});
return r}