import fs from'node:fs';import path from'node:path';
const sql=fs.readFileSync(path.join(__dirname,'../../../sql/1110_domain11j_v2_hardening.sql'),'utf8');
test('effective view exposes desired state and enforcement truth independently',()=>{expect(sql).toContain('desired_control_state');expect(sql).toContain('enforcement_status');expect(sql).toContain('enforcement_effective');expect(sql).toContain('ENFORCEMENT_FAILED_OR_PENDING')});
test('recovery decision is excluded from enforcement selection',()=>{expect(sql).toContain("WHERE d.control_state<>'RECOVERY'")});
test('final recovery locks before evidence revalidation',()=>{const f=sql.slice(sql.indexOf('domain11j_finalize_recovery_v2'),sql.indexOf('-- Function grants by exact identity.'));expect(f.indexOf('pg_advisory_xact_lock')).toBeLessThan(f.indexOf('domain11j_resolve_recovery_evidence'))});
