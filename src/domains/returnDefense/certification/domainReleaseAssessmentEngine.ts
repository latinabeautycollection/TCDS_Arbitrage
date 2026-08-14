
import type { PoolClient } from "pg";
import type { ReleaseAssessment } from "./releaseTypes";

export class DomainReleaseAssessmentEngine {
  public async assess(
    client: PoolClient,
    releaseId: string,
  ): Promise<ReleaseAssessment & Record<string, unknown>> {
    const result = await client.query<{ assessment: {
      ready:boolean;
      blocking_findings:number;
      failed_assertions:number;
      missing_evidence:string[];
      missing_runbooks:string[];
      failed_dependencies:number;
      failed_readiness_checks:number;
      restore_evidence_current:boolean;
      release_roles_present:boolean;
    } }>(
      "select return_defense.assess_domain8_release($1::uuid) assessment",
      [releaseId],
    );
    const row=result.rows[0]!.assessment;
    return {
      ready:row.ready,
      blockingFindings:row.blocking_findings,
      failedAssertions:row.failed_assertions,
      missingEvidence:row.missing_evidence,
      missingRunbooks:row.missing_runbooks,
      failedDependencies:row.failed_dependencies,
      failedReadinessChecks:row.failed_readiness_checks,
      restoreEvidenceCurrent:row.restore_evidence_current,
      releaseRolesPresent:row.release_roles_present,
    };
  }
}
