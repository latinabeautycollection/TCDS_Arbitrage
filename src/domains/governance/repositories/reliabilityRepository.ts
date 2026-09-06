import type{Pool}from'pg';
import type{EvaluateSloRequest,EvaluateDriftRequest,CreateBaselineRequest}from'../models/reliabilityTypes';
export class ReliabilityRepository{
 constructor(private readonly pool:Pool){}
 async componentId(code:'DOMAIN11I_RELIABILITY_ENGINE'|'DOMAIN11I_RELIABILITY_WORKER'='DOMAIN11I_RELIABILITY_ENGINE'){
  const q=await this.pool.query(`select component_id from arb.component_registry where component_code=$1 and active`,[code]);
  if(q.rowCount!==1)throw Object.assign(new Error('DOMAIN11I_COMPONENT_MISSING'),{statusCode:503});return String(q.rows[0]!.component_id)
 }
 async evaluateSlo(x:EvaluateSloRequest,componentId:string){const q=await this.pool.query<{id:string}>(`
  select arb.domain11i_evaluate_slo_v2($1::uuid,$2,$3,$4::uuid,$5::uuid,$6::uuid) id`,
  [x.sloDefinitionId,x.evaluationAt,x.idempotencyKey,componentId,x.requestId,x.correlationId]);return q.rows[0]!.id}
 async evaluateDrift(x:EvaluateDriftRequest,componentId:string){const q=await this.pool.query<{id:string}>(`
  select arb.domain11i_evaluate_drift_v2($1::uuid,$2,$3,$4,$5::uuid,$6::uuid,$7::uuid) id`,
  [x.baselineId,x.evaluationAt,x.windowSeconds,x.idempotencyKey,componentId,x.requestId,x.correlationId]);return q.rows[0]!.id}
 async createBaseline(x:CreateBaselineRequest,componentId:string){const q=await this.pool.query<{id:string}>(`
  select arb.domain11i_create_baseline_v2($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::uuid,$12::uuid,$13::uuid) id`,
  [x.driftCode,x.sourceAuthority,x.sourceMetricCode,x.baselineType,x.methodology,x.directionality,x.from,x.to,
   x.minimumEvaluationSampleSize,x.sourceFreshnessSeconds,componentId,x.requestId,x.correlationId]);return q.rows[0]!.id}
 async current(){return (await this.pool.query(`select * from arb.v_domain11i_reliability_current order by slo_code`)).rows}
 async drift(id:string){return (await this.pool.query(`select d.*,c.methodology,c.directionality from arb.drift_evaluations_11i d join arb.drift_baseline_contract_11i_v2 c using(baseline_id) where drift_evaluation_id=$1::uuid`,[id])).rows[0]??null}
}