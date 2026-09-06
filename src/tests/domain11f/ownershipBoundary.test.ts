import fs from 'node:fs';import path from 'node:path';
describe('Domain11F ownership firewall',()=>{
  const sql=fs.readFileSync(path.join(__dirname,'../../../sql/1106_domain11f_capital_safety.sql'),'utf8');
  test('reuses 11A capital safety table',()=>expect(sql).toContain('arb.capital_safety_assessments'));
  test('does not create a competing capital assessment table',()=>expect(sql).not.toMatch(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?arb\.capital_safety_assessments/i));
  test('does not mutate Domain2 allocation authority',()=>expect(sql).not.toMatch(/(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+arb\.capital_allocation_(?:runs|items)/i));
  test('does not mutate legacy prong2 capital safety',()=>expect(sql).not.toMatch(/(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+arb\.capital_safety_(?:assessment|policy)/i));
  test('does not write 11B health or 11C readiness',()=>expect(sql).not.toMatch(/(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+arb\.(?:health_state_current|health_observations|readiness_assessments|readiness_state_current)/i));
  test('does not write 11D policies or 11J controls',()=>expect(sql).not.toMatch(/(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+arb\.(?:governance_policy_versions|control_decisions|control_actions)/i));
});
