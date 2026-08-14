
import { DomainReleaseDispatcher } from "../certification/domainReleaseDispatcher";

describe("DomainReleaseDispatcher", () => {
  it("executes release work through the atomic database function", async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [{ result: { ready: true } }],
    });
    const dispatcher = new DomainReleaseDispatcher();
    const result = await dispatcher.dispatch(
      { query } as never,
      {
        domain_release_job_id: "00000000-0000-0000-0000-000000000001",
        domain_release_contract_id: "00000000-0000-0000-0000-000000000002",
        job_type: "FINAL_RELEASE_ASSESSMENT",
        claim_token: "00000000-0000-0000-0000-000000000003",
        attempt_count: 1,
        max_attempts: 5,
        job_payload: {},
      },
      "test-worker",
      "8G.1.2",
    );
    expect(result).toEqual({ ready: true });
    expect(query).toHaveBeenCalledTimes(1);
  });
});
