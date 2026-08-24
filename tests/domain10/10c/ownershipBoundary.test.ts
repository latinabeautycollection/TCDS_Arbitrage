import { readFileSync } from "node:fs";

describe("10C ownership boundary",()=>{
  it("does not create 10A or 10B authoritative tables",()=>{
    const sql=readFileSync("database/migrations/516_domain10_delivery_orchestration.sql","utf8");
    const forbidden=[
      "CREATE TABLE operations.operational_events",
      "CREATE TABLE operations.notification_requests",
      "CREATE TABLE operations.notification_deliveries",
      "CREATE TABLE operations.notification_outbox",
      "CREATE TABLE operations.notification_decisions",
      "CREATE TABLE operations.sms_subscriptions"
    ];
    for(const token of forbidden) expect(sql).not.toContain(token);
  });

  it("reuses reviewed 10A provider acceptance and final delivery functions",()=>{
    const sql=readFileSync("database/migrations/516_domain10_delivery_orchestration.sql","utf8");
    expect(sql).toContain("operations.record_provider_acceptance");
    expect(sql).toContain("operations.record_final_delivery");
    expect(sql).toContain("operations.sms_delivery_currently_eligible");
  });
});
