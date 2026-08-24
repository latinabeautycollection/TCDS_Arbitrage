import { readFileSync,readdirSync } from "node:fs";
import path from "node:path";

function walk(dir:string):string[]{
  return readdirSync(dir,{withFileTypes:true}).flatMap((entry)=>
    entry.isDirectory()?walk(path.join(dir,entry.name)):[path.join(dir,entry.name)]
  );
}

describe("10C production overlay constraints",()=>{
  it("does not ship a competing root package or tsconfig",()=>{
    expect(()=>readFileSync("package.json","utf8")).toThrow();
    expect(()=>readFileSync("tsconfig.json","utf8")).toThrow();
  });

  it("contains no NodeNext .js suffix imports",()=>{
    for(const file of walk("src/domains/operations/delivery").filter(x=>x.endsWith(".ts"))){
      expect(readFileSync(file,"utf8")).not.toMatch(/from\s+["'][^"']+\.js["']/);
    }
  });

  it("does not duplicate 10A/10B runtime filenames",()=>{
    const forbidden=[
      "operationsRuntime.ts",
      "notificationPlanningWorker.ts",
      "operationalEventEngine.ts",
      "notificationDecisionEngine.ts",
      "emailDeliveryWorker.ts",
      "microsoftGraphEmailProvider.ts",
      "telnyxSmsProvider.ts"
    ];
    const names=walk("src/domains/operations/delivery").map(x=>path.basename(x));
    for(const name of forbidden) expect(names).not.toContain(name);
  });
});
