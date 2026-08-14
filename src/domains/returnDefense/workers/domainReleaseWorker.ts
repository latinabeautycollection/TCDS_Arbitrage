
import crypto from "node:crypto";
import type { ReleaseRequestContext as RequestContext } from "../certification/releaseRequestContext";
import { DomainReleaseRepository } from "../repositories/domainReleaseRepository";
import type { ReleaseJob } from "../certification/releaseTypes";
import { DomainReleaseDispatcher } from "../certification/domainReleaseDispatcher";

export class DomainReleaseWorker {
  private readonly dispatcher = new DomainReleaseDispatcher();
  private readonly processorVersion = "8G.1.2";

  public constructor(
    private readonly repository: DomainReleaseRepository,
    private readonly workerId: string,
  ) {}

  public async poll(tenantId: string, actorId: string): Promise<number> {
    const context: RequestContext = {
      tenantId,
      actorId,
      correlationId: crypto.randomUUID(),
    };
    const jobs = await this.repository.claim(context, this.workerId, 10);
    for (const job of jobs) {
      await this.process(context, job);
    }
    return jobs.length;
  }

  private async process(
    context: RequestContext,
    job: ReleaseJob,
  ): Promise<void> {
    const heartbeat = setInterval(() => {
      void this.repository.transaction(context, async (client) => {
        await client.query(
          `select return_defense.heartbeat_domain_release_job(
            $1::uuid,$2::uuid,$3,interval '10 minutes'
          )`,
          [job.domain_release_job_id,job.claim_token,this.workerId],
        );
      });
    }, 60_000);

    try {
      await this.repository.transaction(
        context,
        (client) => this.dispatcher.dispatch(
          client,
          job,
          this.workerId,
          this.processorVersion,
        ),
      );
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code?: unknown }).code ?? "UNKNOWN")
          : "UNKNOWN";
      const retryable = [
        "40001","40P01","55P03","57014","08006",
      ].includes(code);
      await this.repository.transaction(context, async (client) => {
        await client.query(
          `select return_defense.fail_domain_release_job(
            $1::uuid,$2::uuid,$3,$4,$5,$6
          )`,
          [
            job.domain_release_job_id,
            job.claim_token,
            this.workerId,
            code,
            error instanceof Error ? error.message : String(error),
            retryable,
          ],
        );
      });
    } finally {
      clearInterval(heartbeat);
    }
  }
}
