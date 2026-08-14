
import type { Pool, PoolClient } from "pg";
import type { RequestContext } from "./preventionControlPlaneRepository";
import type { RequiredControlInput, RiskContributionInput } from "../contracts/controlPlaneHardening";

export class ControlPlaneHardeningRepository {
  public constructor(private readonly pool: Pool) {}

  private async tx<T>(ctx: RequestContext, fn: (c: PoolClient)=>Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("select set_config('app.tenant_id',$1,true)",[ctx.tenantId]);
      await c.query("select set_config('app.actor_id',$1,true)",[ctx.actorId]);
      await c.query("select set_config('app.correlation_id',$1,true)",[ctx.correlationId]);
      const value = await fn(c);
      await c.query("COMMIT");
      return value;
    } catch (error) {
      await c.query("ROLLBACK");
      throw error;
    } finally { c.release(); }
  }

  public assess(ctx: RequestContext, input: {
    featureSnapshotId:string;riskScore:number;returnProbability?:number|null;
    disputeProbability?:number|null;fraudProbability?:number|null;
    expectedLossUsd:number;expectedLaborMinutes:number;defensibilityScore?:number|null;
    executionIntegrityScore?:number|null;evidenceReliabilityScore?:number|null;
    confidenceScore:number;rulesetVersion:string;payload:Record<string,unknown>;
    reasonCodes:string[];contributions:RiskContributionInput[];
    scopeType?:string;scopeKey?:string;
  }): Promise<string> {
    return this.tx(ctx, async c => {
      const r = await c.query<{id:string}>(`select return_defense.finalize_risk_assessment_v2(
        $1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::text[],
        $15::jsonb,$16,$17) id`,[
        input.featureSnapshotId,input.riskScore,input.returnProbability??null,
        input.disputeProbability??null,input.fraudProbability??null,
        input.expectedLossUsd,input.expectedLaborMinutes,input.defensibilityScore??null,
        input.executionIntegrityScore??null,input.evidenceReliabilityScore??null,
        input.confidenceScore,input.rulesetVersion,JSON.stringify(input.payload),
        input.reasonCodes,JSON.stringify(input.contributions),input.scopeType??"GLOBAL",
        input.scopeKey??"*"
      ]);
      return r.rows[0]!.id;
    });
  }

  public decide(ctx:RequestContext,input:{
    riskAssessmentId:string;gateStatus:string;reviewLevel:string;
    decisionDeadline?:Date|null;expiresAt:Date;payload:Record<string,unknown>;
    reasonCodes:string[];controls:RequiredControlInput[];
  }):Promise<string>{
    return this.tx(ctx,async c=>{
      const r=await c.query<{id:string}>(`select return_defense.issue_prevention_decision_with_controls(
       $1::uuid,$2,$3,$4::timestamptz,$5::timestamptz,$6::jsonb,$7::text[],$8::jsonb) id`,[
        input.riskAssessmentId,input.gateStatus,input.reviewLevel,
        input.decisionDeadline??null,input.expiresAt,JSON.stringify(input.payload),
        input.reasonCodes,JSON.stringify(input.controls.map(x=>({
          control_code:x.controlCode,mandatory:x.mandatory,
          minimum_evidence_count:x.minimumEvidenceCount,
          expected_labor_minutes:x.expectedLaborMinutes,
          satisfaction_deadline:x.satisfactionDeadline?.toISOString()??null,
          requirement_payload:x.requirementPayload
        })))
      ]);
      return r.rows[0]!.id;
    });
  }
}
