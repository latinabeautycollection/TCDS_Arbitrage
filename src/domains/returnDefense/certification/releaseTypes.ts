
export type ReleaseJobType =
  | "FREEZE_CONTRACTS"
  | "VERIFY_DEPENDENCIES"
  | "RUN_CERTIFICATION"
  | "BUILD_EXECUTIVE_PACKET"
  | "VERIFY_DEPLOYMENT"
  | "VERIFY_ROLLBACK"
  | "FINAL_RELEASE_ASSESSMENT";

export interface ReleaseJob {
  domain_release_job_id: string;
  domain_release_contract_id: string;
  job_type: ReleaseJobType;
  claim_token: string;
  attempt_count: number;
  max_attempts: number;
  job_payload: Record<string, unknown>;
}

export interface ReleaseAssessment {
  ready: boolean;
  blockingFindings: number;
  failedAssertions: number;
  missingEvidence: string[];
  missingRunbooks: string[];
}
