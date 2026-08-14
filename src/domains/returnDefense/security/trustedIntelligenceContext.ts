
import type { Request } from "express";
export interface TrustedIntelligenceRequest extends Request {
  auth?: {tenantId:string;actorId:string;roles:string[]};
  correlationId?: string;
}
export function requireIntelligenceContext(req:TrustedIntelligenceRequest,roles:string[]) {
  if(!req.auth||!req.correlationId) throw Object.assign(new Error("Authentication required"),{statusCode:401});
  if(!roles.some(role=>req.auth!.roles.includes(role))) {
    throw Object.assign(new Error("Insufficient role"),{statusCode:403});
  }
  return {tenantId:req.auth.tenantId,actorId:req.auth.actorId,correlationId:req.correlationId};
}
