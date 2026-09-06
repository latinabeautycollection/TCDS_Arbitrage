import type { NextFunction,Request,RequestHandler,Response } from 'express';
import type { ObservabilityPrincipal } from '../models/observabilityTypes';
type Existing={userId:string;authSessionId:string;permissions:readonly string[]};
type R=Request&{accessPrincipal?:Existing};

export function requireObservabilityPermission(permission:string):RequestHandler{
  return(req:Request,res:Response,next:NextFunction):void=>{
    const a=(req as R).accessPrincipal;
    if(!a){res.status(401).json({error:'OBSERVABILITY_AUTHENTICATION_REQUIRED'});return;}
    if(!a.permissions.includes(permission)&&!a.permissions.includes('governance.observability.admin')){
      res.status(403).json({error:'OBSERVABILITY_PERMISSION_DENIED',requiredPermission:permission});return;
    }
    const p:ObservabilityPrincipal={reference:a.userId,authSessionId:a.authSessionId,permissions:[...a.permissions]};
    res.locals.observabilityPrincipal=p;next();
  };
}
