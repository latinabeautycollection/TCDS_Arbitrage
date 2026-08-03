import type{Job}from'bullmq';import type{Pool}from'pg';import type{ReturnIntakeJob}from'../jobs/returnIntakeJobs';
export const createReturnIntakeProcessor=(pool:Pool)=>async(job:Job<ReturnIntakeJob>)=>{
 const run=await pool.query(`INSERT INTO arb.process_runs(process_name,process_stage,status,correlation_id,actor_type,actor_id,
 worker_name,entity_type,idempotency_key)VALUES('D7D1_GATE_EVALUATE','RETURN','STARTED',$1,'worker','domain7d1-worker',
 'domain7d1-worker','RETURN_INTAKE_LINK',$2)RETURNING run_id`,[job.data.correlationId,`d7d1:${job.id}`]);
 const id=String(run.rows[0].run_id);try{await pool.query(`SELECT forensic.d7d1_evaluate_gate(
 $1::uuid,$2,'domain7d1-worker','worker'::forensic.event_actor_type,$3::uuid,$4::uuid)`,
 [job.data.linkId,job.data.tenantKey,id,job.data.correlationId]);
 await pool.query(`UPDATE arb.process_runs SET status='SUCCEEDED',completed_at=clock_timestamp() WHERE run_id=$1`,[id])}
 catch(e){await pool.query(`UPDATE arb.process_runs SET status='FAILED',failed_at=clock_timestamp(),error_summary=$2 WHERE run_id=$1`,
 [id,e instanceof Error?e.message:String(e)]);throw e}}
