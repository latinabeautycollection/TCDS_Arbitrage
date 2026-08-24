import { readFileSync } from "node:fs";

describe("production repository overlay constraints",()=>{
  it("does not ship a competing root package or tsconfig in the production overlay",()=>{
    expect(()=>readFileSync("package.json","utf8")).toThrow();
    expect(()=>readFileSync("tsconfig.json","utf8")).toThrow();
  });

  it("uses no local .js import suffixes in TypeScript source",()=>{
    const fs=require("node:fs");
    const path=require("node:path");
    const walk=(d:string):string[]=>fs.readdirSync(d,{withFileTypes:true}).flatMap((e:any)=>
      e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
    for(const file of walk("src/domains/operations").filter((x:string)=>x.endsWith(".ts"))){
      expect(fs.readFileSync(file,"utf8")).not.toMatch(/from\s+["'][^"']+\.js["']/);
    }
  });
});
