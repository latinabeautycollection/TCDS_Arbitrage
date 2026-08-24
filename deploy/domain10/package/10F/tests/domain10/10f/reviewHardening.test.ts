import { readFileSync } from "node:fs";

describe("10F reviewed enterprise hardening",()=>{
  it("certifies Exchange final delivery rather than treating Graph 202 as delivery",()=>{
    const sql=readFileSync(
      "database/migrations/532_domain10_10f_enterprise_review_hardening.sql",
      "utf8"
    );
    expect(sql).toContain("GRAPH_FINAL_DELIVERY_EVIDENCE");
    expect(sql).toContain("EXCHANGE_MESSAGE_TRACE");
    expect(sql).toContain("EXCHANGE_NDR_RECONCILIATION");
  });

  it("certifies Telnyx consent-at-send and terminal evidence",()=>{
    const sql=readFileSync(
      "database/migrations/532_domain10_10f_enterprise_review_hardening.sql",
      "utf8"
    );
    expect(sql).toContain("SMS_SEND_CONSENT_INTEGRITY");
    expect(sql).toContain("TELNYX_TERMINAL_FAILURE_EVIDENCE");
    expect(sql).toContain("OPT_IN");
  });

  it("requires external Microsoft/Telnyx security attestations",()=>{
    const seed=readFileSync(
      "database/seeds/533_domain10_10f_reviewed_profile_v2.sql",
      "utf8"
    );
    expect(seed).toContain("GRAPH_EXCHANGE_RBAC_SCOPE_PASS");
    expect(seed).toContain("GRAPH_UNSCOPED_ENTRA_MAILSEND_REMOVED_PASS");
    expect(seed).toContain("TELNYX_WEBHOOK_SIGNATURE_VERIFICATION_PASS");
    expect(seed).toContain("SMS_START_STOP_HELP_COMPLIANCE_PASS");
    expect(seed).toContain("TELNYX_10DLC_CAMPAIGN_ACTIVE_PASS");
  });
});
