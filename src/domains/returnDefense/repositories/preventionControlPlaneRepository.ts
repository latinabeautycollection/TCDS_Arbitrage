import type { Pool, PoolClient } from "pg";
import type {
  FeatureSnapshotInput,
  PreventionDecisionInput,
  RiskAssessmentInput,
} from "../contracts/preventionControlPlane";

export interface RequestContext {
  tenantId: string;
  actorId: string;
  correlationId: string;
}

export class PreventionControlPlaneRepository {
  public constructor(private readonly pool: Pool) {}

  private async transaction<T>(
    context: RequestContext,
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id',$1,true)", [context.tenantId]);
      await client.query("SELECT set_config('app.actor_id',$1,true)", [context.actorId]);
      await client.query("SELECT set_config('app.correlation_id',$1,true)", [context.correlationId]);
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public createFeatureSnapshot(
    context: RequestContext,
    input: FeatureSnapshotInput,
  ): Promise<string> {
    return this.transaction(context, async (client) => {
      const result = await client.query<{ id: string }>(
        `select return_defense.create_feature_snapshot(
          $1::uuid,$2::uuid,$3,$4,$5::jsonb,$6::jsonb,
          $7::uuid,$8::uuid,make_interval(secs=>$9::int)
        ) as id`,
        [
          input.passportId, input.passportVersionId, input.gateStage,
          input.featureSchemaVersion, JSON.stringify(input.features),
          JSON.stringify(input.sourceDigest), input.policyVersionId,
          input.modelVersionId ?? null, input.freshForSeconds,
        ],
      );
      return result.rows[0]!.id;
    });
  }

  public finalizeRiskAssessment(
    context: RequestContext,
    input: RiskAssessmentInput,
  ): Promise<string> {
    return this.transaction(context, async (client) => {
      const result = await client.query<{ id: string }>(
        `select return_defense.finalize_risk_assessment(
          $1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::text[]
        ) as id`,
        [
          input.featureSnapshotId, input.riskScore,
          input.returnProbability ?? null, input.disputeProbability ?? null,
          input.fraudProbability ?? null, input.expectedLossUsd,
          input.expectedLaborMinutes, input.defensibilityScore ?? null,
          input.executionIntegrityScore ?? null,
          input.evidenceReliabilityScore ?? null, input.confidenceScore,
          input.rulesetVersion, JSON.stringify(input.payload), input.reasonCodes,
        ],
      );
      return result.rows[0]!.id;
    });
  }

  public issueDecision(
    context: RequestContext,
    input: PreventionDecisionInput,
  ): Promise<string> {
    return this.transaction(context, async (client) => {
      const result = await client.query<{ id: string }>(
        `select return_defense.issue_prevention_decision(
          $1::uuid,$2,$3,$4::timestamptz,$5::timestamptz,$6::jsonb,$7::text[]
        ) as id`,
        [
          input.riskAssessmentId, input.gateStatus, input.reviewLevel,
          input.decisionDeadline ?? null, input.expiresAt,
          JSON.stringify(input.payload), input.reasonCodes,
        ],
      );
      return result.rows[0]!.id;
    });
  }

  public canProgress(
    context: RequestContext,
    passportId: string,
    gateStage: string,
  ): Promise<boolean> {
    return this.transaction(context, async (client) => {
      const result = await client.query<{ allowed: boolean }>(
        "select return_defense.can_progress_gate($1::uuid,$2) as allowed",
        [passportId, gateStage],
      );
      return result.rows[0]?.allowed ?? false;
    });
  }
}
