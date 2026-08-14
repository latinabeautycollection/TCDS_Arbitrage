
import type { Pool } from "pg";
import type { ReleaseRequestContext as RequestContext } from "../certification/releaseRequestContext";
import { DomainReleaseRepository } from "../repositories/domainReleaseRepository";
import { DomainReleaseAssessmentEngine } from "../certification/domainReleaseAssessmentEngine";

export class DomainReleaseService {
  private readonly repository: DomainReleaseRepository;
  private readonly assessment = new DomainReleaseAssessmentEngine();

  public constructor(pool: Pool) {
    this.repository = new DomainReleaseRepository(pool);
  }

  public assess(context: RequestContext, releaseId: string) {
    return this.repository.transaction(
      context,
      (client) => this.assessment.assess(client, releaseId),
    );
  }
}
