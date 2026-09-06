import fs from 'node:fs';import path from 'node:path';
describe('11G ownership firewall',()=>{
 const sql=fs.readFileSync(path.join(__dirname,'../../../sql/1107_domain11g_cross_domain_observability.sql'),'utf8');
 test('does not recreate upstream authority tables',()=>{for(const t of ['domain_events','outbox_events','mutation_ledger','audit_events','health_observations','readiness_assessments','capital_safety_assessments','metric_snapshots','slo_measurements'])expect(sql).not.toMatch(new RegExp(`CREATE TABLE\\s+arb\\.${t}\\b`,'i'));});
 test('does not mutate KPI/SLO/control authority',()=>expect(sql).not.toMatch(/(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+arb\.(?:metric_snapshots|slo_measurements|error_budgets|control_decisions|control_actions)/i));
});
