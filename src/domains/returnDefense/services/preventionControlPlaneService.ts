import crypto from "node:crypto";
import type {
  FeatureSnapshotInput,
  PreventionDecisionInput,
  RiskAssessmentInput,
} from "../contracts/preventionControlPlane";
import {
  featureSnapshotSchema,
  preventionDecisionSchema,
  riskAssessmentSchema,
} from "../validators/preventionControlPlaneValidator";
import {
  PreventionControlPlaneRepository,
  type RequestContext,
} from "../repositories/preventionControlPlaneRepository";

export class PreventionControlPlaneService {
  public constructor(
    private readonly repository: PreventionControlPlaneRepository,
  ) {}

  public createSnapshot(context: RequestContext, input: FeatureSnapshotInput) {
    return this.repository.createFeatureSnapshot(
      this.validateContext(context),
      featureSnapshotSchema.parse(input),
    );
  }

  public assess(context: RequestContext, input: RiskAssessmentInput) {
    return this.repository.finalizeRiskAssessment(
      this.validateContext(context),
      riskAssessmentSchema.parse(input),
    );
  }

  public decide(context: RequestContext, input: PreventionDecisionInput) {
    const parsed = preventionDecisionSchema.parse(input);
    if (parsed.expiresAt <= new Date()) {
      throw new RangeError("Decision expiration must be in the future");
    }
    return this.repository.issueDecision(this.validateContext(context), parsed);
  }

  public canProgress(
    context: RequestContext,
    passportId: string,
    gateStage: string,
  ) {
    return this.repository.canProgress(
      this.validateContext(context),
      passportId,
      gateStage,
    );
  }

  private validateContext(context: RequestContext): RequestContext {
    for (const value of [
      context.tenantId,
      context.actorId,
      context.correlationId,
    ]) {
      if (!value || !crypto.randomUUID || !/^[0-9a-f-]{36}$/i.test(value)) {
        throw new TypeError("Tenant, actor, and correlation UUIDs are required");
      }
    }
    return context;
  }
}
