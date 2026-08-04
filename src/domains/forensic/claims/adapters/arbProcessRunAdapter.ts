import type{Pool}from'pg';import type{ClaimsPrincipal}from'../models/claimsTypes';
export class ArbProcessRunAdapter{constructor(private readonly pool:Pool){}
 async start(i:{processName:string;principal:ClaimsPrincipal;correlationId:string;idempotencyKey:string;entityType:string}){
 const{rows}=await this.pool.query<{run_id:string}>(`INSERT INTO arb.process_runs(process_name,process_stage,status,
 correlation_id,actor_type,actor_id,actor_name,entity_type,idempotency_key)VALUES($1,'CLAIM','STARTED',$2,$3,$4,$5,$6,$7)RETURNING run_id`,
 [i.processName,i.correlationId,i.principal.actorType,i.principal.actorId,i.principal.actorName??null,i.entityType,i.idempotencyKey]);
 if(!rows[0])throw new Error('Unable to start process run');return rows[0].run_id}
 async finish(id:string,status:'SUCCEEDED'|'PARTIAL'|'FAILED',details:Readonly<Record<string,unknown>>,error?:unknown){
 await this.pool.query(`UPDATE arb.process_runs SET status=$2,completed_at=CASE WHEN $2<>'FAILED' THEN clock_timestamp() END,
 failed_at=CASE WHEN $2='FAILED' THEN clock_timestamp() END,error_summary=$3,details_json=details_json||$4::jsonb WHERE run_id=$1::uuid AND status='STARTED'`,
 [id,status,error instanceof Error?error.message:error?String(error):null,JSON.stringify(details)])}}
