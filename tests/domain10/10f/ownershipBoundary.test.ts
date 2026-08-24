import { readFileSync,readdirSync } from "node:fs";
import path from "node:path";
function walk(dir:string):string[]{return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}

describe("10F ownership boundary",()=>{
  it("contains no provider, notification-decision, incident, assurance execution imports",()=>{
    for(const file of walk("src/domains/operations/domain10Certification").filter(x=>x.endsWith(".ts"))){
      expect(readFileSync(file,"utf8")).not.toMatch(/microsoftGraphEmailProvider|telnyxSmsProvider|runDeliveryOrchestrationBatch|applyIncidentCommand|transitionIncident|runAssuranceEvaluationBatch/);
    }
  });
  it("creates no worker",()=>{
    expect(walk("src/domains/operations/domain10Certification").map(x=>path.basename(x)).some(x=>/worker/i.test(x))).toBe(false);
  });
});
