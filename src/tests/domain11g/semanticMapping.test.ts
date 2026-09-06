import { mapAuditOutcome,mapAuditSeverity } from '../../domains/governance/workers/observabilityWorkers';
describe('11A -> 11G semantic mapping',()=>{
 test.each([['SUCCESS','SUCCESS'],['DENIED','FAILURE'],['FAILED','FAILURE'],['PARTIAL','DEGRADED'],['OBSERVED','UNKNOWN']] as const)('%s maps to %s',(x,y)=>expect(mapAuditOutcome(x)).toBe(y));
 test.each([['DEBUG','DEBUG'],['INFO','INFO'],['NOTICE','INFO'],['WARNING','WARN'],['ERROR','ERROR'],['CRITICAL','CRITICAL']] as const)('%s severity maps to %s',(x,y)=>expect(mapAuditSeverity(x)).toBe(y));
});
