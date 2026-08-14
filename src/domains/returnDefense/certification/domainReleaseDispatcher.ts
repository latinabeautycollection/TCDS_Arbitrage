
import type { PoolClient } from "pg";
import type { ReleaseJob } from "./releaseTypes";

export class DomainReleaseDispatcher {
  public async dispatch(
    client: PoolClient,
    job: ReleaseJob,
    workerId: string,
    processorVersion: string,
  ): Promise<Record<string, unknown>> {
    const result = await client.query<{ result: Record<string, unknown> }>(
      `select return_defense.execute_domain_release_job(
        $1::uuid,$2::uuid,$3,$4
      ) result`,
      [
        job.domain_release_job_id,
        job.claim_token,
        workerId,
        processorVersion,
      ],
    );
    return result.rows[0]!.result;
  }
}
