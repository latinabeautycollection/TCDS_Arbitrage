import { Router,type RequestHandler,type Request,type Response,type NextFunction } from 'express';
import type { CapitalSafetyService } from '../services/capitalSafetyService';
import type { CapitalSafetyPrincipal } from '../models/capitalSafetyTypes';
import { parseCapitalSafetyRequest,parseLimit,requireExternalDecisionId } from '../validators/capitalSafetyValidators';

export interface CapitalSafetyRouteAuth{read:RequestHandler;assess:RequestHandler;admin:RequestHandler;}
function principal(res:any):CapitalSafetyPrincipal{
  const p=res.locals.capitalSafetyPrincipal as CapitalSafetyPrincipal|undefined;
  if(!p)throw Object.assign(new Error('CAPITAL_SAFETY_AUTHENTICATION_REQUIRED'),{statusCode:401});
  return p;
}
export function createCapitalSafetyRoutes(input:{auth:CapitalSafetyRouteAuth;service:CapitalSafetyService}):Router{
  const r=Router();
  r.post('/governance/capital-safety/assess',input.auth.assess,async(req:Request,res:Response,next:NextFunction)=>{
    try{const x=parseCapitalSafetyRequest(req.body,req.headers['x-correlation-id']);const result=await input.service.assess(principal(res),x);res.status(200).json(result);}catch(e){next(e);}
  });
  r.get('/governance/capital-safety/revalidate/:externalDecisionId',input.auth.read,async(req:Request,res:Response,next:NextFunction)=>{
    try{res.json(await input.service.revalidate(principal(res),requireExternalDecisionId(req.params.externalDecisionId)));}catch(e){next(e);}
  });
  r.get('/governance/capital-safety/current/:externalDecisionId',input.auth.read,async(req:Request,res:Response,next:NextFunction)=>{
    try{const x=await input.service.current(principal(res),requireExternalDecisionId(req.params.externalDecisionId));if(!x){res.status(404).json({error:'CAPITAL_SAFETY_NOT_FOUND'});return;}res.json(x);}catch(e){next(e);}
  });
  r.get('/governance/capital-safety/recent',input.auth.read,async(req:Request,res:Response,next:NextFunction)=>{
    try{res.json({items:await input.service.recent(principal(res),parseLimit(req.query.limit))});}catch(e){next(e);}
  });
  return r;
}
