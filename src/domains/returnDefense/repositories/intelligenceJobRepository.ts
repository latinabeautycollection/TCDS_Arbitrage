
import type { Pool, PoolClient } from "pg";
import type { RequestContext } from "./preventionControlPlaneRepository";
import type { IntelligenceJob } from "../intelligence/intelligenceTypes";

export class IntelligenceJobRepository {
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
      const value = await work(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  public claim(context: RequestContext, workerId: string, limit: number, leaseSeconds: number) {
    return this.transaction(context, async client => (
      await client.query<IntelligenceJob>(
        "select * from return_defense.claim_intelligence_jobs_v2($1,$2,make_interval(secs=>$3::int))",
        [workerId,limit,leaseSeconds],
      )
    ).rows);
  }
  public start(context:RequestContext,job:IntelligenceJob,workerId:string) {
    return this.transaction(context, async client => {
      await client.query("select return_defense.start_intelligence_job($1::uuid,$2::uuid,$3)",
        [job.intelligence_job_id,job.claim_token,workerId]);
    });
  }
  public heartbeat(context:RequestContext,job:IntelligenceJob,leaseSeconds:number) {
    return this.transaction(context, async client => {
      await client.query("select return_defense.heartbeat_intelligence_job_v2($1::uuid,$2::uuid,make_interval(secs=>$3::int))",
        [job.intelligence_job_id,job.claim_token,"domain8-8f-worker",leaseSeconds]);
    });
  }
  public complete(context:RequestContext,job:IntelligenceJob,workerId:string,result:Record<string,unknown>) {
    return this.transaction(context, async client => {
      await client.query("select return_defense.complete_intelligence_job($1::uuid,$2::uuid,$3,$4::jsonb)",
        [job.intelligence_job_id,job.claim_token,workerId,JSON.stringify(result)]);
    });
  }
  public fail(context:RequestContext,job:IntelligenceJob,errorClass:string,errorMessage:string,retryable:boolean) {
    return this.transaction(context, async client => (
      await client.query<{status:string}>(
        "select return_defense.fail_intelligence_job($1::uuid,$2::uuid,$3,$4,$5) status",
        [job.intelligence_job_id,job.claim_token,errorClass,errorMessage,retryable],
      )
    ).rows[0]!.status);
  }
}
