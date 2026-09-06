import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AccountabilityPrincipal } from '../models/accountabilityTypes';
type ExistingAccessPrincipal={userId:string;authSessionId:string;permissions:readonly string[]};
type R=Request&{accessPrincipal?:ExistingAccessPrincipal};
export function requireAccountabilityPermission(permission:string):RequestHandler{return(req:Request,res:Response,next:NextFunction):void=>{const a=(req as R).accessPrincipal;if(!a){res.status(401).json({error:'GOVERNANCE_AUTHENTICATION_REQUIRED'});return;}if(!a.permissions.includes(permission)&&!a.permissions.includes('governance.lineage.admin')){res.status(403).json({error:'GOVERNANCE_PERMISSION_DENIED',requiredPermission:permission});return;}const p:AccountabilityPrincipal={reference:a.userId,authSessionId:a.authSessionId,permissions:a.permissions};res.locals.accountabilityPrincipal=p;next();};}
