import { riskTierForScore } from "../engines/riskTierEngine";
describe("riskTierForScore", () => {
  test.each([
    [0,"GREEN"],[19.999,"GREEN"],[20,"GUARDED"],[40,"ELEVATED"],
    [60,"HIGH"],[80,"CRITICAL"],[100,"CRITICAL"],
  ])("%s => %s", (score, tier) => {
    expect(riskTierForScore(score as number)).toBe(tier);
  });
  it("rejects invalid scores", () => {
    expect(() => riskTierForScore(101)).toThrow(RangeError);
  });
});
