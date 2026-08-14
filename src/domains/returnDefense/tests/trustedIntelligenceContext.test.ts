
import { requireIntelligenceContext } from "../security/trustedIntelligenceContext";

describe("trusted intelligence context", () => {
  it("rejects missing authenticated principal", () => {
    expect(() => requireIntelligenceContext({} as never, ["DOMAIN8_REVIEWER"]))
      .toThrow("Authentication required");
  });
  it("rejects missing role", () => {
    expect(() => requireIntelligenceContext({
      auth:{tenantId:"t",actorId:"a",roles:[]},correlationId:"c",
    } as never,["DOMAIN8_REVIEWER"])).toThrow("Insufficient role");
  });
});
