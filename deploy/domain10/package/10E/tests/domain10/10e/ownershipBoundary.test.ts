import { readFileSync,readdirSync } from "node:fs";
import path from "node:path";

function walk(dir:string):string[]{
  return readdirSync(dir,{withFileTypes:true}).flatMap((e)=>
    e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]
  );
}

describe("10E ownership boundary",()=>{
  it("does not recreate 10A-10D authoritative tables",()=>{
    const sql=[
      readFileSync("database/migrations/524_domain10_communication_assurance.sql","utf8"),
      readFileSync("database/migrations/525_domain10_communication_assurance_hardening.sql","utf8")
    ].join("\n");

    const forbidden=[
      "CREATE TABLE operations.notification_requests",
      "CREATE TABLE operations.notification_deliveries",
      "CREATE TABLE operations.notification_decisions",
      "CREATE TABLE operations.delivery_reconciliation_tasks_10c",
      "CREATE TABLE operations.incidents",
      "CREATE TABLE operations.incident_events",
      "CREATE TABLE operations.incident_escalation_runtime_10d"
    ];
    for(const token of forbidden) expect(sql).not.toContain(token);
  });

  it("contains no direct provider or incident-command imports",()=>{
    for(const file of walk("src/domains/operations/assurance").filter(x=>x.endsWith(".ts"))){
      const text=readFileSync(file,"utf8");
      expect(text).not.toMatch(/microsoftGraphEmailProvider|telnyxSmsProvider|applyIncidentCommand|runDeliveryOrchestrationBatch/);
    }
  });
});
