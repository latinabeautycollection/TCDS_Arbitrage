import { z } from "zod";
import { domain10CertificationEnv } from "../config/certificationEnv";
import type { RecordAttestationRequest,StartCertificationRequest } from "../models/certificationTypes";
import { Domain10CertificationError } from "../errors/Domain10CertificationError";

const startSchema=z.object({
  profileKey:z.string().regex(/^[A-Z0-9_]+$/),
  profileVersion:z.number().int().positive(),
  releaseKey:z.string().regex(/^[A-Za-z0-9._:-]{1,160}$/),
  gitCommitSha:z.string().regex(/^[0-9a-f]{40}$/i),
  environment:z.enum(["CERTIFICATION","STAGING","PRODUCTION"]),
  windowStart:z.string().datetime({offset:true}),
  windowEnd:z.string().datetime({offset:true}),
  requestedBy:z.string().min(1).max(200),
  requestId:z.string().uuid(),
  notes:z.string().max(2000).optional()
}).strict();

const attestationSchema=z.object({
  runId:z.string().uuid(),
  attestationType:z.string().regex(/^[A-Z0-9_]+$/),
  outcome:z.enum(["PASS","FAIL"]),
  evidenceSha256:z.string().regex(/^[0-9a-f]{64}$/i),
  evidenceReference:z.string().min(1).max(1000),
  attestedBy:z.string().min(1).max(200),
  toolVersion:z.string().max(200).optional(),
  notes:z.string().max(2000).optional()
}).strict();

export function validateStartCertificationRequest(input:unknown):StartCertificationRequest{
  const parsed=startSchema.safeParse(input);
  if(!parsed.success){
    throw new Domain10CertificationError(parsed.error.message,"INVALID_REQUEST");
  }
  const start=Date.parse(parsed.data.windowStart);
  const end=Date.parse(parsed.data.windowEnd);
  const maxMs=domain10CertificationEnv().DOMAIN10_CERTIFICATION_MAX_WINDOW_DAYS*86400000;
  if(end<=start || end-start>maxMs){
    throw new Domain10CertificationError("Certification evidence window is invalid","CERTIFICATION_WINDOW_INVALID");
  }
  if(end>Date.now()+300000){
    throw new Domain10CertificationError("Certification window cannot end materially in the future","CERTIFICATION_WINDOW_INVALID");
  }
  return parsed.data;
}

export function validateAttestationRequest(input:unknown):RecordAttestationRequest{
  const parsed=attestationSchema.safeParse(input);
  if(!parsed.success){
    throw new Domain10CertificationError(parsed.error.message,"ATTESTATION_INVALID");
  }
  return parsed.data;
}
