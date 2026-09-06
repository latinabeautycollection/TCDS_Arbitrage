import type { ObservationInput,QueryWindow,ObservabilityPrincipal } from '../models/observabilityTypes';
import { rejectSensitiveMetadata,sanitizeObservabilityMetadata } from '../engines/observabilityMetadataFirewall';
import { ObservabilityRepository } from '../repositories/observabilityRepository';
import { Domain11gMetrics } from '../observability/domain11gMetrics';
export interface ObservabilityLogger{debug(message:string,context?:Record<string,unknown>):void;info(message:string,context?:Record<string,unknown>):void;warn(message:string,context?:Record<string,unknown>):void;error(message:string,context?:Record<string,unknown>):void;}

export class ObservabilityService{
  constructor(private readonly repo:ObservabilityRepository,private readonly logger:ObservabilityLogger,private readonly metrics:Domain11gMetrics){}
  async ingestUser(principal:ObservabilityPrincipal,x:ObservationInput){return this.ingestInternal(x,()=>this.repo.recordUser(principal,x));}
  async ingestService(x:ObservationInput,producerCode:string){return this.ingestInternal(x,()=>this.repo.recordService(producerCode,x));}
  private async ingestInternal(x:ObservationInput,writer:()=>Promise<string>){
    const started=process.hrtime.bigint();
    try{
      rejectSensitiveMetadata(x.metadata);const id=await writer();
      if(!x.subjectComponentId)this.metrics.orphaned(x.subjectDomainCode);
      if(Date.now()-x.occurredAt.getTime()>300000)this.metrics.late(x.subjectDomainCode);
      this.metrics.recorded(x.subjectDomainCode,x.observationType,x.outcome,x.severity);
      this.metrics.observeIngest(Number(process.hrtime.bigint()-started)/1e9,'SUCCESS');
      this.logger.info('11G observation recorded',{observationId:id,correlationId:x.correlationId,requestId:x.requestId,traceId:x.traceId,operation:x.operationCode,outcome:x.outcome,metadata:sanitizeObservabilityMetadata(x.metadata)});
      return {observationId:id};
    }catch(error){this.metrics.observeIngest(Number(process.hrtime.bigint()-started)/1e9,'FAILURE');this.metrics.rejected(normalizeRejectionReason(error));throw error;}
  }
  async byCorrelation(id:string,w:QueryWindow){return this.query('correlation',()=>this.repo.queryCorrelation(id,w));}
  async byTrace(id:string,w:QueryWindow){return this.query('trace',()=>this.repo.queryTrace(id,w));}
  async byReference(ref:string,w:QueryWindow){return this.query('reference',()=>this.repo.queryReference(ref,w));}
  async refreshActiveCorrelations(windowMinutes=15){const n=await this.repo.activeCorrelationCount(windowMinutes);this.metrics.setActive(n);return n;}
  private async query<T>(type:string,fn:()=>Promise<T>):Promise<T>{const started=process.hrtime.bigint();try{const r=await fn();this.metrics.correlationQuery(type,'SUCCESS');this.metrics.observeQuery(Number(process.hrtime.bigint()-started)/1e9,type,'SUCCESS');return r;}catch(e){this.metrics.correlationQuery(type,'FAILURE');this.metrics.observeQuery(Number(process.hrtime.bigint()-started)/1e9,type,'FAILURE');throw e;}}
}
function normalizeRejectionReason(error:unknown):string{const m=error instanceof Error?error.message:'UNKNOWN';return /^[A-Z][A-Z0-9_]{2,80}$/.test(m)?m:'DATABASE_OR_INTERNAL_REJECTION';}
