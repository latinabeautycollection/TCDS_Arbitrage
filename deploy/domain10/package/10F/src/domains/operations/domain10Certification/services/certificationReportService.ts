import type { CertificationRunSummary } from "../models/certificationTypes";

export function buildCertificationHeadline(summary:CertificationRunSummary):string{
  return [
    `Domain 10 certification ${summary.state}`,
    `release=${summary.releaseKey}`,
    `commit=${summary.gitCommitSha}`,
    `checks(pass/fail/inconclusive)=${summary.automatedPass}/${summary.automatedFail}/${summary.automatedInconclusive}`,
    `attestations(pass/fail/required)=${summary.passedAttestations}/${summary.failedAttestations}/${summary.requiredAttestations}`,
    `schema=${summary.schemaFingerprint}`,
    `security=${summary.securityFingerprint??"n/a"}`,
    `profileHash=${summary.profileDefinitionHash??"n/a"}`
  ].join(" ");
}
