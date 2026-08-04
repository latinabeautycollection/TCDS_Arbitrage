import type{Job}from'bullmq';import type{Pool}from'pg';import type{ClaimsJob}from'../jobs/claimsJobs';
export const createClaimsProcessor=(pool:Pool)=>async(job:Job<ClaimsJob>)=>{const{rows}=await pool.query(
`INSERT INTO arb.process_runs(process_name,process_stage,status,correlation_id,actor_type,actor_id,worker_name,entity_type,idempotency_key)
VALUES('D7E1_READINESS_EVALUATE','CLAIM','STARTED',$1,'worker','domain7e1-worker','domain7e1-worker','CLAIM_CASE',$2)RETURNING run_id`,
[job.data.correlationId,`d7e1:${job.id}`]);const run=String(rows[0].run_id);try{const r=await pool.query(
`SELECT * FROM forensic.d7e1_evaluate_readiness($1::uuid,$2,'domain7e1-worker','worker'::forensic.event_actor_type,$3::uuid,$4::uuid)`,
[job.data.claimCaseLinkId,job.data.tenantKey,run,job.data.correlationId]);const status=r.rows[0]?.result==='READY'?'SUCCEEDED':'PARTIAL';
await pool.query(`UPDATE arb.process_runs SET status=$2,completed_at=clock_timestamp() WHERE run_id=$1`,[run,status])}
catch(e){await pool.query(`UPDATE arb.process_runs SET status='FAILED',failed_at=clock_timestamp(),error_summary=$2 WHERE run_id=$1`,
[run,e instanceof Error?e.message:String(e)]);throw e}}
