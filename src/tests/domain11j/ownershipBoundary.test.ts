import fs from'node:fs';import path from'node:path';
describe('11J ownership boundary',()=>{
 const sql=['1110_domain11j_control_plane.sql','1110_domain11j_decision_engine.sql','1110_domain11j_recovery_and_actions.sql'].map(x=>fs.readFileSync(path.join(__dirname,'../../../sql',x),'utf8')).join('\n');
 test('reuses 11A control persistence',()=>{expect(sql).not.toMatch(/CREATE TABLE\s+arb\.control_decisions\b/i);expect(sql).not.toMatch(/CREATE TABLE\s+arb\.control_actions\b/i)});
 test('does not mutate upstream authority',()=>{for(const rel of['readiness_assessments','capital_safety_assessments','reliability_governance_events_11i_v2','metric_snapshots'])expect(sql).not.toMatch(new RegExp(`(?:INSERT|UPDATE|DELETE)\\\\s+(?:INTO\\\\s+)?arb\\\\.${rel}`,'i'))});
 test('does not implement notification delivery',()=>{expect(sql).not.toMatch(/telnyx|sendmail|smtp|graph.*sendmail/i)});
 test('no trigger consequence hardcoded in TypeScript',()=>{const svc=fs.readFileSync(path.join(__dirname,'../../domains/governance/services/controlService.ts'),'utf8');expect(svc).not.toMatch(/SLO_BREACHED.*BLOCK|CRITICAL_DRIFT.*PAUSED|CAPITAL.*BLOCKED/s)});
});