export type CertificationEnvironment="CERTIFICATION"|"STAGING"|"PRODUCTION";
export type CertificationRunState=
  | "CREATED" | "RUNNING" | "AWAITING_ATTESTATIONS"
  | "CERTIFIED" | "REJECTED" | "ERROR";
export type CertificationCheckOutcome="PASS"|"FAIL"|"INCONCLUSIVE"|"ERROR";
export type AttestationOutcome="PASS"|"FAIL";

export interface StartCertificationRequest{
  profileKey:string;
  profileVersion:number;
  releaseKey:string;
  gitCommitSha:string;
  environment:CertificationEnvironment;
  windowStart:string;
  windowEnd:string;
  requestedBy:string;
  requestId:string;
  notes?:string;
}

export interface CertificationRunSummary{
  runId:string;
  profileKey:string;
  profileVersion:number;
  releaseKey:string;
  gitCommitSha:string;
  environment:CertificationEnvironment;
  windowStart:string;
  windowEnd:string;
  state:CertificationRunState;
  schemaFingerprint:string;
  profileDefinitionHash?:string;
  securityFingerprint?:string;
  requesterDbRole?:string;
  automatedPass:number;
  automatedFail:number;
  automatedInconclusive:number;
  requiredAttestations:number;
  passedAttestations:number;
  failedAttestations:number;
  certifiedAt?:string;
  runHash?:string;
}

export interface CertificationCheckResult{
  checkKey:string;
  outcome:CertificationCheckOutcome;
  required:boolean;
  sampleSize:number;
  failureCount:number;
  details:Record<string,unknown>;
}

export interface RecordAttestationRequest{
  runId:string;
  attestationType:string;
  outcome:AttestationOutcome;
  evidenceSha256:string;
  evidenceReference:string;
  attestedBy:string;
  toolVersion?:string;
  notes?:string;
}
