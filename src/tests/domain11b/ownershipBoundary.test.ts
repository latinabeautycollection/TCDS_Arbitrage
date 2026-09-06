import fs from "node:fs";
import path from "node:path";
describe("11B ownership boundary",()=>{
  it("does not write downstream authority tables",()=>{const root=path.resolve(__dirname,"../../../");const files=["src/domains/governance/repositories/healthObservationRepository.ts","src/domains/governance/repositories/healthRegistryRepository.ts"].map(f=>fs.readFileSync(path.join(root,f),"utf8")).join("\n");for(const name of ["readiness_assessments","readiness_dependencies","capital_safety_assessments","control_decisions","control_actions"]) expect(files).not.toMatch(new RegExp(`(insert\\s+into|update|delete\\s+from)\\s+arb\\.${name}`,"i"));});
});
