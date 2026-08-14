
import crypto from "node:crypto";
import type { RequestContext } from "../repositories/preventionControlPlaneRepository";
import {
  AuthoritativeGateRepository,
} from "../repositories/authoritativeGateRepository";
import type {
  GateExecutionJob,
  GateWorkerOptions,
} from "../contracts/preSaleGateExecution";
import { returnDefenseLogger } from "../observability/returnDefenseLogger";

function isRetryable(error: unknown): boolean {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
  return ["40001", "40P01", "55P03", "57014", "08006"].includes(code);
}

export class PreSaleGateWorker {
  public constructor(
    private readonly repository: AuthoritativeGateRepository,
    private readonly options: GateWorkerOptions,
  ) {}

  public async poll(tenantId: string, actorId: string): Promise<number> {
    const context: RequestContext = {
      tenantId,
      actorId,
      correlationId: crypto.randomUUID(),
    };

    const jobs = await this.repository.claim(
      context,
      this.options.workerId,
      this.options.batchSize,
      this.options.leaseSeconds,
    );

    for (const job of jobs) {
      await this.processJob(context, job);
    }
    return jobs.length;
  }

  private async processJob(
    baseContext: RequestContext,
    job: GateExecutionJob,
  ): Promise<void> {
    const context = {
      ...baseContext,
      correlationId: crypto.randomUUID(),
    };

    const heartbeat = setInterval(() => {
      void this.repository
        .heartbeat(context, job, this.options.leaseSeconds)
        .catch((error: unknown) => {
          returnDefenseLogger.error(
            { error, runId: job.gate_execution_run_id },
            "gate heartbeat failed",
          );
        });
    }, this.options.heartbeatSeconds * 1000);

    try {
      const decisionId = await this.repository.execute(
        context,
        job,
        this.options.workerId,
      );
      returnDefenseLogger.info(
        {
          runId: job.gate_execution_run_id,
          gate: job.gate_stage,
          decisionId,
        },
        "pre-sale gate completed",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const errorClass =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code?: unknown }).code ?? "UNKNOWN")
          : "UNKNOWN";

      await this.repository.fail(
        context,
        job,
        errorClass,
        message,
        isRetryable(error),
        { gateStage: job.gate_stage },
      );

      returnDefenseLogger.error(
        { error, runId: job.gate_execution_run_id, gate: job.gate_stage },
        "pre-sale gate failed",
      );
    } finally {
      clearInterval(heartbeat);
    }
  }
}
