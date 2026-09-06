import type { RequestHandler } from 'express';
import type { TrustedActor } from '../models/executiveGovernanceTypes';
import { ExecutiveGovernanceError } from '../models/executiveErrors';
export type ExecutiveRequest = Parameters<RequestHandler>[0] & { executiveActor?: TrustedActor };
export interface TrustedPrincipalResolver { resolve(req: Parameters<RequestHandler>[0]): Promise<TrustedActor|null>; }
export function requireExecutivePermission(resolver: TrustedPrincipalResolver, permission: string): RequestHandler {
 return async (req,res,next)=>{ try {
   const actor=await resolver.resolve(req); if(!actor) throw new ExecutiveGovernanceError('UNAUTHENTICATED','Authentication required',401);
   if(!actor.permissions.has(permission)) throw new ExecutiveGovernanceError('FORBIDDEN',`Missing permission ${permission}`,403);
   (req as ExecutiveRequest).executiveActor=actor; next();
 } catch(e){ next(e); } };
}
export function actorFromRequest(req: Parameters<RequestHandler>[0]): TrustedActor {
 const a=(req as ExecutiveRequest).executiveActor; if(!a) throw new ExecutiveGovernanceError('TRUSTED_ACTOR_MISSING','Trusted actor middleware required',500); return a;
}
