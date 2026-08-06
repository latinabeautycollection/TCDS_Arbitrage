import type{Pool}from'pg';import{createHash,randomUUID}from'node:crypto';import type{AccessPrincipal,ProcessContext}from'../models/accessTypes';
export class ArbExecutionAdapter{
 constructor(private readonly pool:Pool){}
 async begin(input:{processName:string;queueName:string;entityType:string;entityPk:string;idempotencyKey:string;
  principal:AccessPrincipal;correlationId:string;payload:unknown}):Promise<ProcessContext>{
  const runId:string=randomUUID(),payloadHash=createHash('sha256').update(JSON.stringify(input.payload)).digest('hex');
  const c=await this.pool.connect();try{await c.query('BEGIN');
   const idem=await c.query<{process_run_id:string}>(`INSERT INTO arb.queue_idempotency(queue_name,idempotency_key,process_run_id,
    entity_type,entity_pk,payload_hash)VALUES($1,$2,$3::uuid,$4,$5,$6)
    ON CONFLICT(queue_name,idempotency_key)DO NOTHING RETURNING process_run_id`,
    [input.queueName,input.idempotencyKey,runId,input.entityType,input.entityPk,payloadHash]);
   if(idem.rowCount!==1)throw new Error('Duplicate execution');
   await c.query(`INSERT INTO arb.process_runs(run_id,process_name,process_stage,status,correlation_id,actor_type,actor_id,
    entity_type,idempotency_key,details_json)VALUES($1::uuid,$2,'START','STARTED',$3,'user',$4,$5,$6,$7::jsonb)`,
    [runId,input.processName,input.correlationId,input.principal.userId,input.entityType,input.idempotencyKey,JSON.stringify({payloadHash})]);
   const step=await c.query<{id:string}>(`INSERT INTO arb.process_steps(process_run_id,step_name,queue_name,entity_type,entity_pk,
    status,idempotency_key,started_at,payload_json)VALUES($1::uuid,$2,$3,$4,$5,'RUNNING',$6,clock_timestamp(),$7::jsonb)RETURNING id::text`,
    [runId,input.processName,input.queueName,input.entityType,input.entityPk,input.idempotencyKey,JSON.stringify(input.payload)]);
   await c.query('COMMIT');return{processRunId:runId,processStepId:step.rows[0]!.id,correlationId:input.correlationId};
  }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}}
 async finish(ctx:ProcessContext,status:'SUCCEEDED'|'FAILED'|'PARTIAL',result:unknown,error?:unknown){
  const message=error instanceof Error?error.message:error?String(error):null;
  await this.pool.query(`UPDATE arb.process_steps SET status=$2,completed_at=clock_timestamp(),result_json=$3::jsonb,
   error_message=$4 WHERE id=$1::bigint;UPDATE arb.process_runs SET status=$2,completed_at=clock_timestamp(),
   error_summary=$4,details_json=details_json||$3::jsonb WHERE run_id=$5::uuid`,
   [ctx.processStepId,status,JSON.stringify(result),message,ctx.processRunId])}
 async heartbeat(worker:string,instance:string,details:unknown){
  await this.pool.query(`INSERT INTO arb.worker_heartbeats(worker_name,worker_instance_id,status,details_json,last_seen_at,updated_at)
   VALUES($1,$2,'RUNNING',$3::jsonb,clock_timestamp(),clock_timestamp())ON CONFLICT(worker_name,worker_instance_id)DO UPDATE
   SET status='RUNNING',details_json=EXCLUDED.details_json,last_seen_at=clock_timestamp(),updated_at=clock_timestamp()`,
   [worker,instance,JSON.stringify(details)])}
}
