import type{Job}from'bullmq';import type{Pool}from'pg';import{randomUUID}from'node:crypto';import{ArbExecutionAdapter}from'../adapters/arbExecutionAdapter';
export interface WorkerFactory{create<T>(queue:string,processor:(job:Job<T>)=>Promise<unknown>,options:{concurrency:number}):{close():Promise<void>}}
interface JobData{tenantKey:string;idempotencyKey:string}
export function createAccessExpiryWorker(factory:WorkerFactory,pool:Pool,principal:any,instanceId:string){
 const exec=new ArbExecutionAdapter(pool);return factory.create<JobData>('domain7-access-expiry',async job=>{
  const correlationId:string=randomUUID();await exec.heartbeat('domain7-access-expiry',instanceId,{jobId:job.id});
  const ctx=await exec.begin({processName:'D7H1_ACCESS_EXPIRY',queueName:'domain7-access-expiry',entityType:'TENANT',
   entityPk:job.data.tenantKey,idempotencyKey:job.data.idempotencyKey,principal,correlationId,payload:job.data});
  try{const{rows}=await pool.query(`SELECT forensic.d7h1_r5_expire_access($1,$2::uuid,$3::uuid) result`,
   [job.data.tenantKey,ctx.processRunId,ctx.correlationId]);await exec.finish(ctx,'SUCCEEDED',rows[0]);return rows[0]}
  catch(e){await pool.query(`INSERT INTO arb.dead_letter(process_run_id,process_step_id,queue_name,job_id,entity_type,entity_pk,
   worker_name,worker_instance_id,error_message,payload_json,retry_count)VALUES($1::uuid,$2::bigint,'domain7-access-expiry',$3,
   'TENANT',$4,'domain7-access-expiry',$5,$6,$7::jsonb,$8)`,[ctx.processRunId,ctx.processStepId,String(job.id),job.data.tenantKey,
   instanceId,e instanceof Error?e.message:String(e),JSON.stringify(job.data),job.attemptsMade]);await exec.finish(ctx,'FAILED',{},e);throw e}
 },{concurrency:1})}
