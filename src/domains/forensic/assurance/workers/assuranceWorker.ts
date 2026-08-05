import{hostname}from'node:os';import type{Job}from'bullmq';import type{Pool}from'pg';
import type{AssuranceJob}from'../jobs/assuranceJobs';

export const createAssuranceProcessor=(pool:Pool)=>async(job:Job<AssuranceJob>)=>{
 const worker='domain7g1-worker',instance=`${hostname()}:${process.pid}`;
 const processName=job.data.type==='EVALUATE_CONTROL'?'D7G1_CONTROL_EVALUATE':'D7G1_METRIC_ROLLUP';
 const key=`d7g1:${job.id}`,entityPk=job.data.controlCode??job.data.controlDomain??'rollup';
 const{rows}=await pool.query<{run_id:string}>(`INSERT INTO arb.process_runs(process_name,process_stage,status,
 correlation_id,actor_type,actor_id,worker_name,worker_instance_id,entity_type,idempotency_key)
 VALUES($1,'ASSURANCE','STARTED',$2,'worker',$3,$3,$4,'ASSURANCE',$5) RETURNING run_id`,
 [processName,job.data.correlationId,worker,instance,key]);
 const run=rows[0]?.run_id;if(!run)throw new Error('Process run creation failed');
 let step:number|undefined;
 try{
  await pool.query(`SELECT forensic.d7g1_record_worker_heartbeat($1,$2,'RUNNING',$3::jsonb)`,
   [worker,instance,JSON.stringify({jobId:job.id,type:job.data.type})]);
  const begun=await pool.query<{step_id:string}>(`SELECT forensic.d7g1_begin_worker_step(
   $1::uuid,'domain7-assurance',$2,'ASSURANCE',$3,$4,$5::jsonb) step_id`,
   [run,String(job.id),entityPk,key,JSON.stringify(job.data)]);
  step=Number(begun.rows[0]?.step_id);if(!step)throw new Error('Process step creation failed');
  let result:Record<string,unknown>;let status:'SUCCEEDED'|'PARTIAL'='SUCCEEDED';
  if(job.data.type==='EVALUATE_CONTROL'){
   if(!job.data.controlCode||!job.data.subjectType||!job.data.subjectReference||!job.data.windowStart||!job.data.windowEnd)
    throw new Error('evaluation fields required');
   const r=await pool.query(`SELECT * FROM forensic.d7g1_evaluate_control_r2(
    $1,$2,$3,$4,$5::timestamptz,$6::timestamptz,$7,'worker'::forensic.event_actor_type,
    $8,$9::uuid,$10::uuid)`,[job.data.controlCode,job.data.tenantKey,job.data.subjectType,
    job.data.subjectReference,job.data.windowStart,job.data.windowEnd,worker,key,
    job.data.correlationId,run]);
   result=r.rows[0]??{};status=result.result==='PASS'?'SUCCEEDED':'PARTIAL';
  }else{
   if(!job.data.metricDate||!job.data.controlDomain)throw new Error('rollup fields required');
   const r=await pool.query(`SELECT * FROM forensic.d7g1_generate_rollup_r2($1,$2::date,$3,$4::uuid,$5::uuid)`,
    [job.data.tenantKey,job.data.metricDate,job.data.controlDomain,run,job.data.correlationId]);
   result=r.rows[0]??{};
  }
  await pool.query(`SELECT forensic.d7g1_complete_worker_step($1,$2,$3::jsonb,NULL,NULL)`,
   [step,status,JSON.stringify(result)]);
  await pool.query(`SELECT forensic.d7g1_record_worker_audit($1::uuid,$2,$3,'ASSURANCE',$4,$5,
   $6::jsonb,$7::jsonb,$8::jsonb,$9,$10)`,
   [run,step,job.data.correlationId,entityPk,job.data.type,JSON.stringify(job.data),
    JSON.stringify(result),JSON.stringify({status}),worker,worker]);
  await pool.query(`UPDATE arb.process_runs SET status=$2,completed_at=clock_timestamp(),
   rows_succeeded=1,details_json=details_json||$3::jsonb WHERE run_id=$1`,
   [run,status,JSON.stringify(result)]);
  await pool.query(`SELECT forensic.d7g1_record_worker_heartbeat($1,$2,'IDLE',$3::jsonb)`,
   [worker,instance,JSON.stringify({lastJobId:job.id})]);
  return result;
 }catch(error){
  if(step)await pool.query(`SELECT forensic.d7g1_complete_worker_step($1,'DEAD_LETTERED','{}'::jsonb,$2,$3)`,
   [step,error instanceof Error?error.name:'ERROR',error instanceof Error?error.message:String(error)]);
  await pool.query(`UPDATE arb.process_runs SET status='FAILED',failed_at=clock_timestamp(),
   rows_failed=1,error_class=$2,error_summary=$3 WHERE run_id=$1`,
   [run,error instanceof Error?error.name:'ERROR',error instanceof Error?error.message:String(error)]);
  await pool.query(`INSERT INTO arb.dead_letter(process_run_id,process_step_id,queue_name,job_id,
   entity_type,entity_pk,worker_name,worker_instance_id,error_code,error_message,payload_json,retry_count)
   VALUES($1,$2,'domain7-assurance',$3,'ASSURANCE',$4,$5,$6,$7,$8,$9::jsonb,$10)`,
   [run,step??null,String(job.id),entityPk,worker,instance,error instanceof Error?error.name:'ERROR',
    error instanceof Error?error.message:String(error),JSON.stringify(job.data),job.attemptsMade]);
  await pool.query(`SELECT forensic.d7g1_record_worker_heartbeat($1,$2,'DEGRADED',$3::jsonb)`,
   [worker,instance,JSON.stringify({error:error instanceof Error?error.message:String(error)})]);
  throw error;
 }
};
