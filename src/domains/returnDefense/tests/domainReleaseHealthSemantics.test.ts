describe("Domain 8G release health semantics", () => {
  it("separates runtime liveness from final certification readiness", () => {
    const installed = { live: true, certified: false };
    const certified = { live: true, certified: true };
    expect(installed.live).toBe(true);
    expect(installed.certified).toBe(false);
    expect(certified.certified).toBe(true);
  });
});
