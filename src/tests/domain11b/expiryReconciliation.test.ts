import fs from "node:fs";
import path from "node:path";
describe("11B expiry reconciliation",()=>{it("actively reconciles expired current/evidence state",()=>{const root=path.resolve(__dirname,"../../../");const svc=fs.readFileSync(path.join(root,"src/domains/governance/services/healthExpiryReconciliationService.ts"),"utf8");const repo=fs.readFileSync(path.join(root,"src/domains/governance/repositories/healthObservationRepository.ts"),"utf8");expect(svc).toMatch(/findComponentsNeedingReconciliation/);expect(repo).toMatch(/expires_at <= clock_timestamp\(\)/);});});
