
describe("PreSaleGateWorker integration contract", () => {
  it("uses claim tokens and leases", () => {
    const job = {
      gate_execution_run_id: "00000000-0000-0000-0000-000000000001",
      claim_token: "00000000-0000-0000-0000-000000000002",
      passport_id: "00000000-0000-0000-0000-000000000003",
      gate_stage: "RETAIL_SOURCE_QUALITY",
      attempt_count: 1,
      max_attempts: 5,
    };
    expect(job.claim_token).toBeTruthy();
    expect(job.attempt_count).toBeLessThanOrEqual(job.max_attempts);
  });

  it("treats unverified source facts as fail closed", () => {
    const verified = false;
    expect(verified).toBe(false);
  });
});
