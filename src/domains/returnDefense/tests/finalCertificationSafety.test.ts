import fs from "node:fs";
import path from "node:path";

describe("8G.1.3 final certification safety", () => {
  it("keeps the legacy 8G.1.2 final-certification entrypoint blocked", () => {
    const script = fs.readFileSync(
      path.resolve("scripts/certify-domain8-8g-final.sh"),
      "utf8",
    );
    expect(script).toContain("BLOCKED");
    expect(script).not.toContain("UPDATE return_defense.schema_contract_versions");
  });

  it("requires the authoritative 8G.1.3 runner", () => {
    const script = fs.readFileSync(
      path.resolve("scripts/certify-domain8-full-8g13.sh"),
      "utf8",
    );
    expect(script).toContain("finish_domain_release_certification");
    expect(script).toContain("run-domain8-rollback-rehearsal.sh");
    expect(script).toContain("validate-domain8-post-release-8g13.sh");
    expect(script).toContain("certify_domain8_final");
  });
});
