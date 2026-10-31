import { describe, expect, it } from "vitest";
import { MissingCapturePolicyAuthority } from "../../src/lib/scanning/workflow/policy/CapturePolicyAuthority";

describe("6.2C hard dependency", () => {
  it("fails closed when certified policy authority is unavailable", async () => {
    const authority = new MissingCapturePolicyAuthority();
    await expect(authority.resolveIntentPolicy()).rejects.toThrow("CAPTURE_POLICY_UNAVAILABLE");
  });
});
