import type{Job}from'bullmq';import type{Pool}from'pg';import type{RecoveryJob}from'../jobs/recoveryJobs';
export const createRecoveryProcessor=(pool:Pool)=>async(job:Job<RecoveryJob>)=>{
 const processName=job.data.type==='BUILD_PACKAGE'?'D7E2_EVIDENCE_PACKAGE':'D7E2_LOSS_RECONCILE';
 const{rows}=await pool.query<{run_id:string}>(`INSERT INTO arb.process_runs(process_name,process_stage,
 status,correlation_id,actor_type,actor_id,worker_name,entity_type,idempotency_key)
 VALUES($1,'RECOVERY','STARTED',$2,'worker','domain7e2-worker','domain7e2-worker',$3,$4)RETURNING run_id`,
 [processName,job.data.correlationId,job.data.type==='BUILD_PACKAGE'?'DISPUTE':'RECOVERY',`d7e2:${job.id}`]);
 const run=rows[0]?.run_id;if(!run)throw new Error('Unable to create process run');
 try{
  if(job.data.type==='BUILD_PACKAGE'){
   const result=await pool.query(`SELECT * FROM forensic.d7e2_build_evidence_package_r2(
    $1::uuid,$2,'domain7e2-worker','worker'::forensic.event_actor_type,$3::uuid,$4::uuid)`,
    [job.data.entityId,job.data.tenantKey,run,job.data.correlationId]);
   const status=Number(result.rows[0]?.coverage_score??0)>=75?'SUCCEEDED':'PARTIAL';
   await pool.query(`UPDATE arb.process_runs SET status=$2,completed_at=clock_timestamp(),
    details_json=details_json||$3::jsonb WHERE run_id=$1`,[run,status,JSON.stringify({coverageScore:result.rows[0]?.coverage_score})]);
  }else{
   await pool.query(`SELECT * FROM forensic.d7e2_reconcile_loss_r2($1::uuid,NULL,
    clock_timestamp(),'recovery-v2','d7e2-reconcile-v2','worker'::forensic.event_actor_type,
    'domain7e2-worker',$2::uuid,$3::uuid)`,[job.data.entityId,run,job.data.correlationId]);
   await pool.query(`UPDATE arb.process_runs SET status='SUCCEEDED',completed_at=clock_timestamp() WHERE run_id=$1`,[run]);
  }
 }catch(error){
  await pool.query(`UPDATE arb.process_runs SET status='FAILED',failed_at=clock_timestamp(),
   error_class=$2,error_summary=$3 WHERE run_id=$1`,[run,error instanceof Error?error.name:'Error',
   error instanceof Error?error.message:String(error)]);
  await pool.query(`INSERT INTO arb.dead_letter(process_run_id,queue_name,job_id,entity_type,
   entity_pk,worker_name,error_code,error_message,payload_json,retry_count)
   VALUES($1,'domain7-recovery',$2,$3,$4,'domain7e2-worker',$5,$6,$7::jsonb,$8)`,
   [run,String(job.id),job.data.type==='BUILD_PACKAGE'?'DISPUTE':'RECOVERY',job.data.entityId,
    error instanceof Error?error.name:'ERROR',error instanceof Error?error.message:String(error),
    JSON.stringify(job.data),job.attemptsMade]);
  throw error;
 }
};
