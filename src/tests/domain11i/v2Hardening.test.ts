import fs from'node:fs';import path from'node:path';
describe('11I V2 hardening contract',()=>{
 const h=fs.readFileSync(path.join(__dirname,'../../../sql/1109_domain11i_v2_hardening.sql'),'utf8');
 const s=fs.readFileSync(path.join(__dirname,'../../../sql/1109_domain11i_v2_slo_engine.sql'),'utf8');
 const d=fs.readFileSync(path.join(__dirname,'../../../sql/1109_domain11i_v2_drift_engine.sql'),'utf8');
 test('database derives governed SLO window',()=>expect(h).toContain('domain11i_v2_resolve_window'));
 test('short and long burns are independently calculated',()=>{expect(s).toContain('short_burn_window_seconds');expect(s).toContain('long_burn_window_seconds');expect(s).not.toContain('VALUES(bid,bstate,burnstate,CASE');});
 test('burn thresholds come from 11D config',()=>{expect(h).toContain("burnElevatedThreshold");expect(h).toContain("burnFastThreshold");expect(h).toContain("burnCriticalThreshold")});
 test('unsupported EWMA removed from V2 authority',()=>expect(h).not.toMatch(/methodology text NOT NULL CHECK\(methodology IN\([^)]*EWMA/));
 test('baseline direct admin insert revoked',()=>expect(d).toContain('REVOKE INSERT ON arb.drift_baselines_11i'));
 test('directionality is governed',()=>{expect(d).toContain('HIGHER_IS_BAD');expect(d).toContain('LOWER_IS_BAD');expect(d).toContain('TWO_SIDED')});
 test('11E accountability is invoked',()=>{expect(s).toContain('domain11e_record_audit_event_service');expect(d).toContain('domain11e_record_audit_event_service')});
 test('material states emit domain/outbox events',()=>{expect(s).toContain('arb.domain_events');expect(s).toContain('arb.outbox_events')});
});