import { readFileSync,readdirSync } from "node:fs";import path from "node:path";
function walk(d:string):string[]{return readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);}
describe("10D ownership boundary",()=>{
 it("does not duplicate 10A authoritative incident tables",()=>{
  const sql=readFileSync("database/migrations/519_domain10_incident_lifecycle_escalation.sql","utf8");
  for(const token of ["CREATE TABLE operations.incidents(","CREATE TABLE operations.incident_events(","CREATE TABLE operations.incident_acknowledgements(","CREATE TABLE operations.incident_escalations(","CREATE TABLE operations.notification_requests(","CREATE TABLE operations.notification_deliveries("]){expect(sql).not.toContain(token);}
 });
 it("contains no direct Microsoft Graph or Telnyx provider imports",()=>{
  const text=walk("src/domains/operations/incidents").filter(x=>x.endsWith(".ts")).map(x=>readFileSync(x,"utf8")).join("\n");
  expect(text).not.toMatch(/microsoftGraphEmailProvider|telnyxSmsProvider|deliveryOrchestrationService/);
 });
});
