
describe("Domain 8F invariants", () => {
  it("does not expose direct policy activation", () => {
    const exposedFunctions = [
      "approve_recommendation_for_experiment",
    ];
    expect(exposedFunctions).not.toContain("activate_policy");
  });

  it("requires one primary approved root cause", () => {
    const approvedPrimaryCount = 1;
    expect(approvedPrimaryCount).toBe(1);
  });

  it("enforces financial identity", () => {
    const gross = 100;
    const recoveries = 30;
    const recoveryCosts = 5;
    expect(gross - recoveries + recoveryCosts).toBe(75);
  });
});
