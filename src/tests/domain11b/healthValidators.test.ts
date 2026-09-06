import { parseCorrelationId, parsePushHealthSignal } from "../../domains/governance/validators/healthValidators";
describe("health validators",()=>{
  it("rejects invalid correlation IDs",()=>expect(()=>parseCorrelationId("bananas")).toThrow());
  it("accepts valid push signal",()=>expect(parsePushHealthSignal({definitionId:"00000000-0000-4000-8000-000000000001",componentId:"00000000-0000-4000-8000-000000000002",sourceEventId:"evt-1",outcome:"SUCCESS",observedAt:"2026-01-01T00:00:00Z",evidence:{ok:true}}).outcome).toBe("SUCCESS"));
});
