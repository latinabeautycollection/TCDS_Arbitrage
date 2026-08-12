import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { ExecutionContext, ForensicPrincipal } from '../models/resilienceTypes';

interface ExistingExecution {
  payload_hash: string;
  state: 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  process_run_id: string;
  result_json: unknown;
}

export class ArbExecutionAdapter {
  constructor(private readonly pool: Pool) {}

  async execute<T>(input: {
    processName: string; queueName: string; entityType: string; entityPk: string;
    idempotencyKey: string; principal: ForensicPrincipal; payload: unknown;
  }, operation: (context: ExecutionContext) => Promise<T>): Promise<T> {
    const payloadHash = createHash('sha256').update(JSON.stringify(input.payload)).digest('hex');
    const runId = randomUUID();
    const correlationId = randomUUID();
    const client = await this.pool.connect();
    let stepId: number;

    try {
      await client.query('BEGIN');
      const existing = await client.query<ExistingExecution>(`
        SELECT payload_hash,state,process_run_id,result_json
        FROM forensic.resilience_execution_keys
        WHERE queue_name=$1 AND idempotency_key=$2
        FOR UPDATE`, [input.queueName, input.idempotencyKey]);

      if (existing.rows[0]) {
        const row = existing.rows[0];
        if (row.payload_hash !== payloadHash) throw new Error('Idempotency key reused with different payload');
        if (row.state === 'SUCCEEDED') {
          await client.query('COMMIT');
          return row.result_json as T;
        }
        if (row.state === 'RUNNING') throw new Error('Execution already in progress');
        throw new Error('Failed execution requires governed replay');
      }

      await client.query(`
        INSERT INTO arb.process_runs(run_id,process_name,status,correlation_id,actor_type,actor_id,actor_name,
          worker_name,worker_instance_id,entity_type,idempotency_key,details_json)
        VALUES($1,$2,'STARTED',$3,'user',$4,$4,$5,$6,$7,$8,$9::jsonb)`,
        [runId,input.processName,correlationId,input.principal.userId,input.queueName,
         process.pid.toString(),input.entityType,input.idempotencyKey,
         JSON.stringify({tenantKey:input.principal.tenantKey,payloadHash})]);

      const step = await client.query<{id:number}>(`
        INSERT INTO arb.process_steps(process_run_id,step_name,queue_name,entity_type,entity_pk,status,
          job_id,idempotency_key,started_at,payload_json)
        VALUES($1,$2,$3,$4,$5,'RUNNING',$6,$7,clock_timestamp(),$8::jsonb) RETURNING id`,
        [runId,input.processName,input.queueName,input.entityType,input.entityPk,runId,
         input.idempotencyKey,JSON.stringify({payloadHash})]);
      stepId = step.rows[0]!.id;

      await client.query(`
        INSERT INTO forensic.resilience_execution_keys(queue_name,idempotency_key,payload_hash,state,
          process_run_id,process_step_id,created_at,updated_at)
        VALUES($1,$2,$3,'RUNNING',$4,$5,clock_timestamp(),clock_timestamp())`,
        [input.queueName,input.idempotencyKey,payloadHash,runId,stepId]);

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      client.release();
      throw error;
    }

    client.release();
    const context: ExecutionContext = {
      processRunId: runId, processStepId: stepId!, correlationId,
      idempotencyKey: input.idempotencyKey, payloadHash,
    };

    try {
      const result = await operation(context);
      const finish = await this.pool.connect();
      try {
        await finish.query('BEGIN');
        await finish.query(`UPDATE forensic.resilience_execution_keys SET state='SUCCEEDED',result_json=$3::jsonb,
          updated_at=clock_timestamp() WHERE queue_name=$1 AND idempotency_key=$2`,
          [input.queueName,input.idempotencyKey,JSON.stringify(result)]);
        await finish.query(`UPDATE arb.process_steps SET status='SUCCEEDED',completed_at=clock_timestamp(),
          result_json=$2::jsonb,updated_at=clock_timestamp() WHERE id=$1`,
          [context.processStepId,JSON.stringify({success:true})]);
        await finish.query(`UPDATE arb.process_runs SET status='SUCCEEDED',rows_succeeded=1,
          completed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE run_id=$1`,[runId]);
        await finish.query('COMMIT');
      } catch (error) { await finish.query('ROLLBACK'); throw error; }
      finally { finish.release(); }
      return result;
    } catch (error) {
      const fail = await this.pool.connect();
      try {
        await fail.query('BEGIN');
        await fail.query(`UPDATE forensic.resilience_execution_keys SET state='FAILED',error_json=$3::jsonb,
          updated_at=clock_timestamp() WHERE queue_name=$1 AND idempotency_key=$2`,
          [input.queueName,input.idempotencyKey,JSON.stringify({message:error instanceof Error?error.message:String(error)})]);
        await fail.query(`UPDATE arb.process_steps SET status='FAILED',error_code=$2,error_message=$3,
          completed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1`,
          [context.processStepId,error instanceof Error?error.name:'ERROR',error instanceof Error?error.message:String(error)]);
        await fail.query(`UPDATE arb.process_runs SET status='FAILED',rows_failed=1,error_class=$2,error_summary=$3,
          failed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE run_id=$1`,
          [runId,error instanceof Error?error.name:'ERROR',error instanceof Error?error.message:String(error)]);
        await fail.query(`INSERT INTO arb.dead_letter(process_run_id,process_step_id,queue_name,job_id,
          entity_type,entity_pk,worker_name,worker_instance_id,error_code,error_message,payload_json)
          VALUES($1,$2,$3,$4,$5,$6,$3,$7,$8,$9,$10::jsonb)`,
          [runId,context.processStepId,input.queueName,runId,input.entityType,input.entityPk,
           process.pid.toString(),error instanceof Error?error.name:'ERROR',
           error instanceof Error?error.message:String(error),JSON.stringify(input.payload)]);
        await fail.query('COMMIT');
      } catch { await fail.query('ROLLBACK'); }
      finally { fail.release(); }
      throw error;
    }
  }
}
