import { readFileSync } from "node:fs";

describe("10D reviewed ownership boundary",()=>{
  it("does not recreate 10A/10B/10C authoritative tables",()=>{
    const sql=[
      readFileSync("database/migrations/519_domain10_incident_lifecycle_escalation.sql","utf8"),
      readFileSync("database/migrations/520_domain10_incident_lifecycle_hardening.sql","utf8"),
      readFileSync("database/migrations/522_domain10_10d_review_hardening.sql","utf8")
    ].join("\n");

    const forbidden=[
      "CREATE TABLE operations.operational_events",
      "CREATE TABLE operations.notification_requests",
      "CREATE TABLE operations.notification_deliveries",
      "CREATE TABLE operations.notification_outbox",
      "CREATE TABLE operations.notification_decisions",
      "CREATE TABLE operations.sms_subscriptions",
      "CREATE TABLE operations.incidents",
      "CREATE TABLE operations.incident_events",
      "CREATE TABLE operations.incident_assignments",
      "CREATE TABLE operations.incident_acknowledgements",
      "CREATE TABLE operations.incident_escalations",
      "CREATE TABLE operations.incident_escalation_executions"
    ];

    for(const token of forbidden) expect(sql).not.toContain(token);
  });

  it("contains no direct Graph or Telnyx provider import in incident runtime",()=>{
    const integration=readFileSync(
      "src/domains/operations/incidents/adapters/notificationDecisionAdapter.ts",
      "utf8"
    );
    expect(integration).not.toMatch(/microsoftGraphEmailProvider|telnyxSmsProvider/);
  });
});
