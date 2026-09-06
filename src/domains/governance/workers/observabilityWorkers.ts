import { deterministicUuid } from '../validators/observabilityValidators';
import type { ObservabilityRepository } from '../repositories/observabilityRepository';
import type { ObservabilityService,ObservabilityLogger } from '../services/observabilityService';
import type { Domain11gMetrics } from '../observability/domain11gMetrics';

export class DomainEventCorrelationWorker{
  constructor(private readonly repo:ObservabilityRepository,private readonly service:ObservabilityService,private readonly logger:ObservabilityLogger){}
  async tick(limit=250):Promise<number>{
    const producer='DOMAIN11G_EVENT_CORRELATOR';let n=0;
    for(const d of await this.repo.findUnobservedDomainEvents(limit)){
      const source=`domain-event:${d.domain_event_id}`;
      await this.service.ingestService({
        observationType:classifyDomainEvent(String(d.event_type)),subjectDomainCode:'DOMAIN_11',operationCode:String(d.event_type),
        outcome:'SUCCESS',severity:'INFO',correlationId:d.correlation_id??deterministicUuid(`11G|CORR|${source}`),
        requestId:deterministicUuid(`11G|REQ|${source}`),causationId:d.causation_id??undefined,eventId:d.domain_event_id,
        authoritativeReference:`arb.domain_events:${d.domain_event_id}`,authoritativeRecordSha256:d.payload_sha256,
        metadata:{aggregateType:String(d.aggregate_type),aggregateId:String(d.aggregate_id)},sourceEventId:String(d.domain_event_id),
        occurredAt:new Date(d.occurred_at),idempotencyKey:`11g-domain-event:${d.domain_event_id}`
      },producer);n++;
    }
    for(const m of await this.repo.findUnobservedMutationEvidence(limit)){
      const source=`mutation:${m.mutation_ledger_id}`;
      await this.service.ingestService({
        observationType:'MUTATION_REFERENCE',subjectDomainCode:String(m.source_domain_code),operationCode:`MUTATION.${String(m.mutation_kind)}`,
        outcome:'SUCCESS',severity:'INFO',correlationId:String(m.correlation_id),requestId:isUuid(m.request_id)?String(m.request_id):deterministicUuid(`11G|REQ|${source}`),
        authoritativeReference:`arb.mutation_ledger:${m.mutation_ledger_id}`,authoritativeRecordSha256:m.governance_record_sha256??undefined,
        metadata:{sourceSchema:String(m.source_schema),sourceTable:String(m.source_table),sourceEntityId:String(m.source_entity_id),mutationKind:String(m.mutation_kind)},
        sourceEventId:String(m.mutation_ledger_id),occurredAt:new Date(m.occurred_at),idempotencyKey:`11g-mutation:${m.mutation_ledger_id}`
      },producer);n++;
    }
    for(const a of await this.repo.findUnobservedAuditEvidence(limit)){
      const source=`audit:${a.audit_event_id}`;
      await this.service.ingestService({
        observationType:'AUDIT_REFERENCE',subjectDomainCode:String(a.target_domain_code??'DOMAIN_11'),operationCode:`AUDIT.${String(a.action??a.event_type)}`,
        outcome:mapAuditOutcome(a.outcome),severity:mapAuditSeverity(a.severity),correlationId:String(a.correlation_id),
        requestId:isUuid(a.request_id)?String(a.request_id):deterministicUuid(`11G|REQ|${source}`),
        authoritativeReference:`arb.audit_events:${a.audit_event_id}`,
        metadata:{eventType:String(a.event_type),targetReference:String(a.target_reference??''),result:String(a.outcome??'OBSERVED')},
        sourceEventId:String(a.audit_event_id),occurredAt:new Date(a.occurred_at),idempotencyKey:`11g-audit:${a.audit_event_id}`
      },producer);n++;
    }
    for(const o of await this.repo.findUnobservedOutboxEvents(limit)){
      const source=`outbox:${o.outbox_event_id}`;
      await this.service.ingestService({
        observationType:'OUTBOX_EVENT',subjectDomainCode:'DOMAIN_11',operationCode:'OUTBOX.'+String(o.status),
        outcome:mapOutboxOutcome(o.status),severity:String(o.status).toUpperCase()==='DEAD_LETTER'?'ERROR':'INFO',
        correlationId:o.correlation_id??deterministicUuid(`11G|CORR|${source}`),requestId:deterministicUuid(`11G|REQ|${source}`),
        causationId:o.causation_id??undefined,authoritativeReference:`arb.outbox_events:${o.outbox_event_id}`,
        metadata:{domainEventId:String(o.domain_event_id),topic:String(o.topic),status:String(o.status),attempts:Number(o.attempts??0)},
        sourceEventId:String(o.outbox_event_id),occurredAt:new Date(o.created_at),idempotencyKey:`11g-outbox-event:${o.outbox_event_id}`
      },producer);n++;
    }
    await this.service.refreshActiveCorrelations(15);
    if(n>0)this.logger.info('11G event correlation batch completed',{count:n});return n;
  }
}

export class ObservabilityRetentionWorker{
  constructor(private readonly repo:ObservabilityRepository,private readonly metrics:Domain11gMetrics,private readonly logger:ObservabilityLogger){}
  async tick():Promise<number>{const n=await this.repo.applyRetention();if(n>0){this.metrics.retained(n);this.logger.info('11G retention batch completed',{deletedCount:n});}return n;}
}

export function mapAuditOutcome(v:unknown):'SUCCESS'|'FAILURE'|'DEGRADED'|'UNKNOWN'{
  switch(String(v??'OBSERVED').toUpperCase()){
    case 'SUCCESS':return 'SUCCESS';case 'DENIED':case 'FAILED':return 'FAILURE';case 'PARTIAL':return 'DEGRADED';case 'OBSERVED':return 'UNKNOWN';default:return 'UNKNOWN';
  }
}
export function mapAuditSeverity(v:unknown):'DEBUG'|'INFO'|'WARN'|'ERROR'|'CRITICAL'{
  switch(String(v??'INFO').toUpperCase()){
    case 'DEBUG':return 'DEBUG';case 'NOTICE':case 'INFO':return 'INFO';case 'WARNING':case 'WARN':return 'WARN';case 'ERROR':return 'ERROR';case 'CRITICAL':return 'CRITICAL';default:return 'INFO';
  }
}
function mapOutboxOutcome(v:unknown):'SUCCESS'|'FAILURE'|'RETRY'|'UNKNOWN'{const x=String(v??'').toUpperCase();if(x==='DEAD_LETTER'||x==='FAILED')return 'FAILURE';if(x==='RETRY'||x==='RETRYING')return 'RETRY';if(x==='PENDING'||x==='CLAIMED'||x==='SENT'||x==='DELIVERED')return 'SUCCESS';return 'UNKNOWN';}
function classifyDomainEvent(eventType:string):'DOMAIN_EVENT'|'HEALTH_CHANGE'|'READINESS_CHANGE'|'POLICY_CHANGE'|'CAPITAL_SAFETY_CHANGE'{const x=eventType.toUpperCase();if(x.includes('HEALTH'))return 'HEALTH_CHANGE';if(x.includes('READINESS'))return 'READINESS_CHANGE';if(x.includes('POLICY'))return 'POLICY_CHANGE';if(x.includes('CAPITAL_SAFETY'))return 'CAPITAL_SAFETY_CHANGE';return 'DOMAIN_EVENT';}
function isUuid(v:unknown):boolean{return typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);}
