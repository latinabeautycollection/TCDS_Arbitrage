import fs from 'node:fs';import path from 'node:path';
describe('Domain 11H V3 authority architecture',()=>{
 const sql=fs.readFileSync(path.join(__dirname,'../../../sql/1108_domain11h_v3_hardening.sql'),'utf8');
 test('runtime caller cannot supply financial facts to V3 wrappers',()=>{
  const user=sql.match(/domain11h_publish_snapshot_user_v3\(([^)]*)\)/)?.[1]??'';
  expect(user).not.toMatch(/p_sources|p_expected_identity_count|p_numeric_value|p_metric_state/);
 });
 test('PostgreSQL resolves authoritative sources from allow-listed adapters',()=>{
  expect(sql).toContain('metric_source_adapter_registry');expect(sql).toContain('domain11h_resolve_authoritative_sources_v3');expect(sql).toContain('source_relation regclass');
 });
 test('calculator binding uses actual function definition SHA',()=>{
  expect(sql).toContain('pg_get_functiondef');expect(sql).toContain('metric_definition_calculator_bindings');expect(sql).toContain('calculator implementation drift');
 });
 test('USER and SERVICE wrappers are separate',()=>{
  expect(sql).toContain('domain11h_publish_snapshot_user_v3');expect(sql).toContain('domain11h_publish_snapshot_service_v3');
  expect(sql).toContain('tcds_governance_kpi_user_runtime');expect(sql).toContain('tcds_governance_kpi_service_runtime');
 });
 test('V1 caller-trusted publisher is revoked',()=>expect(sql).toContain('REVOKE EXECUTE ON FUNCTION arb.domain11h_persist_snapshot'));
});
