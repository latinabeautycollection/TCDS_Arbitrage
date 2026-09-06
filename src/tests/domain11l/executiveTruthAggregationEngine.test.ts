import { ExecutiveTruthAggregationEngine } from '../../domains/governance/executive/engines/executiveTruthAggregationEngine';
const e=(slice:string,over:Record<string,unknown>={})=>({slice,certificationState:'CERTIFIED',state:'GREEN',authoritative:true,contradictory:false,freshUntil:'2099-01-01T00:00:00Z',details:{},...over});
describe('ExecutiveTruthAggregationEngine',()=>{const x=new ExecutiveTruthAggregationEngine();
 test('missing evidence stays UNKNOWN',()=>expect(x.classify([e('11A')])).toBe('UNKNOWN'));
 test('11J enforcement failure is BLOCKED',()=>{const a='ABCDEFGHIJK'.split('').map(c=>e(`11${c}`));(a[9] as any).details={criticalEnforcementFailure:true};expect(x.classify(a)).toBe('BLOCKED')});
 test('release mismatch is BLOCKED',()=>{const a='ABCDEFGHIJK'.split('').map(c=>e(`11${c}`));(a[10] as any).details={activeReleaseMatchesCertifiedRelease:false};expect(x.classify(a)).toBe('BLOCKED')});
 test('stale evidence stays UNKNOWN',()=>{const a='ABCDEFGHIJK'.split('').map(c=>e(`11${c}`));(a[1] as any).freshUntil='2000-01-01T00:00:00Z';expect(x.classify(a)).toBe('UNKNOWN')});
});
