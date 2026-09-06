import type { NextFunction,Request,RequestHandler,Response } from 'express';
import type { KpiPrincipal } from '../models/kpiTypes';
type Existing={userId:string;authSessionId:string;permissions:readonly string[]};
type R=Request&{accessPrincipal?:Existing};
export function requireKpiPermission(permission:string):RequestHandler{
 return(req:Request,res:Response,next:NextFunction):void=>{
  const a=(req as R).accessPrincipal;
  if(!a){res.status(401).json({error:'KPI_AUTHENTICATION_REQUIRED'});return;}
  if(!a.permissions.includes(permission)&&!a.permissions.includes('governance.kpi.admin')){
   res.status(403).json({error:'KPI_PERMISSION_DENIED',requiredPermission:permission});return;
  }
  const p:KpiPrincipal={reference:a.userId,authSessionId:a.authSessionId,permissions:[...a.permissions]};
  res.locals.kpiPrincipal=p;next();
 };
}
