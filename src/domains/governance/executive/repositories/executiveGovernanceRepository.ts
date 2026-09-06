import type { Pool, PoolClient } from 'pg';
import { randomUUID,createHash } from 'node:crypto';
import type { CurrentCertificationValidity, ExecutiveGovernanceState, ExecutiveSummary,TrustedActor } from '../models/executiveGovernanceTypes';

function parseValidity(value: unknown): CurrentCertificationValidity {
  const v=(value && typeof value==='object' ? value : {}) as Record<string,unknown>;
  return {
    currentValidity:String(v.currentValidity ?? 'BLOCKED'),
    reasonCode:String(v.reasonCode ?? 'CURRENT_VALIDITY_UNAVAILABLE'),
    consumable:v.consumable === true,
    certificationId:v.certificationId ? String(v.certificationId) : null,
    epochId:v.epochId ? String(v.epochId) : null,
    epochCode:v.epochCode ? String(v.epochCode) : null,
    activeReleaseIdentity:v.activeReleaseIdentity ? String(v.activeReleaseIdentity) : null,
    releaseCertificationId:v.releaseCertificationId ? String(v.releaseCertificationId) : null,
    certificationEnvironment:v.certificationEnvironment ? String(v.certificationEnvironment) : null,
  };
}
function currentExecutiveState(snapshot: ExecutiveGovernanceState, validity: CurrentCertificationValidity): ExecutiveGovernanceState {
  if (!validity.consumable) return 'BLOCKED';
  return snapshot;
}

export class ExecutiveGovernanceRepository {
 constructor(private readonly pool: Pool) {}
 async getSummary(): Promise<ExecutiveSummary> {
  const q=await this.pool.query(`SELECT snapshot_id,generated_at,executive_state,phase3_certification_state_at_snapshot,
   active_release_identity,health_state,readiness_state,policy_state,capital_safety_state,kpi_trust_state,profitability_state,
   reliability_state,control_required_state,control_enforcement_state,unresolved_critical_conditions,
   strict_current_validity
   FROM arb.v_executive_current_truth`);
  const r=q.rows[0] as Record<string,unknown>|undefined;
  if(!r) {
    return {snapshotId:null,generatedAt:null,executiveStateAtSnapshot:'UNKNOWN',currentExecutiveGovernanceState:'BLOCKED',
      phase3CertificationStateAtSnapshot:'PENDING',currentPhase3CertificationValidity:'NOT_CERTIFIED',
      currentPhase3CertificationReason:'NO_EXECUTIVE_SNAPSHOT',currentPhase3EpochId:null,currentPhase3EpochCode:null,currentPhase3Consumable:false,
      activeReleaseIdentity:null,healthState:'UNKNOWN',readinessState:'UNKNOWN',policyState:'UNKNOWN',capitalSafetyState:'UNKNOWN',
      kpiTrustState:'UNKNOWN',profitabilityState:'UNKNOWN',reliabilityState:'UNKNOWN',controlRequiredState:'UNKNOWN',
      controlEnforcementState:'UNKNOWN',unresolvedCriticalConditions:[]};
  }
  const validity=parseValidity(r.strict_current_validity);
  const snapshotState=r.executive_state as ExecutiveGovernanceState;
  return {snapshotId:String(r.snapshot_id),generatedAt:String(r.generated_at),executiveStateAtSnapshot:snapshotState,
   currentExecutiveGovernanceState:currentExecutiveState(snapshotState,validity),
   phase3CertificationStateAtSnapshot:String(r.phase3_certification_state_at_snapshot),
   currentPhase3CertificationValidity:validity.currentValidity,currentPhase3CertificationReason:validity.reasonCode,
   currentPhase3EpochId:validity.epochId,currentPhase3EpochCode:validity.epochCode,currentPhase3Consumable:validity.consumable,
   activeReleaseIdentity:validity.activeReleaseIdentity ?? String(r.active_release_identity),healthState:String(r.health_state),
   readinessState:String(r.readiness_state),policyState:String(r.policy_state),capitalSafetyState:String(r.capital_safety_state),
   kpiTrustState:String(r.kpi_trust_state),profitabilityState:String(r.profitability_state),reliabilityState:String(r.reliability_state),
   controlRequiredState:String(r.control_required_state),controlEnforcementState:String(r.control_enforcement_state),
   unresolvedCriticalConditions:Array.isArray(r.unresolved_critical_conditions)?r.unresolved_critical_conditions:[]};
 }
 async withRepeatableRead<T>(fn:(c:PoolClient)=>Promise<T>):Promise<T>{ const c=await this.pool.connect(); try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ');const v=await fn(c);await c.query('COMMIT');return v}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()} }
 async createSnapshot(actor:TrustedActor,idempotencyKey:string,evidenceCutoffAt:string):Promise<string>{
  const requestSha=createHash('sha256').update(JSON.stringify({evidenceCutoffAt,idempotencyKey})).digest('hex');
  const q=await this.pool.query('SELECT arb.domain11l_create_executive_snapshot($1,$2,$3,$4,$5,$6) AS id',
   [idempotencyKey,requestSha,evidenceCutoffAt,actor.type,actor.id,randomUUID()]); return String(q.rows[0]?.id);
 }
 async currentCertification():Promise<CurrentCertificationValidity>{
  const q=await this.pool.query('SELECT arb.domain11l_get_current_validity_strict() AS validity');
  return parseValidity(q.rows[0]?.validity);
 }
 async currentEpoch(){
  const validity=await this.currentCertification();
  if(!validity.consumable || !validity.epochId) return {epoch:null,validity};
  const q=await this.pool.query('SELECT * FROM arb.phase3_certification_epochs WHERE epoch_id=$1',[validity.epochId]);
  return {epoch:q.rows[0]??null,validity};
 }
 async closureMatrix(attemptId:string){return (await this.pool.query('SELECT * FROM arb.phase3_closure_matrix WHERE certification_attempt_id=$1 ORDER BY gate_code',[attemptId])).rows;}
}
