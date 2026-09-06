import { z } from 'zod';
const sha=z.string().regex(/^[0-9a-f]{64}$/); const nonEmpty=z.string().trim().min(1).max(512);
export const certificationRequestSchema=z.object({
 idempotencyKey:nonEmpty.max(200), evidenceCutoffAt:z.string().datetime({offset:true}), policyReference:nonEmpty,
 policySha256:sha, activeReleaseIdentity:nonEmpty, activeReleaseManifestSha256:sha, sourceRevision:nonEmpty,
 sourceManifestSha256:sha, migrationBaseline:nonEmpty, migrationManifestSha256:sha, policyManifestSha256:sha,
 configurationBaselineSha256:sha.optional(), orchestratorVersion:nonEmpty.max(100), suiteVersion:nonEmpty.max(100),
 certificationEnvironment:z.literal('PRODUCTION_EQUIVALENT'), certificationEnvironmentSha256:sha
}).strict();
export const revocationRequestSchema=z.object({
 reasonCode:z.string().regex(/^[A-Z0-9_]+$/).max(100), evidenceReference:nonEmpty, evidenceSha256:sha,
 correlationId:z.string().uuid()
}).strict();

export const snapshotRequestSchema=z.object({idempotencyKey:nonEmpty.max(200),evidenceCutoffAt:z.string().datetime({offset:true})}).strict();
