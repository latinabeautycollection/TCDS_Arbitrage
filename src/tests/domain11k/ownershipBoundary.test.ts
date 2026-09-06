import fs from'node:fs';import path from'node:path';
const sql=['1111_domain11k_release_certification.sql','1111_domain11k_engine.sql','1111_domain11k_freeze_hardening_v2.sql'].map(f=>fs.readFileSync(path.join(__dirname,'../../../sql',f),'utf8')).join('\n');
test('11K reuses 11A replay and certification tables',()=>{for(const n of['replay_runs','replay_results','certification_runs','certification_evidence'])expect(sql).not.toMatch(new RegExp(`CREATE TABLE\\s+arb\\.${n}\\b`,'i'))});
test('11K does not mutate upstream truth',()=>{for(const n of['readiness_assessments','capital_safety_assessments','metric_snapshots','slo_measurements','control_decisions','control_actions'])expect(sql).not.toMatch(new RegExp(`(?:INSERT|UPDATE|DELETE)\\s+(?:INTO\\s+)?arb\\.${n}\\b`,'i'))});
