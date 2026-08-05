import type{Pool}from'pg';import type{AssurancePrincipal,FindingFilters,RunControlEvaluationInput}from'../models/assuranceTypes';
export class AssuranceRepository{constructor(private readonly pool:Pool){}
 async evaluate(p:AssurancePrincipal,i:RunControlEvaluationInput,run:string,c:string){const{rows}=await this.pool.query(
 `SELECT * FROM forensic.d7g1_evaluate_control_r2($1,$2,$3,$4,$5::timestamptz,$6::timestamptz,
 $7,$8::forensic.event_actor_type,$9,$10::uuid,$11::uuid)`,
 [i.controlCode,p.tenantKey,i.subjectType,i.subjectReference,i.evaluationWindowStart,i.evaluationWindowEnd,
 p.actorId,p.actorType,i.idempotencyKey,c,run]);return rows[0]}
 async assign(p:AssurancePrincipal,id:string,assignee:string,reason:string,run:string,c:string){const{rows}=await this.pool.query(
 `SELECT * FROM forensic.d7g1_assign_finding($1::uuid,$2::uuid,$3,$4::uuid,$5::uuid,$6::uuid)`,
 [id,assignee,reason,p.warehouseUserId,run,c]);return rows[0]}
 async contain(p:AssurancePrincipal,id:string,i:{actionCode:string;description:string;result:string;evidence:Readonly<Record<string,unknown>>},run:string,c:string){
 const{rows}=await this.pool.query(`SELECT * FROM forensic.d7g1_record_containment(
 $1::uuid,$2,$3,$4,$5::jsonb,$6::uuid,$7::uuid,$8::uuid)`,
 [id,i.actionCode,i.description,i.result,JSON.stringify(i.evidence),p.warehouseUserId,run,c]);return rows[0]}
 async validate(p:AssurancePrincipal,id:string,evaluationRunId:string,run:string,c:string){const{rows}=await this.pool.query(
 `SELECT * FROM forensic.d7g1_validate_resolution($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid)`,
 [id,evaluationRunId,p.warehouseUserId,run,c]);return rows[0]}
 async list(p:AssurancePrincipal,f:FindingFilters){const values=[p.tenantKey,f.status??null,f.severity??null,f.controlCode??null,
 f.ownerUserId??null,f.overdue??null,f.facilityId??null,f.limit,f.offset];const{rows}=await this.pool.query(
 `SELECT * FROM forensic.assurance_findings WHERE tenant_key=$1
 AND ($2::text IS NULL OR status=$2) AND ($3::text IS NULL OR severity=$3)
 AND ($4::text IS NULL OR control_code=$4) AND ($5::uuid IS NULL OR owner_user_id=$5)
 AND ($6::boolean IS NULL OR ($6 AND due_at<clock_timestamp() AND status NOT IN('RESOLVED','FALSE_POSITIVE')))
 AND ($7::uuid IS NULL OR facility_id=$7) ORDER BY severity DESC,due_at,created_at LIMIT $8 OFFSET $9`,values);return rows}
 async dashboard(p:AssurancePrincipal){const{rows}=await this.pool.query(
 `SELECT * FROM forensic.assurance_rollup_current WHERE tenant_key=$1 ORDER BY metric_date DESC,control_domain`,[p.tenantKey]);return rows}
}
