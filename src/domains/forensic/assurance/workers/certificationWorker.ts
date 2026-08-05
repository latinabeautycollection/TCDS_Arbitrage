import{hostname}from'node:os';import type{Job}from'bullmq';import type{Pool}from'pg';
import type{CertificationJob}from'../jobs/certificationJobs';

export const createCertificationProcessor=(pool:Pool)=>async(job:Job<CertificationJob>)=>{
 const worker='domain7g2-worker',instance=`${hostname()}:${process.pid}`,key=`d7g2:${job.id}`;
 const{rows}=await pool.query<{run_id:string}>(`INSERT INTO arb.process_runs(process_name,process_stage,status,
 correlation_id,actor_type,actor_id,worker_name,worker_instance_id,entity_type,idempotency_key)
 VALUES('D7G2_EVIDENCE_COLLECT','ASSURANCE','STARTED',$1,'worker',$2,$2,$3,'ASSURANCE_CAMPAIGN',$4)
 RETURNING run_id`,[job.data.correlationId,worker,instance,key]);
 const run=rows[0]?.run_id;if(!run)throw new Error('Process run creation failed');
 let step:number|undefined;
 try{
  await pool.query(`SELECT forensic.d7g1_record_worker_heartbeat($1,$2,'RUNNING',$3::jsonb)`,
   [worker,instance,JSON.stringify({jobId:job.id})]);
  const begun=await pool.query<{step_id:string}>(`SELECT forensic.d7g1_begin_worker_step(
   $1::uuid,'domain7-certification',$2,'ASSURANCE_CAMPAIGN',$3,$4,$5::jsonb) step_id`,
   [run,String(job.id),job.data.campaignId,key,JSON.stringify(job.data)]);
  step=Number(begun.rows[0]?.step_id);
  const r=await pool.query(`SELECT * FROM forensic.d7g2_collect_and_freeze_evidence(
   $1::uuid,$2,(SELECT created_by_user_id FROM forensic.assurance_certification_campaigns
   WHERE assurance_certification_campaign_id=$1::uuid),$3,'worker'::forensic.event_actor_type,$4::uuid,$5::uuid)`,
   [job.data.campaignId,job.data.tenantKey,worker,run,job.data.correlationId]);
  const result=r.rows[0]??{};
  await pool.query(`SELECT forensic.d7g1_complete_worker_step($1,'SUCCEEDED',$2::jsonb,NULL,NULL)`,
   [step,JSON.stringify(result)]);
  await pool.query(`UPDATE arb.process_runs SET status='SUCCEEDED',completed_at=clock_timestamp(),
   rows_succeeded=1 WHERE run_id=$1`,[run]);
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
   VALUES($1,$2,'domain7-certification',$3,'ASSURANCE_CAMPAIGN',$4,$5,$6,$7,$8,$9::jsonb,$10)`,
   [run,step??null,String(job.id),job.data.campaignId,worker,instance,
    error instanceof Error?error.name:'ERROR',error instanceof Error?error.message:String(error),
    JSON.stringify(job.data),job.attemptsMade]);
  await pool.query(`SELECT forensic.d7g1_record_worker_heartbeat($1,$2,'DEGRADED',$3::jsonb)`,
   [worker,instance,JSON.stringify({error:error instanceof Error?error.message:String(error)})]);
  throw error;
 }
};
