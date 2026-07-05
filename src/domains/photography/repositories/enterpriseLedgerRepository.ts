import type { Pool, PoolClient } from 'pg';
import { makeEventHash } from '../utils/hash';
export class EnterpriseLedgerRepository {
  constructor(private db: Pool) {}
  async startRun(processName: string, actorType='worker', details: any = {}) {
    const r = await this.db.query(`INSERT INTO arb.process_runs(process_name,status,actor_type,details_json,entity_type) VALUES($1,'STARTED',$2,$3,'photo') RETURNING run_id`, [processName, actorType, details]);
    return r.rows[0].run_id as string;
  }
  async finishRun(runId: string, status: 'SUCCEEDED'|'FAILED'|'PARTIAL', summary: any = {}) { await this.db.query(`UPDATE arb.process_runs SET status=$2, completed_at=CASE WHEN $2='SUCCEEDED' THEN now() ELSE completed_at END, failed_at=CASE WHEN $2='FAILED' THEN now() ELSE failed_at END, details_json=details_json||$3::jsonb, updated_at=now() WHERE run_id=$1`, [runId,status,summary]); }
  async addForensicEvent(input: {processRunId?: string; processStepId?: number; entityType: string; entityPk: string; eventType: string; actionType: string; evidence: any; metrics?: any; flags?: any[]; sourceTable?: string; sourcePk?: string;}) {
    const hash = makeEventHash(input);
    await this.db.query(`INSERT INTO arb.forensic_events(process_run_id,process_step_id,entity_type,entity_pk,event_type,action_type,actor_type,source_table,source_pk,evidence_json,metrics_json,flags_json,event_hash) VALUES($1,$2,$3,$4,$5,$6,'worker',$7,$8,$9,$10,$11,$12)`, [input.processRunId ?? null,input.processStepId ?? null,input.entityType,input.entityPk,input.eventType,input.actionType,input.sourceTable ?? null,input.sourcePk ?? null,input.evidence,input.metrics ?? {},input.flags ?? [],hash]);
  }
  async serviceCall(input: {processRunId?: string; serviceName: string; methodName: string; entityType?: string; entityPk?: string; inputHash?: string; outputSummary?: any; durationMs?: number; success: boolean; retryable?: boolean; errorClass?: string; errorMessage?: string;}) {
    await this.db.query(`INSERT INTO arb.service_call_ledger(process_run_id,service_name,method_name,entity_type,entity_pk,actor_type,input_hash,output_summary,duration_ms,success,retryable,error_class,error_message) VALUES($1,$2,$3,$4,$5,'worker',$6,$7,$8,$9,$10,$11,$12)`, [input.processRunId ?? null,input.serviceName,input.methodName,input.entityType ?? null,input.entityPk ?? null,input.inputHash ?? null,input.outputSummary ?? {},input.durationMs ?? null,input.success,input.retryable ?? false,input.errorClass ?? null,input.errorMessage ?? null]);
  }
  async deadLetter(input: {processRunId?: string; queueName: string; jobId?: string; entityType?: string; entityPk?: string; errorCode?: string; errorMessage: string; payload?: any; retryCount?: number;}) {
    await this.db.query(`INSERT INTO arb.dead_letter(process_run_id,queue_name,job_id,entity_type,entity_pk,error_code,error_message,payload_json,retry_count) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [input.processRunId ?? null,input.queueName,input.jobId ?? null,input.entityType ?? null,input.entityPk ?? null,input.errorCode ?? null,input.errorMessage,input.payload ?? {},input.retryCount ?? 0]);
  }
}
