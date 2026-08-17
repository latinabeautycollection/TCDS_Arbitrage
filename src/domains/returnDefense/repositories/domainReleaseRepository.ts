
import type { Pool, PoolClient } from "pg";
import type { ReleaseRequestContext as RequestContext } from "../certification/releaseRequestContext";
import type { ReleaseJob } from "../certification/releaseTypes";

export class DomainReleaseRepository {
  public constructor(private readonly pool: Pool) {}

  public async transaction<T>(
    context: RequestContext,
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("select set_config('app.tenant_id',$1,true)", [context.tenantId]);
      await client.query("select set_config('app.actor_id',$1,true)", [context.actorId]);
      await client.query("select set_config('app.correlation_id',$1,true)", [context.correlationId]);
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public claim(
    context: RequestContext,
    workerId: string,
    limit: number,
  ): Promise<ReleaseJob[]> {
    return this.transaction(context, async (client) => {
      const result = await client.query<ReleaseJob>(
        "select * from return_defense.claim_domain_release_jobs_v2($1,$2,interval '10 minutes')",
        [workerId, limit],
      );
      return result.rows;
    });
  }

  public complete(
    context: RequestContext,
    job: ReleaseJob,
    workerId: string,
    result: Record<string, unknown>,
  ): Promise<void> {
    return this.transaction(context, async (client) => {
      await client.query(
        "select return_defense.complete_domain_release_job($1::uuid,$2::uuid,$3,$4::jsonb)",
        [
          job.domain_release_job_id,
          job.claim_token,
          workerId,
          JSON.stringify(result),
        ],
      );
    });
  }
}
