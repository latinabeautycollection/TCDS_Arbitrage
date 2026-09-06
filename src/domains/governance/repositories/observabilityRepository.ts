import type { Pool } from 'pg';
import type { ObservationInput,ObservationRow,QueryWindow,ObservabilityPrincipal } from '../models/observabilityTypes';

export class ObservabilityRepository {
  constructor(private readonly pool:Pool){}

  async recordUser(principal:ObservabilityPrincipal,x:ObservationInput):Promise<string>{
    const q=await this.pool.query<{id:string}>(`
      select arb.domain11g_record_observation_user(
        $1,$2::uuid,$3,$4,$5,$6,$7::uuid,$8::uuid,$9::uuid,
        $10,$11,$12,$13::smallint,$14,$15,$16,$17,$18,$19,$20::numeric,$21::jsonb,$22,$23,$24,$25::uuid
      ) id
    `,[
      x.subjectDomainCode,x.subjectComponentId??null,x.observationType,x.operationCode,x.outcome,x.severity,
      x.correlationId,x.requestId,x.causationId??null,x.traceId??null,x.spanId??null,x.parentSpanId??null,
      x.traceFlags??null,x.traceState??null,x.transactionId??null,x.jobId??null,x.queueMessageId??null,
      x.authoritativeReference??null,x.authoritativeRecordSha256??null,x.durationMs??null,JSON.stringify(x.metadata),
      x.sourceEventId??null,x.occurredAt,x.idempotencyKey,principal.authSessionId
    ]);
    return q.rows[0]!.id;
  }

  async recordService(producerComponentCode:string,x:ObservationInput):Promise<string>{
    const q=await this.pool.query<{id:string}>(`
      select arb.domain11g_record_observation_service(
        $1,$2,$3::uuid,$4,$5,$6,$7,$8::uuid,$9::uuid,$10::uuid,
        $11,$12,$13,$14::smallint,$15,$16,$17,$18,$19,$20,$21::numeric,$22::jsonb,$23,$24,$25
      ) id
    `,[
      producerComponentCode,x.subjectDomainCode,x.subjectComponentId??null,x.observationType,x.operationCode,x.outcome,
      x.severity,x.correlationId,x.requestId,x.causationId??null,x.traceId??null,x.spanId??null,x.parentSpanId??null,
      x.traceFlags??null,x.traceState??null,x.transactionId??null,x.jobId??null,x.queueMessageId??null,
      x.authoritativeReference??null,x.authoritativeRecordSha256??null,x.durationMs??null,JSON.stringify(x.metadata),
      x.sourceEventId??null,x.occurredAt,x.idempotencyKey
    ]);
    return q.rows[0]!.id;
  }

  async queryCorrelation(id:string,w:QueryWindow):Promise<ObservationRow[]>{const q=await this.pool.query<ObservationRow>(`select * from arb.domain11g_query_correlation($1::uuid,$2,$3,$4)`,[id,w.from,w.to,w.limit]);return q.rows;}
  async queryTrace(id:string,w:QueryWindow):Promise<ObservationRow[]>{const q=await this.pool.query<ObservationRow>(`select * from arb.domain11g_query_trace($1,$2,$3,$4)`,[id,w.from,w.to,w.limit]);return q.rows;}
  async queryReference(ref:string,w:QueryWindow):Promise<ObservationRow[]>{const q=await this.pool.query<ObservationRow>(`select * from arb.domain11g_query_reference($1,$2,$3,$4)`,[ref,w.from,w.to,w.limit]);return q.rows;}

  async findUnobservedDomainEvents(limit:number){return (await this.pool.query(`
    select d.domain_event_id,d.event_type,d.aggregate_type,d.aggregate_id,d.payload_sha256,d.correlation_id,d.causation_id,d.occurred_at
    from arb.domain_events d where not exists(
      select 1 from arb.observability_observations o where o.authoritative_reference='arb.domain_events:'||d.domain_event_id::text
    ) order by d.occurred_at,d.domain_event_id limit $1`,[limit])).rows;}

  async findUnobservedOutboxEvents(limit:number){return (await this.pool.query(`
    select o.outbox_event_id,o.domain_event_id,o.topic,o.status,o.attempts,o.created_at,d.correlation_id,d.causation_id
    from arb.outbox_events o join arb.domain_events d on d.domain_event_id=o.domain_event_id
    where not exists(select 1 from arb.observability_observations x where x.authoritative_reference='arb.outbox_events:'||o.outbox_event_id::text)
    order by o.created_at,o.outbox_event_id limit $1`,[limit])).rows;}

  async findUnobservedMutationEvidence(limit:number){return (await this.pool.query(`
    select m.mutation_ledger_id,m.source_domain_code,m.source_schema,m.source_table,m.source_entity_id,m.mutation_kind,m.correlation_id,m.request_id,m.occurred_at,m.governance_record_sha256
    from arb.mutation_ledger m where m.correlation_id is not null and not exists(
      select 1 from arb.observability_observations o where o.authoritative_reference='arb.mutation_ledger:'||m.mutation_ledger_id::text)
    order by m.occurred_at,m.mutation_ledger_id limit $1`,[limit])).rows;}

  async findUnobservedAuditEvidence(limit:number){return (await this.pool.query(`
    select a.audit_event_id,a.event_type,a.severity,a.target_domain_code,a.target_reference,a.action,a.outcome,a.correlation_id,a.request_id,a.occurred_at
    from arb.audit_events a where a.correlation_id is not null and not exists(
      select 1 from arb.observability_observations o where o.authoritative_reference='arb.audit_events:'||a.audit_event_id::text)
    order by a.occurred_at,a.audit_event_id limit $1`,[limit])).rows;}

  async applyRetention():Promise<number>{const q=await this.pool.query<{n:number}>(`select arb.domain11g_apply_retention() n`);return Number(q.rows[0]?.n??0);}
  async activeCorrelationCount(windowMinutes:number):Promise<number>{const q=await this.pool.query<{n:number}>(`select count(distinct correlation_id)::int n from arb.observability_observations where recorded_at>=clock_timestamp()-make_interval(mins=>$1)`,[windowMinutes]);return Number(q.rows[0]?.n??0);}
}
