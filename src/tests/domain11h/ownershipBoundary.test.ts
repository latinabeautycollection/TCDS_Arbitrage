import fs from 'node:fs';import path from 'node:path';
describe('11H V3 ownership firewall',()=>{
 const files=['1108_domain11h_business_kpi_profit_assurance.sql','1108_domain11h_v3_hardening.sql','1108_domain11h_v3_seed.sql'].map(f=>fs.readFileSync(path.join(__dirname,'../../../sql',f),'utf8')).join('\n');
 test('does not create a second 11A metric snapshot table',()=>expect(files).not.toMatch(/CREATE TABLE\s+arb\.metric_snapshots\b/i));
 test('does not mutate business domain tables',()=>expect(files).not.toMatch(/(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+arb\./i));
 test('does not create SLO/control authority',()=>expect(files).not.toMatch(/CREATE TABLE\s+arb\.(?:slo_|error_budget|control_)/i));
});
