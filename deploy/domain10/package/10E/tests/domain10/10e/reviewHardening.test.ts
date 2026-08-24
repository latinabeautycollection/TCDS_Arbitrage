import { readFileSync } from "node:fs";
describe("10E reviewed hardening",()=>{
  const sql=readFileSync("database/migrations/527_domain10_communication_assurance_review_hardening.sql","utf8");
  it("delays evaluation by maturity rather than truncating the cohort",()=>{
    expect(sql).toContain("v_latest_mature_end");
    expect(sql).not.toContain("created_at<=cutoff");
  });
  it("has catchup and bounded retry",()=>{
    expect(sql).toContain("v_last_end");
    expect(sql).toContain("max_attempts");
  });
  it("verifies 10B event linkage",()=>{
    expect(sql).toContain("DOMAIN10_ASSURANCE");
    expect(sql).toContain("source_event_id");
  });
});
