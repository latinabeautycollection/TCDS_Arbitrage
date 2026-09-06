import { Router,type RequestHandler } from 'express';
import type { ObservabilityService } from '../services/observabilityService';
import type { ObservabilityPrincipal } from '../models/observabilityTypes';
import { parseObservation,parseQueryWindow,requireUuid,validateTraceId } from '../validators/observabilityValidators';
export interface ObservabilityRouteAuth{read:RequestHandler;ingest:RequestHandler;admin:RequestHandler;}
function principal(res:any):ObservabilityPrincipal{const p=res.locals.observabilityPrincipal as ObservabilityPrincipal|undefined;if(!p)throw Object.assign(new Error('OBSERVABILITY_AUTHENTICATION_REQUIRED'),{statusCode:401});return p;}
export function createObservabilityRoutes(input:{auth:ObservabilityRouteAuth;service:ObservabilityService}):Router{
  const r=Router();
  r.post('/governance/observability/observations',input.auth.ingest,async(req,res,next)=>{try{
    const h:Record<string,unknown>={'x-correlation-id':req.observabilityContext?.correlationId??req.headers['x-correlation-id'],'x-request-id':req.observabilityContext?.requestId??req.headers['x-request-id'],traceparent:req.headers.traceparent};
    const x=parseObservation(req.body,h);x.traceId=req.observabilityContext?.traceId??x.traceId;x.spanId=req.observabilityContext?.spanId??x.spanId;x.traceFlags=req.observabilityContext?.traceFlags??x.traceFlags;
    const out=await input.service.ingestUser(principal(res),x);res.setHeader('x-correlation-id',x.correlationId);res.setHeader('x-request-id',x.requestId);res.status(201).json(out);
  }catch(e){next(e);}});
  r.get('/governance/observability/correlations/:correlationId',input.auth.read,async(req,res,next)=>{try{res.json({items:await input.service.byCorrelation(requireUuid(req.params.correlationId,'correlation_id'),parseQueryWindow(req.query as Record<string,unknown>))});}catch(e){next(e);}});
  r.get('/governance/observability/traces/:traceId',input.auth.read,async(req,res,next)=>{try{const id=validateTraceId(req.params.traceId);if(!id)throw Object.assign(new Error('INVALID_TRACE_ID'),{statusCode:400});res.json({items:await input.service.byTrace(id,parseQueryWindow(req.query as Record<string,unknown>))});}catch(e){next(e);}});
  r.get('/governance/observability/reference',input.auth.read,async(req,res,next)=>{try{const ref=String(req.query.reference??'').trim();if(!ref||ref.length>1024)throw Object.assign(new Error('INVALID_REFERENCE'),{statusCode:400});res.json({items:await input.service.byReference(ref,parseQueryWindow(req.query as Record<string,unknown>))});}catch(e){next(e);}});
  return r;
}
