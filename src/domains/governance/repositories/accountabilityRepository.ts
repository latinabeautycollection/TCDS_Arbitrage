import type { Pool } from 'pg';
import type { AuditEventInput, Domain11MutationInput, ExternalReferenceInput, LineageEdgeInput, EventLinkInput } from '../models/accountabilityTypes';

export class AccountabilityRepository {
  constructor(private readonly pool:Pool) {}

  async recordDomain11Mutation(authSessionId:string,x:Domain11MutationInput):Promise<string>{
    const q=await this.pool.query<{id:string}>(`
      select arb.domain11e_record_domain11_mutation_user(
        $1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::uuid,$8::uuid,$9::uuid,$10,$11,$12::uuid
      ) id`,
      [x.sourceSchema,x.sourceTable,x.sourceEntityId,x.mutationKind,x.beforeState??null,x.afterState??null,
       x.requestId??null,x.correlationId??null,x.policyVersionId??null,x.occurredAt,x.idempotencyKey,authSessionId]);
    return q.rows[0]!.id;
  }

  async recordExternal(authSessionId:string,x:ExternalReferenceInput):Promise<string>{
    const q=await this.pool.query<{id:string}>(`
      select arb.domain11e_record_external_reference_user(
        $1,$2,$3,$4,$5,$6,$7::uuid,$8::uuid,$9,$10,$11::uuid
      ) id`,
      [x.domainCode,x.sourceSchema,x.sourceTable,x.sourceEntityId,x.externalLedgerId,x.externalRecordSha256,
       x.requestId??null,x.correlationId??null,x.occurredAt,x.idempotencyKey,authSessionId]);
    return q.rows[0]!.id;
  }

  async recordAudit(authSessionId:string,x:AuditEventInput):Promise<string>{
    const q=await this.pool.query<{id:string}>(`
      select arb.domain11e_record_audit_event_user(
        $1,$2,$3,$4,$5,$6,$7::uuid,$8::uuid,$9,$10::jsonb,$11,$12,$13::uuid
      ) id`,
      [x.eventType,x.severity,x.targetDomainCode??null,x.targetReference??null,x.action,x.outcome,
       x.requestId??null,x.correlationId??null,x.remoteAddressHash??null,x.details??{},
       x.occurredAt,x.idempotencyKey,authSessionId]);
    return q.rows[0]!.id;
  }

  async recordAccessAudit(authSessionId:string,action:string,target:string,requestId:string,correlationId:string):Promise<string>{
    const q=await this.pool.query<{id:string}>(`
      select arb.domain11e_record_access_audit_user(
        $1,$2,$3::uuid,$4::uuid,$5::jsonb,$6,$7::uuid
      ) id`,
      [action,target,requestId,correlationId,{reference:target},`access:${requestId}:${action}:${target}`,authSessionId]);
    return q.rows[0]!.id;
  }

  async recordLineage(authSessionId:string,x:LineageEdgeInput):Promise<string>{
    const q=await this.pool.query<{id:string}>(`
      select arb.domain11e_record_lineage_edge_user(
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::uuid,$11::uuid,$12::uuid,$13,$14::jsonb,$15,$16::uuid
      ) id`,
      [x.source.domainCode,x.source.entityType,x.source.entityId,x.relationshipType,
       x.target.domainCode,x.target.entityType,x.target.entityId,
       x.source.authoritativeReference??null,x.target.authoritativeReference??null,
       x.correlationId??null,x.causationId??null,x.requestId??null,x.occurredAt,
       x.referenceMetadata??{},x.idempotencyKey,authSessionId]);
    return q.rows[0]!.id;
  }

  async recordEventLink(authSessionId:string,x:EventLinkInput):Promise<string>{
    const q=await this.pool.query<{id:string}>(`
      select arb.domain11e_record_event_link_user(
        $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::uuid,$8,$9::uuid
      ) id`,
      [x.mutationLedgerId??null,x.auditEventId??null,x.lineageEdgeId??null,
       x.domainEventId,x.outboxEventId??null,x.correlationId??null,x.causationId??null,
       x.idempotencyKey,authSessionId]);
    return q.rows[0]!.id;
  }

  async revokeSourceAuthority(authSessionId:string,bindingId:string,reason:string):Promise<string>{
    const q=await this.pool.query<{id:string}>(`
      select arb.domain11e_revoke_source_authority_user($1::uuid,$2,$3::uuid) id`,
      [bindingId,reason,authSessionId]);
    return q.rows[0]!.id;
  }

  async walk(domain:string,type:string,id:string,direction:string,depth:number,limit:number){
    return (await this.pool.query(
      `select * from arb.domain11e_lineage_walk($1,$2,$3,$4,$5,$6)`,
      [domain,type,id,direction,depth,limit])).rows;
  }
  async correlation(id:string,limit:number){return (await this.pool.query(
    `select * from arb.v_11e_audit_timeline where correlation_id=$1::uuid order by occurred_at,recorded_at limit $2`,
    [id,limit])).rows;}
  async timeline(domain:string|undefined,entity:string|undefined,limit:number){return (await this.pool.query(
    `select * from arb.v_11e_audit_timeline
      where ($1::text is null or domain_code=$1) and ($2::text is null or entity_id=$2)
      order by occurred_at desc,recorded_at desc limit $3`,
    [domain??null,entity??null,limit])).rows;}
  async verify(stream:string){return (await this.pool.query(
    `select * from arb.domain11e_verify_chain($1)`,[stream])).rows[0];}
  async transaction(id:string,limit:number){return (await this.pool.query(
    `select * from arb.mutation_ledger where transaction_id=$1::bigint order by occurred_at,recorded_at limit $2`,
    [id,limit])).rows;}
  async request(id:string,limit:number){return (await this.pool.query(
    `select * from arb.v_11e_audit_timeline where evidence_id in (
       select mutation_ledger_id::text from arb.mutation_ledger where request_id=$1
       union select audit_event_id::text from arb.audit_events where request_id=$1
     ) order by occurred_at,recorded_at limit $2`,
    [id,limit])).rows;}
  async policy(versionId:string,limit:number){return (await this.pool.query(
    `select * from arb.mutation_ledger where policy_version_id=$1::uuid order by occurred_at,recorded_at limit $2`,
    [versionId,limit])).rows;}
  async external(domain:string,entityId:string,limit:number){return (await this.pool.query(
    `select * from arb.mutation_ledger
      where ownership_scope='EXTERNAL_REFERENCE' and source_domain_code=$1 and source_entity_id=$2
      order by occurred_at,recorded_at limit $3`,
    [domain,entityId,limit])).rows;}
  async reconcile(limit:number):Promise<number>{
    const r=await this.pool.query<{n:number}>(`select arb.domain11e_reconcile_unchained($1) n`,[limit]);
    return Number(r.rows[0]?.n??0);
  }
}
