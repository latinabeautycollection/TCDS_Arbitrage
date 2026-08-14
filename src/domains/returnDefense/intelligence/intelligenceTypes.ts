
export type IntelligenceJobType =
  | "OBSERVE_OUTCOME"
  | "ATTRIBUTE_LOSS"
  | "ANALYZE_ROOT_CAUSE"
  | "ASSESS_PREVENTABILITY"
  | "MEASURE_CONTROL_EFFECTIVENESS"
  | "BUILD_LEARNING_EXAMPLE"
  | "GENERATE_RECOMMENDATION"
  | "COMPUTE_SCORECARD"
  | "GENERATE_FORECAST";

export interface IntelligenceJob {
  intelligence_job_id: string;
  job_type: IntelligenceJobType;
  subject_type: string;
  subject_id: string;
  claim_token: string;
  attempt_count: number;
  max_attempts: number;
}
