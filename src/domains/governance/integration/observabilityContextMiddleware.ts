import type { NextFunction,Request,RequestHandler,Response } from 'express';
import { optionalUuid,parseTraceParent } from '../validators/observabilityValidators';
import { getActiveOpenTelemetryContext } from '../observability/openTelemetryBridge';
import type { ObservabilityContext } from '../models/observabilityTypes';
declare global {namespace Express {interface Request {observabilityContext?:ObservabilityContext;}}}
export const attachObservabilityContext:RequestHandler=(req:Request,_res:Response,next:NextFunction):void=>{
  try{
    const parsedTrace=parseTraceParent(req.header('traceparent'));const active=getActiveOpenTelemetryContext();
    req.observabilityContext={
      correlationId:optionalUuid(req.header('x-correlation-id'),'correlation_id'),
      requestId:optionalUuid(req.header('x-request-id'),'request_id'),
      causationId:optionalUuid(req.header('x-causation-id'),'causation_id'),
      traceId:parsedTrace?.traceId??active.traceId,spanId:parsedTrace?.spanId??active.spanId,
      traceFlags:parsedTrace?.traceFlags??active.traceFlags,traceState:req.header('tracestate')??active.traceState
    };next();
  }catch(e){next(e);}
};
