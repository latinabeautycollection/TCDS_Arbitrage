
import type { PoolClient } from "pg";
import type { IntelligenceJob } from "./intelligenceTypes";
import { OutcomeObservationEngine } from "./outcomeObservationEngine";
import { LossAttributionEngine } from "./lossAttributionEngine";
import { RootCauseEngine } from "./rootCauseEngine";
import { PreventabilityEngine } from "./preventabilityEngine";
import { ControlEffectivenessEngine } from "./controlEffectivenessEngine";
import { PolicyRecommendationEngine } from "./policyRecommendationEngine";
import { LossForecastEngine } from "./lossForecastEngine";

export class IntelligenceDispatcher {
  private readonly outcome = new OutcomeObservationEngine();
  private readonly loss = new LossAttributionEngine();
  private readonly rootCause = new RootCauseEngine();
  private readonly preventability = new PreventabilityEngine();
  private readonly controls = new ControlEffectivenessEngine();
  private readonly recommendations = new PolicyRecommendationEngine();
  private readonly forecasts = new LossForecastEngine();

  public async dispatch(client: PoolClient, job: IntelligenceJob) {
    switch (job.job_type) {
      case "OBSERVE_OUTCOME": return this.outcome.recordOutcome(client, job.subject_id);
      case "ATTRIBUTE_LOSS": return this.loss.attribute(client, job.subject_id);
      case "ANALYZE_ROOT_CAUSE": return this.rootCause.analyze(client, job.subject_id);
      case "ASSESS_PREVENTABILITY": return this.preventability.assess(client, job.subject_id);
      case "MEASURE_CONTROL_EFFECTIVENESS": return this.controls.measure(client, job.subject_id);
      case "GENERATE_RECOMMENDATION": return this.recommendations.recommend(client, job.subject_id);
      case "GENERATE_FORECAST": return this.forecasts.forecast(client, job.subject_id);
      case "COMPUTE_SCORECARD": {
        const result = await client.query(
          "select return_defense.compute_executive_scorecard(current_date) result_id",
        );
        return result.rows[0] as Record<string, unknown>;
      }
      case "BUILD_LEARNING_EXAMPLE":
        return { subjectId: job.subject_id, status: "REVIEW_REQUIRED" };
      default:
        throw new Error(`Unsupported intelligence job type: ${job.job_type}`);
    }
  }
}
