import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd();
const migration=fs.readFileSync(path.join(root,'sql/1112_domain11l_executive_governance_final_certification.sql'),'utf8');
describe('Domain 11L V3 freeze invariants',()=>{
 test('uses one canonical evidence collector',()=>expect((migration.match(/CREATE OR REPLACE FUNCTION arb\.domain11l_collect_evidence/g)??[]).length).toBe(1));
 test('snapshot certification field is explicitly historical',()=>{expect(migration).toContain('phase3_certification_state_at_snapshot');expect(migration).not.toContain('current_phase3_certification_state text')});
 test('strict validity binds release and evidence freshness',()=>{
   expect(migration).toContain('RELEASE_BASELINE_MISMATCH');
   expect(migration).toContain('RELEASE_CERTIFICATION_BASELINE_MISMATCH');
   expect(migration).toContain("freshUntil");
   expect(migration).toContain("MIGRATION_INTEGRITY_NOT_PROVEN");
 });
 test('privileged search paths exclude public and extensions',()=>{
   expect(migration).not.toMatch(/SET search_path\s*=\s*[^;\n]*(public|extensions)/);
 });
});
