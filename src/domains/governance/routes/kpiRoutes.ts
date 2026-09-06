import {Router,type RequestHandler} from 'express';
import type {KpiService} from '../services/kpiService';
import type {KpiPrincipal} from '../models/kpiTypes';
import {parseCalculateMetric,parseLimit,requireUuid,resolveHeaderUuid} from '../validators/kpiValidators';
export interface KpiRouteAuth{read:RequestHandler;calculate:RequestHandler;admin:RequestHandler;}
function principal(res:any):KpiPrincipal{const p=res.locals.kpiPrincipal as KpiPrincipal|undefined;if(!p)throw Object.assign(new Error('KPI_AUTHENTICATION_REQUIRED'),{statusCode:401});return p;}
export function createKpiRoutes(input:{auth:KpiRouteAuth;service:KpiService}):Router{
 const r=Router();
 r.post('/governance/kpis/calculate',input.auth.calculate,async(req,res,next)=>{try{
   res.status(201).json(await input.service.calculateUser(principal(res),parseCalculateMetric(req.body),
    resolveHeaderUuid(req.headers['x-correlation-id']),resolveHeaderUuid(req.headers['x-request-id'])));
 }catch(e){next(e);}});
 r.post('/governance/kpis/snapshots/:snapshotId/finalize',input.auth.admin,async(req,res,next)=>{try{
   const reason=String(req.body?.reason??'').trim();if(!reason)throw Object.assign(new Error('FINALIZATION_REASON_REQUIRED'),{statusCode:400});
   res.status(201).json(await input.service.finalizeUser(principal(res),requireUuid(req.params.snapshotId),reason,
    resolveHeaderUuid(req.headers['x-correlation-id']),resolveHeaderUuid(req.headers['x-request-id'])));
 }catch(e){next(e);}});
 r.get('/governance/kpis/snapshots/:snapshotId/verify',input.auth.read,async(req,res,next)=>{try{
   res.json(await input.service.verify(principal(res),requireUuid(req.params.snapshotId)));
 }catch(e){next(e);}});
 r.get('/governance/kpis/snapshots/:snapshotId',input.auth.read,async(req,res,next)=>{try{
   const x=await input.service.get(principal(res),requireUuid(req.params.snapshotId));if(!x){res.status(404).json({error:'KPI_SNAPSHOT_NOT_FOUND'});return;}res.json(x);
 }catch(e){next(e);}});
 r.get('/governance/kpis/:metricCode/recent',input.auth.read,async(req,res,next)=>{try{
   res.json({items:await input.service.recent(principal(res),String(req.params.metricCode),parseLimit(req.query.limit))});
 }catch(e){next(e);}});
 return r;
}
