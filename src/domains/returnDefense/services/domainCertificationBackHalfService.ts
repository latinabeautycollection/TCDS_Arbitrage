import type { Pool } from "pg";
import type { ReleaseRequestContext } from "../certification/releaseRequestContext";
import type {
  PostReleaseChecks,
  RollbackCheckpointResult,
} from "../certification/backHalfTypes";
import { DomainReleaseRepository } from "../repositories/domainReleaseRepository";

export class DomainCertificationBackHalfService {
  private readonly repository: DomainReleaseRepository;

  public constructor(pool: Pool) {
    this.repository = new DomainReleaseRepository(pool);
  }

  public finishCertificationRun(
    context: ReleaseRequestContext,
    certificationRunId: string,
  ): Promise<"PASS" | "FAIL"> {
    return this.repository.transaction(context, async (client) => {
      const result = await client.query<{ status: "PASS" | "FAIL" }>(
        `select return_defense.finish_domain_release_certification(
          $1::uuid
        ) status`,
        [certificationRunId],
      );
      return result.rows[0]!.status;
    });
  }

  public startRollback(
    context: ReleaseRequestContext,
    input: {
      deploymentRunId: string;
      reason: string;
      strategy: "FORWARD_FIX" | "DATABASE_ROLLBACK" | "BLUE_GREEN_REVERT";
      targetApplicationCommitSha: string;
      targetDatabaseVersion: string;
      approvedBy: string;
      evidenceLocation: string;
    },
  ): Promise<string> {
    return this.repository.transaction(context, async (client) => {
      const result = await client.query<{ id: string }>(
        `select return_defense.start_domain_rollback(
          $1::uuid,$2,$3,$4,$5,$6::uuid,$7
        ) id`,
        [
          input.deploymentRunId,
          input.reason,
          input.strategy,
          input.targetApplicationCommitSha,
          input.targetDatabaseVersion,
          input.approvedBy,
          input.evidenceLocation,
        ],
      );
      return result.rows[0]!.id;
    });
  }

  public recordRollbackCheckpoint(
    context: ReleaseRequestContext,
    checkpoint: RollbackCheckpointResult,
  ): Promise<string> {
    return this.repository.transaction(context, async (client) => {
      const result = await client.query<{ id: string }>(
        `select return_defense.record_domain_rollback_checkpoint(
          $1::uuid,$2,$3,$4::jsonb,$5,$6
        ) id`,
        [
          checkpoint.rollbackRunId,
          checkpoint.checkpointCode,
          checkpoint.status,
          JSON.stringify(checkpoint.actualResult),
          checkpoint.evidenceDigest,
          checkpoint.evidenceLocation,
        ],
      );
      return result.rows[0]!.id;
    });
  }

  public completeRollback(
    context: ReleaseRequestContext,
    rollbackRunId: string,
  ): Promise<"PASS" | "FAIL"> {
    return this.repository.transaction(context, async (client) => {
      const result = await client.query<{ status: "PASS" | "FAIL" }>(
        `select return_defense.complete_domain_rollback(
          $1::uuid
        ) status`,
        [rollbackRunId],
      );
      return result.rows[0]!.status;
    });
  }

  public recordPostReleaseValidation(
    context: ReleaseRequestContext,
    input: {
      releaseId: string;
      certificationRunId: string;
      deploymentRunId: string;
      rollbackRunId: string;
      checks: PostReleaseChecks;
      evidenceDigest: string;
      evidenceLocation: string;
    },
  ): Promise<string> {
    return this.repository.transaction(context, async (client) => {
      const result = await client.query<{ id: string }>(
        `select return_defense.record_domain8_post_release_validation(
          $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::jsonb,$6,$7
        ) id`,
        [
          input.releaseId,
          input.certificationRunId,
          input.deploymentRunId,
          input.rollbackRunId,
          JSON.stringify(input.checks),
          input.evidenceDigest,
          input.evidenceLocation,
        ],
      );
      return result.rows[0]!.id;
    });
  }

  public completePreprodRehearsal(
    context: ReleaseRequestContext,
    input: {
      releaseId: string;
      certificationRunId: string;
      deploymentRunId: string;
      rollbackRunId: string;
      postReleaseValidationId: string;
    },
  ): Promise<string> {
    return this.repository.transaction(context, async (client) => {
      const result = await client.query<{ id: string }>(
        `select return_defense.complete_domain8_preprod_rehearsal_v2(
          $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid
        ) id`,
        [
          input.releaseId,
          input.certificationRunId,
          input.deploymentRunId,
          input.rollbackRunId,
          input.postReleaseValidationId,
        ],
      );
      return result.rows[0]!.id;
    });
  }

  public certifyDomain8(
    context: ReleaseRequestContext,
    releaseId: string,
    rehearsalId: string,
  ): Promise<string> {
    return this.repository.transaction(context, async (client) => {
      const result = await client.query<{ id: string }>(
        `select return_defense.certify_domain8_final(
          $1::uuid,$2::uuid
        ) id`,
        [releaseId, rehearsalId],
      );
      return result.rows[0]!.id;
    });
  }
}
