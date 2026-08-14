
describe("Domain 8G approval stage-role binding", () => {
  const mapping = {
    TECHNICAL: "DOMAIN8_TECHNICAL_APPROVER",
    SECURITY: "DOMAIN8_SECURITY_APPROVER",
    OPERATIONS: "DOMAIN8_OPERATIONS_APPROVER",
    RISK: "DOMAIN8_RISK_APPROVER",
    BUSINESS: "DOMAIN8_BUSINESS_APPROVER",
    EXECUTIVE: "DOMAIN8_EXECUTIVE_APPROVER",
  } as const;

  it("has exactly one distinct role per stage", () => {
    expect(Object.keys(mapping)).toHaveLength(6);
    expect(new Set(Object.values(mapping)).size).toBe(6);
  });
});
