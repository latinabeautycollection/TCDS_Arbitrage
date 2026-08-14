
import { IntelligenceDispatcher } from "../intelligence/intelligenceDispatcher";

describe("IntelligenceDispatcher", () => {
  it("rejects unsupported job types", async () => {
    const dispatcher = new IntelligenceDispatcher();
    const client = { query: jest.fn() } as never;
    await expect(
      dispatcher.dispatch(client, {
        intelligence_job_id:"00000000-0000-0000-0000-000000000001",
        job_type:"UNKNOWN" as never,
        subject_type:"OUTCOME",
        subject_id:"00000000-0000-0000-0000-000000000002",
        claim_token:"00000000-0000-0000-0000-000000000003",
        attempt_count:1,max_attempts:8,
      }),
    ).rejects.toThrow("Unsupported intelligence job type");
  });
});
