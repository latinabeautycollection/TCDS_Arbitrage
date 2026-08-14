
import type { Pool, PoolClient } from "pg";
import type { RequestContext } from "./preventionControlPlaneRepository";
import type { GateExecutionJob } from "../contracts/preSaleGateExecution";

export class AuthoritativeGateRepository {
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
  ): Promise<GateExecutionJob[]> {
    return this.tx(context, async (client) => {
      const result = await client.query<GateExecutionJob>(
        `select * from return_defense.claim_pre_sale_gates(
          $1,$2,make_interval(secs=>$3::int)
        )`,
        [workerId, limit, leaseSeconds],
      );
      return result.rows;
    });
  }

  public execute(
    context: RequestContext,
    job: GateExecutionJob,
    workerId: string,
  ): Promise<string> {
    return this.tx(context, async (client) => {
      const result = await client.query<{ decision_id: string }>(
        `select return_defense.execute_pre_sale_gate_atomic(
          $1::uuid,$2::uuid,$3,interval '15 minutes',interval '15 minutes'
        ) decision_id`,
        [job.gate_execution_run_id, job.claim_token, workerId],
      );
      return result.rows[0]!.decision_id;
    });
  }

  public heartbeat(
    context: RequestContext,
    job: GateExecutionJob,
    leaseSeconds: number,
  ): Promise<void> {
    return this.tx(context, async (client) => {
      await client.query(
        `select return_defense.heartbeat_pre_sale_gate(
          $1::uuid,$2::uuid,make_interval(secs=>$3::int)
        )`,
        [job.gate_execution_run_id, job.claim_token, leaseSeconds],
      );
    });
  }

  public fail(
    context: RequestContext,
    job: GateExecutionJob,
    errorClass: string,
    errorMessage: string,
    retryable: boolean,
    details: Record<string, unknown>,
  ): Promise<string> {
    return this.tx(context, async (client) => {
      const result = await client.query<{ status: string }>(
        `select return_defense.fail_pre_sale_gate(
          $1::uuid,$2::uuid,$3,$4,$5,$6::jsonb
        ) status`,
        [
          job.gate_execution_run_id,
          job.claim_token,
          errorClass,
          errorMessage,
          retryable,
          JSON.stringify(details),
        ],
      );
      return result.rows[0]!.status;
    });
  }
}
