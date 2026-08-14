
import crypto from "node:crypto";
import type { RequestContext } from "../repositories/preventionControlPlaneRepository";
import {
  PostSaleGateRepository,
  type PostSaleGateJob,
} from "../repositories/postSaleGateRepository";
import { returnDefenseLogger } from "../observability/returnDefenseLogger";
import type { PostSaleDefenseMetrics } from "../observability/postSaleDefenseMetrics";

function retryable(error: unknown): boolean {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
  return ["40001", "40P01", "55P03", "57014", "08006", "08001"].includes(code);
}

export class PostSaleGateWorker {
  public constructor(
    private readonly repository: PostSaleGateRepository,
    private readonly metrics: PostSaleDefenseMetrics,
    private readonly workerId: string,
    private readonly batchSize = 25,
    private readonly leaseSeconds = 300,
    private readonly heartbeatSeconds = 60,
  ) {}

  public async poll(tenantId: string, actorId: string): Promise<number> {
    const context: RequestContext = {
      tenantId,
      actorId,
      correlationId: crypto.randomUUID(),
    };

    const jobs = await this.repository.claim(
      context,
      this.workerId,
      this.batchSize,
      this.leaseSeconds,
    );

    for (const job of jobs) {
      this.metrics.gateClaimed(job.gate_stage);
      await this.process(context, job);
    }
    return jobs.length;
  }

  private async process(
    baseContext: RequestContext,
    job: PostSaleGateJob,
  ): Promise<void> {
    const context = { ...baseContext, correlationId: crypto.randomUUID() };
    const started = Date.now();

    const heartbeat = setInterval(() => {
      void this.repository
        .heartbeat(context, job, this.leaseSeconds)
        .catch((error: unknown) => {
          returnDefenseLogger.error(
            { error, runId: job.post_sale_gate_execution_run_id },
            "post-sale gate heartbeat failed",
          );
        });
    }, this.heartbeatSeconds * 1000);

    try {
      const decisionId = await this.repository.execute(context, job, this.workerId);
      this.metrics.gateCompleted(job.gate_stage, Date.now() - started);
      returnDefenseLogger.info(
        {
          runId: job.post_sale_gate_execution_run_id,
          gate: job.gate_stage,
          decisionId,
        },
        "post-sale gate completed",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const errorClass =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code?: unknown }).code ?? "UNKNOWN")
          : "UNKNOWN";

      const status = await this.repository.fail(
        context,
        job,
        errorClass,
        message,
        retryable(error),
        { gateStage: job.gate_stage },
      );
      this.metrics.gateFailed(job.gate_stage, errorClass);
      if (status === "DEAD_LETTER") {
        this.metrics.deadLettered?.(job.gate_stage);
      }
      returnDefenseLogger.error(
        { error, status, runId: job.post_sale_gate_execution_run_id },
        "post-sale gate failed",
      );
    } finally {
      clearInterval(heartbeat);
    }
  }
}
