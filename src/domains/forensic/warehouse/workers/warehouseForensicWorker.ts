import type { Job } from 'bullmq';
import type { Pool } from 'pg';
import type { WarehouseForensicJob } from '../jobs/warehouseForensicJobs';

export function createWarehouseForensicProcessor(pool:Pool){
  return async(job:Job<WarehouseForensicJob>):Promise<void>=>{
    const run=await pool.query(
      `INSERT INTO arb.process_runs(
        process_name,process_stage,status,correlation_id,actor_type,actor_id,
        worker_name,entity_type,idempotency_key)
       VALUES($1,'WAREHOUSE','STARTED',$2,'worker','domain7b-worker',
        'domain7b-worker','WAREHOUSE_EVIDENCE_SESSION',$3)
       RETURNING run_id`,
      [
        job.data.type==='ABANDON_STALE'?'D7B_SESSION_RECOVERY':'D7B_GATE_EVALUATE',
        job.data.correlationId,`d7b-worker:${job.id}`,
      ],
    );
    const runId=String(run.rows[0].run_id);
    try{
      if(job.data.type==='EVALUATE_GATE'){
        await pool.query(
          `SELECT forensic.d7b_evaluate_gate(
            $1::uuid,$2,'worker'::forensic.event_actor_type,
            'domain7b-worker',$3::uuid,$4::uuid)`,
          [job.data.sessionId,job.data.tenantKey,runId,job.data.correlationId],
        );
      }else{
        await pool.query(
          `SELECT forensic.d7b_abandon_stale_session(
            $1::uuid,$2,'domain7b-worker',$3::uuid,$4::uuid)`,
          [job.data.sessionId,job.data.tenantKey,runId,job.data.correlationId],
        );
      }
      await pool.query(
        `UPDATE arb.process_runs SET status='SUCCEEDED',completed_at=clock_timestamp(),
         updated_at=clock_timestamp() WHERE run_id=$1::uuid AND status='STARTED'`,[runId]);
    }catch(error){
      await pool.query(
        `UPDATE arb.process_runs SET status='FAILED',failed_at=clock_timestamp(),
         error_class=$2,error_summary=$3,updated_at=clock_timestamp()
         WHERE run_id=$1::uuid AND status='STARTED'`,
        [runId,error instanceof Error?error.name:'Error',error instanceof Error?error.message:String(error)]);
      throw error;
    }
  };
}
