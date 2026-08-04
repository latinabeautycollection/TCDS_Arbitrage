import type{Job}from'bullmq';import type{Pool}from'pg';import type{DossierJob}from'../jobs/dossierJobs';
export const createDossierProcessor=(pool:Pool)=>async(job:Job<DossierJob>)=>{
 const name=job.data.type==='ASSEMBLE'?'D7F2_DOSSIER_ASSEMBLE':'D7F2_DOSSIER_VERIFY';
 const{rows}=await pool.query<{run_id:string}>(`INSERT INTO arb.process_runs(process_name,process_stage,status,
 correlation_id,actor_type,actor_id,worker_name,entity_type,idempotency_key)
 VALUES($1,'CASEFILE','STARTED',$2,'worker','domain7f2-worker','domain7f2-worker','CASE_DOSSIER',$3) RETURNING run_id`,
 [name,job.data.correlationId,`d7f2:${job.id}`]);const run=rows[0]?.run_id;if(!run)throw new Error('Process run creation failed');
 try{let status:'SUCCEEDED'|'PARTIAL'='SUCCEEDED';
  if(job.data.type==='ASSEMBLE')await pool.query(`SELECT * FROM forensic.d7f2_assemble_dossier(
   $1::uuid,$2,'domain7f2-worker','worker'::forensic.event_actor_type,$3::uuid,$4::uuid)`,
   [job.data.dossierId,job.data.tenantKey,run,job.data.correlationId]);
  else{if(!job.data.sealId)throw new Error('sealId required');const r=await pool.query(
   `SELECT * FROM forensic.d7f2_verify_dossier($1::uuid,$2,$3::uuid,'domain7f2-worker',
   'worker'::forensic.event_actor_type,$4::uuid,$5::uuid)`,
   [job.data.dossierId,job.data.tenantKey,job.data.sealId,run,job.data.correlationId]);
   status=r.rows[0]?.result==='VERIFIED'?'SUCCEEDED':'PARTIAL'}
  await pool.query(`UPDATE arb.process_runs SET status=$2,completed_at=clock_timestamp() WHERE run_id=$1`,[run,status]);
 }catch(e){await pool.query(`UPDATE arb.process_runs SET status='FAILED',failed_at=clock_timestamp(),error_summary=$2 WHERE run_id=$1`,
 [run,e instanceof Error?e.message:String(e)]);throw e}
};
