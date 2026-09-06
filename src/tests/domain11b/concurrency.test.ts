import fs from "node:fs";
import path from "node:path";
describe("11B concurrency contracts",()=>{
  it("uses SKIP LOCKED leasing and component advisory locks",()=>{const root=path.resolve(__dirname,"../../../");const registry=fs.readFileSync(path.join(root,"src/domains/governance/repositories/healthRegistryRepository.ts"),"utf8");const obs=fs.readFileSync(path.join(root,"src/domains/governance/repositories/healthObservationRepository.ts"),"utf8");expect(registry).toMatch(/FOR UPDATE OF r SKIP LOCKED/i);expect(obs).toMatch(/pg_advisory_xact_lock/i);});
});
