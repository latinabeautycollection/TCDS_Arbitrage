import type { NextFunction,Request,RequestHandler,Response } from 'express';
import type { CapitalSafetyPrincipal } from '../models/capitalSafetyTypes';
type ExistingAccessPrincipal={userId:string;authSessionId:string;permissions:readonly string[]};
type R=Request&{accessPrincipal?:ExistingAccessPrincipal};

export function requireCapitalSafetyPermission(permission:string):RequestHandler{
  return(req:Request,res:Response,next:NextFunction):void=>{
    const a=(req as R).accessPrincipal;
    if(!a){res.status(401).json({error:'CAPITAL_SAFETY_AUTHENTICATION_REQUIRED'});return;}
    if(!a.permissions.includes(permission)&&!a.permissions.includes('governance.capital-safety.admin')){
      res.status(403).json({error:'CAPITAL_SAFETY_PERMISSION_DENIED',requiredPermission:permission});return;
    }
    const p:CapitalSafetyPrincipal={reference:a.userId,authSessionId:a.authSessionId,permissions:[...a.permissions]};
    res.locals.capitalSafetyPrincipal=p;next();
  };
}
