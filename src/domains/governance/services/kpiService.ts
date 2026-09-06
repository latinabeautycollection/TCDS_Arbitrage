import {randomUUID} from 'node:crypto';
import type {CalculateMetricRequest,KpiPrincipal} from '../models/kpiTypes';
import {KpiRepository} from '../repositories/kpiRepository';
import type {KpiLogger,KpiMetrics} from '../observability/kpiObservability';

export class KpiService {
  constructor(private readonly repo:KpiRepository,private readonly logger:KpiLogger,private readonly metrics:KpiMetrics){}
  private need(p:KpiPrincipal,permission:string):void{
    if(!p.permissions.includes(permission)&&!p.permissions.includes('governance.kpi.admin'))
      throw Object.assign(new Error('KPI_PERMISSION_DENIED'),{statusCode:403});
  }

  async calculateUser(p:KpiPrincipal,req:CalculateMetricRequest,correlationId:string=randomUUID(),requestId:string=randomUUID()){
    this.need(p,'governance.kpi.calculate');const started=Date.now();
    const componentId=await this.repo.componentId('DOMAIN11H_KPI_ENGINE');
    const snapshotId=await this.repo.publishUser({req,componentId,authSessionId:p.authSessionId,requestId,correlationId});
    const snapshot=await this.repo.getSnapshot(snapshotId);
    this.metrics.calculated(req.metricCode,String(snapshot?.metric_state??'UNKNOWN'));
    this.metrics.duration((Date.now()-started)/1000,req.metricCode);
    this.logger.info('11H V3 KPI published by authenticated user',{snapshotId,metricCode:req.metricCode,correlationId,requestId});
    return snapshot;
  }

  async calculateService(req:CalculateMetricRequest,correlationId:string=randomUUID(),requestId:string=randomUUID()){
    const started=Date.now();const componentId=await this.repo.componentId('DOMAIN11H_KPI_WORKER');
    const snapshotId=await this.repo.publishService({req,componentId,requestId,correlationId});
    const snapshot=await this.repo.getSnapshot(snapshotId);
    this.metrics.calculated(req.metricCode,String(snapshot?.metric_state??'UNKNOWN'));
    this.metrics.duration((Date.now()-started)/1000,req.metricCode);
    this.logger.info('11H V3 KPI published by service worker',{snapshotId,metricCode:req.metricCode,correlationId,requestId});
    return snapshot;
  }

  async finalizeUser(p:KpiPrincipal,snapshotId:string,reason:string,correlationId:string=randomUUID(),requestId:string=randomUUID()){
    this.need(p,'governance.kpi.admin');const componentId=await this.repo.componentId('DOMAIN11H_KPI_ENGINE');
    const finalId=await this.repo.finalizeUser({snapshotId,componentId,authSessionId:p.authSessionId,requestId,correlationId,reason});
    return this.repo.getSnapshot(finalId);
  }

  async verify(p:KpiPrincipal,id:string){this.need(p,'governance.kpi.read');return this.repo.verify(id);}
  async get(p:KpiPrincipal,id:string){this.need(p,'governance.kpi.read');return this.repo.getSnapshot(id);}
  async recent(p:KpiPrincipal,code:string,limit:number){this.need(p,'governance.kpi.read');return this.repo.recent(code,limit);}
}
