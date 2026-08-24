import { domain10Runtime } from "../../infrastructure/operationsRuntime";
import {
  beginAndExecuteCertification,
  finalizeCertification,
  getCertificationSummary,
  recordCertificationAttestation
} from "../repositories/certificationRepository";
import {
  validateAttestationRequest,
  validateStartCertificationRequest
} from "../validators/certificationRequestValidator";
import type { CertificationRunSummary } from "../models/certificationTypes";

export async function runDomain10AutomatedCertification(input:unknown):Promise<CertificationRunSummary>{
  const request=validateStartCertificationRequest(input);
  const runtime=domain10Runtime();
  const span=runtime.tracer.startSpan("domain10.certification.execute");
  try{
    const runId=await beginAndExecuteCertification(request);
    const summary=await getCertificationSummary(runId);
    runtime.logger.info("Domain 10 automated certification completed",{
      runId,state:summary.state,releaseKey:summary.releaseKey,
      automatedPass:summary.automatedPass,automatedFail:summary.automatedFail,
      automatedInconclusive:summary.automatedInconclusive
    });
    return summary;
  }finally{ span.end(); }
}

export async function attestDomain10Certification(input:unknown):Promise<CertificationRunSummary>{
  const request=validateAttestationRequest(input);
  await recordCertificationAttestation(request);
  return getCertificationSummary(request.runId);
}

export async function finalizeDomain10Certification(
  runId:string,actor:string
):Promise<CertificationRunSummary>{
  await finalizeCertification(runId,actor);
  return getCertificationSummary(runId);
}
