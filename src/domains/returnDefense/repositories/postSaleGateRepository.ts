
import type { Pool, PoolClient } from "pg";
import type { RequestContext } from "./preventionControlPlaneRepository";

export interface PostSaleGateJob {
  post_sale_gate_execution_run_id: string;
  passport_id: string;
  gate_stage: string;
  claim_token: string;
  attempt_count: number;
  max_attempts: number;
}

export class PostSaleGateRepository {
  public constructor(private readonly pool: Pool) {}

  private async tx<T>(
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

  public claim(
    context: RequestContext,
    workerId: string,
    limit: number,
    leaseSeconds: number,
  ): Promise<PostSaleGateJob[]> {
    return this.tx(context, async (client) => {
      const result = await client.query<PostSaleGateJob>(
        `select * from return_defense.claim_post_sale_gates(
          $1,$2,make_interval(secs=>$3::int)
        )`,
        [workerId, limit, leaseSeconds],
      );
      return result.rows;
    });
  }

  public heartbeat(
    context: RequestContext,
    job: PostSaleGateJob,
    leaseSeconds: number,
  ): Promise<void> {
    return this.tx(context, async (client) => {
      await client.query(
        `select return_defense.heartbeat_post_sale_gate(
          $1::uuid,$2::uuid,make_interval(secs=>$3::int)
        )`,
        [job.post_sale_gate_execution_run_id, job.claim_token, leaseSeconds],
      );
    });
  }

  public execute(
    context: RequestContext,
    job: PostSaleGateJob,
    workerId: string,
  ): Promise<string> {
    return this.tx(context, async (client) => {
      const result = await client.query<{ decision_id: string }>(
        `select return_defense.execute_post_sale_gate_atomic_v2(
          $1::uuid,$2::uuid,$3,interval '15 minutes',interval '15 minutes'
        ) decision_id`,
        [job.post_sale_gate_execution_run_id, job.claim_token, workerId],
      );
      return result.rows[0]!.decision_id;
    });
  }

  public fail(
    context: RequestContext,
    job: PostSaleGateJob,
    errorClass: string,
    message: string,
    retryable: boolean,
    details: Record<string, unknown>,
  ): Promise<string> {
    return this.tx(context, async (client) => {
      const result = await client.query<{ status: string }>(
        `select return_defense.fail_post_sale_gate(
          $1::uuid,$2::uuid,$3,$4,$5,$6::jsonb
        ) status`,
        [
          job.post_sale_gate_execution_run_id,
          job.claim_token,
          errorClass,
          message,
          retryable,
          JSON.stringify(details),
        ],
      );
      return result.rows[0]!.status;
    });
  }
}
