import type{Job}from'bullmq';import type{Pool}from'pg';import{randomUUID}from'node:crypto';import{ArbExecutionAdapter}from'../adapters/arbExecutionAdapter';
export interface WorkerFactory{create<T>(queue:string,processor:(job:Job<T>)=>Promise<unknown>,options:{concurrency:number}):{close():Promise<void>}}
interface RiskJob{tenantKey:string;userId:string;profileDate:string;policyCode:string;idempotencyKey:string}
export function createAccessRiskWorker(factory:WorkerFactory,pool:Pool,principal:any,instanceId:string){const exec=new ArbExecutionAdapter(pool);
 return factory.create<RiskJob>('domain7-access-risk',async job=>{await exec.heartbeat('domain7-access-risk',instanceId,{jobId:job.id});
 const ctx=await exec.begin({processName:'D7H2_RISK_PROFILE',queueName:'domain7-access-risk',entityType:'USER',entityPk:job.data.userId,
 idempotencyKey:job.data.idempotencyKey,principal,correlationId:randomUUID(),payload:job.data});
 try{const{rows}=await pool.query(`SELECT forensic.d7h2_r5_profile_user($1,$2::uuid,$3::date,$4,$5,$6::uuid,$7::uuid) id`,
 [job.data.tenantKey,job.data.userId,job.data.profileDate,job.data.policyCode,job.data.idempotencyKey,ctx.processRunId,ctx.correlationId]);
 await exec.finish(ctx,'SUCCEEDED',rows[0]);return rows[0]}catch(e){await pool.query(`INSERT INTO arb.dead_letter(process_run_id,process_step_id,
 queue_name,job_id,entity_type,entity_pk,worker_name,worker_instance_id,error_message,payload_json,retry_count)
 VALUES($1::uuid,$2::bigint,'domain7-access-risk',$3,'USER',$4,'domain7-access-risk',$5,$6,$7::jsonb,$8)`,
 [ctx.processRunId,ctx.processStepId,String(job.id),job.data.userId,instanceId,e instanceof Error?e.message:String(e),JSON.stringify(job.data),job.attemptsMade]);
 await exec.finish(ctx,'FAILED',{},e);throw e}}, {concurrency:2})}
