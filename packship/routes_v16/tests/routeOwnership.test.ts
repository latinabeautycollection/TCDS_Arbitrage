import fs from "fs";
import path from "path";

describe("route ownership",()=>{
  it("does not add generic scanner ingress",()=>{
    const root=path.resolve(__dirname,"../src");
    const files:string[]=[];
    function walk(p:string){for(const n of fs.readdirSync(p)){const q=path.join(p,n);const s=fs.statSync(q);s.isDirectory()?walk(q):files.push(q)}}
    walk(root);
    const text=files.filter(f=>f.endsWith(".ts")).map(f=>fs.readFileSync(f,"utf8")).join("\n");
    expect(text).not.toContain("/api/v1/warehouse/scanner/scan");
  });
});
