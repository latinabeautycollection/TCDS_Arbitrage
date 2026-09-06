import type{Pool}from'pg';
import type{EvaluateControlRequest,RecoveryRequest,RecoveryApprovalRequest,RecoveryFinalizeRequest,TriggerCandidate,ActiveRuleRef}from'../models/controlTypes';

export class ControlRepository{
 constructor(
  private readonly apiPool:Pool,
  private readonly workerPool:Pool,
  private readonly recoveryPool:Pool,
  private readonly adminPool:Pool,
  private readonly approvalPool:Pool
 ){}
 private poolForComponent(code:'DOMAIN11J_CONTROL_ENGINE'|'DOMAIN11J_CONTROL_WORKER'|'DOMAIN11J_RECOVERY_ENGINE'){
  return code==='DOMAIN11J_CONTROL_WORKER'?this.workerPool:code==='DOMAIN11J_RECOVERY_ENGINE'?this.recoveryPool:this.apiPool;
 }
 async componentId(code:'DOMAIN11J_CONTROL_ENGINE'|'DOMAIN11J_CONTROL_WORKER'|'DOMAIN11J_RECOVERY_ENGINE'){
  const q=await this.poolForComponent(code).query<{component_id:string}>(`select component_id from arb.component_registry where component_code=$1 and active`,[code]);
  if(q.rowCount!==1)throw Object.assign(new Error('DOMAIN11J_COMPONENT_MISSING'),{statusCode:503});return q.rows[0]!.component_id;
 }
 async evaluateRule(x:EvaluateControlRequest,componentId:string,worker=false){
  const pool=worker?this.workerPool:this.apiPool;
  const q=await pool.query<{id:string}>(`select arb.domain11j_evaluate_rule($1,$2,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7) id`,[x.ruleCode,x.triggerReference,x.requestId,x.correlationId,x.causationId??null,componentId,x.idempotencyKey]);
  return q.rows[0]!.id;
 }
 async requestRecovery(x:RecoveryRequest,componentId:string){const q=await this.recoveryPool.query<{id:string}>(`select arb.domain11j_request_recovery($1::uuid,$2,$3::uuid,$4::uuid,$5::uuid,$6) id`,[x.restrictedControlDecisionId,x.recoveryTriggerReference,x.requestId,x.correlationId,componentId,x.idempotencyKey]);return q.rows[0]!.id}
 async approveRecovery(x:RecoveryApprovalRequest,p:{authSessionId:string}){const q=await this.approvalPool.query<{id:string}>(`select arb.domain11j_approve_recovery_user_v2($1::uuid,$2::uuid,$3,$4,$5::uuid,$6::uuid) id`,[x.recoveryAttemptId,p.authSessionId,x.decision,x.justification,x.requestId,x.correlationId]);return q.rows[0]!.id}
 async finalizeRecovery(x:RecoveryFinalizeRequest,componentId:string){const q=await this.recoveryPool.query<{id:string}>(`select arb.domain11j_finalize_recovery_v2($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5) id`,[x.recoveryAttemptId,x.requestId,x.correlationId,componentId,x.idempotencyKey]);return q.rows[0]!.id}
 async syncRules(requestId:string,correlationId:string,componentId:string,idempotencyKey:string){const q=await this.adminPool.query<{n:number}>(`select arb.domain11j_sync_rules_from_active_policy($1::uuid,$2::uuid,$3::uuid,$4)::int n`,[requestId,correlationId,componentId,idempotencyKey]);return Number(q.rows[0]!.n)}
 async effectiveControls(){return(await this.apiPool.query(`select * from arb.v_domain11j_effective_controls_v2 order by target_code,capability_code`)).rows}
 async decision(id:string){const q=await this.apiPool.query(`select d.*,p.*,s.status latest_status from arb.control_decisions d join arb.control_decision_provenance_11j p using(control_decision_id) left join arb.v_domain11j_latest_decision_status s using(control_decision_id) where d.control_decision_id=$1::uuid`,[id]);return q.rows[0]??null}
 async activeRules(authority:string):Promise<Array<ActiveRuleRef&{controlRuleId:string;policyVersionId:string;ruleSha256:string}>>{
  const q=await this.workerPool.query<{rule_code:string;trigger_authority:ActiveRuleRef['triggerAuthority'];control_rule_id:string;policy_version_id:string;rule_sha256:string}>(`select r.rule_code,r.trigger_authority,r.control_rule_id,r.policy_version_id,r.rule_sha256 from arb.control_rule_active_11j a join arb.control_rule_definitions_11j r using(control_rule_id) where r.trigger_authority=$1 and r.effective_from<=clock_timestamp() and coalesce(r.effective_until,'infinity')>clock_timestamp() order by r.priority desc,r.rule_code`,[authority]);
  return q.rows.map(x=>({ruleCode:x.rule_code,triggerAuthority:x.trigger_authority,controlRuleId:x.control_rule_id,policyVersionId:x.policy_version_id,ruleSha256:x.rule_sha256}));
 }
 async triggerCandidates(limit:number):Promise<TriggerCandidate[]>{const q=await this.workerPool.query<any>(`select * from arb.domain11j_pending_triggers_v2($1)`,[limit]);return q.rows.map((x:any)=>({authority:x.trigger_authority,reference:x.trigger_reference,correlationId:x.correlation_id??null}))}
 async markRuleProcessed(x:TriggerCandidate,rule:{controlRuleId:string;policyVersionId:string;ruleSha256:string},outcome:'MATCHED'|'NOT_MATCHED'|'STALE'|'FAILED'){
  await this.workerPool.query(`select arb.domain11j_record_rule_trigger_receipt_v2($1,$2,$3::uuid,$4,$5::uuid)`,[x.authority,x.reference,rule.controlRuleId,outcome,x.correlationId]);
 }
 async approvedRecoveries(limit:number){return(await this.workerPool.query<any>(`select a.recovery_attempt_id,a.correlation_id from arb.control_recovery_attempts_11j a where a.approval_required and a.status='APPROVAL_PENDING' and a.recovery_control_decision_id is null and exists(select 1 from arb.control_manual_approvals_11j m where m.recovery_attempt_id=a.recovery_attempt_id and m.decision='APPROVE') and not exists(select 1 from arb.control_manual_approvals_11j m where m.recovery_attempt_id=a.recovery_attempt_id and m.decision='REJECT') order by a.created_at limit $1`,[limit])).rows}
 async activateApprovedRecovery(id:string,requestId:string,correlationId:string,componentId:string){return(await this.recoveryPool.query<{id:string}>(`select arb.domain11j_activate_approved_recovery($1::uuid,$2::uuid,$3::uuid,$4::uuid) id`,[id,requestId,correlationId,componentId])).rows[0]!.id}
 async actionAckEvents(limit:number){return(await this.workerPool.query<any>(`select domain_event_id,correlation_id from arb.domain_events e where event_type='DOMAIN11.CONTROL_ACTION_ACKNOWLEDGED' and not exists(select 1 from arb.control_action_ack_receipts_11j r where r.domain_event_id=e.domain_event_id) order by occurred_at limit $1`,[limit])).rows}
 async reconcileActionAck(eventId:string,requestId:string,componentId:string,key:string){return(await this.workerPool.query<{id:string}>(`select arb.domain11j_reconcile_action_ack_v2($1::uuid,$2::uuid,$3::uuid,$4) id`,[eventId,requestId,componentId,key])).rows[0]!.id}
 async expiredControls(limit:number){return(await this.workerPool.query<{control_decision_id:string}>(`select d.control_decision_id from arb.control_decisions d join arb.v_domain11j_latest_decision_status s using(control_decision_id) where s.status='ACTIVE' and d.valid_until is not null and d.valid_until<=clock_timestamp() order by d.valid_until limit $1`,[limit])).rows}
 async reconcileExpiredOne(id:string,requestId:string,correlationId:string,componentId:string){return(await this.workerPool.query<{s:string}>(`select arb.domain11j_reconcile_one_expired_control_v2($1::uuid,$2::uuid,$3::uuid,$4::uuid) s`,[id,requestId,correlationId,componentId])).rows[0]!.s}
}
