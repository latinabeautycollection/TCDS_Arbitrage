import { readFileSync } from "node:fs";
describe("10F SQL ownership",()=>{
 it("does not recreate prior slice truth",()=>{
  const sql=readFileSync("database/migrations/529_domain10_enterprise_certification.sql","utf8");
  for(const token of [
    "CREATE TABLE operations.notification_deliveries","CREATE TABLE operations.notification_decisions",
    "CREATE TABLE operations.delivery_reconciliation_tasks_10c","CREATE TABLE operations.incidents",
    "CREATE TABLE operations.incident_escalation_emissions_10d","CREATE TABLE operations.communication_assurance_runs_10e"
  ]) expect(sql).not.toContain(token);
 });
});
