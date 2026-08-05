import type{Pool}from'pg';import type{AssurancePrincipal}from'../models/assuranceTypes';
export class ArbProcessRunAdapter{constructor(private readonly pool:Pool){}
 async start(i:{processName:string;principal:AssurancePrincipal;correlationId:string;idempotencyKey:string;entityType:string}){
  const{rows}=await this.pool.query<{run_id:string}>(`INSERT INTO arb.process_runs(
   process_name,process_stage,status,correlation_id,actor_type,actor_id,actor_name,entity_type,idempotency_key)
   VALUES($1,'ASSURANCE','STARTED',$2,$3,$4,$5,$6,$7) RETURNING run_id`,
   [i.processName,i.correlationId,i.principal.actorType,i.principal.actorId,i.principal.actorName??null,
    i.entityType,i.idempotencyKey]);
  const row=rows[0];if(!row)throw new Error('Unable to create process run');return row.run_id;
 }
 async finish(id:string,status:'SUCCEEDED'|'PARTIAL'|'FAILED',details:Readonly<Record<string,unknown>>,error?:unknown){
  await this.pool.query(`UPDATE arb.process_runs SET status=$2,
   completed_at=CASE WHEN $2 IN('SUCCEEDED','PARTIAL') THEN clock_timestamp() ELSE completed_at END,
   failed_at=CASE WHEN $2='FAILED' THEN clock_timestamp() ELSE failed_at END,
   error_class=$3,error_summary=$4,details_json=details_json||$5::jsonb,updated_at=clock_timestamp()
   WHERE run_id=$1::uuid AND status='STARTED'`,
   [id,status,error instanceof Error?error.name:null,error instanceof Error?error.message:error?String(error):null,
    JSON.stringify(details)]);
 }}
