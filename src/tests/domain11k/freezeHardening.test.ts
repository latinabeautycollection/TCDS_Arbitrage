import fs from'node:fs';import path from'node:path';
const hard=fs.readFileSync(path.join(__dirname,'../../../sql/1111_domain11k_freeze_hardening_v2.sql'),'utf8');
test('replay result is database-derived',()=>{expect(hard).toContain('domain11k_compare_replay');expect(hard).not.toContain('p_requested_status')});
test('final certification phase is database-derived',()=>{expect(hard).toContain('domain11k_finalize_certification(
 p_certification_run_id uuid
)');expect(hard).not.toContain('p_phase text')});
test('gate evidence binds release identity',()=>{for(const x of['releaseCandidateId','gitCommitSha','releaseManifestSha256','GATE_EVIDENCE_WRONG_RELEASE'])expect(hard).toContain(x)});
test('rollback and deployment evidence are certification-run bound',()=>{expect(hard).toContain('certification_run_id');expect(hard).toContain('DEPLOYMENT_CERTIFICATION_RUN_MISMATCH');expect(hard).toContain('ROLLBACK_CERTIFICATION_RUN_REQUIRED')});
