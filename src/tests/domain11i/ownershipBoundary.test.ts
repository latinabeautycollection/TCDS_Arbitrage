import fs from'node:fs';import path from'node:path';
describe('11I V2 ownership',()=>{
 const base=fs.readFileSync(path.join(__dirname,'../../../sql/1109_domain11i_reliability_governance.sql'),'utf8');
 const hard=fs.readFileSync(path.join(__dirname,'../../../sql/1109_domain11i_v2_hardening.sql'),'utf8');
 const slo=fs.readFileSync(path.join(__dirname,'../../../sql/1109_domain11i_v2_slo_engine.sql'),'utf8');
 test('reuses 11A SLO persistence',()=>{expect(base).not.toMatch(/CREATE TABLE\s+arb\.slo_measurements\b/i);expect(base).not.toMatch(/CREATE TABLE\s+arb\.error_budgets\b/i)});
 test('does not create 11J control authority',()=>expect(base+hard+slo).not.toMatch(/CREATE TABLE\s+arb\.control_(decisions|actions)/i));
 test('V2 does not mutate 11G or 11H facts',()=>{expect(hard+slo).not.toMatch(/(INSERT|UPDATE|DELETE)\s+(INTO\s+)?arb\.observability_observations/i);expect(hard+slo).not.toMatch(/(INSERT|UPDATE|DELETE)\s+(INTO\s+)?arb\.metric_snapshots/i)});
 test('material reliability events target 11J by outbox only',()=>expect(slo).toContain("'DOMAIN11J_CONTROL'"));
});
