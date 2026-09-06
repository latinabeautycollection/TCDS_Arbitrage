import type {KpiService} from '../services/kpiService';

export class KpiMaterializationWorker {
  constructor(private readonly service:KpiService){}
  async materializeDaily(metricCodes:string[],day:Date):Promise<void>{
    const from=new Date(Date.UTC(day.getUTCFullYear(),day.getUTCMonth(),day.getUTCDate()));
    const to=new Date(from.getTime()+86400000);
    const revision=new Date().toISOString().slice(0,13);
    for(const metricCode of metricCodes){
      await this.service.calculateService({metricCode,window:{from,to},dimensions:{},
        idempotencyKey:`11h-v3-daily:${metricCode}:${from.toISOString()}:rev:${revision}`,
        restatementReason:'SCHEDULED_AUTHORITATIVE_SOURCE_RECHECK'});
    }
  }
}
