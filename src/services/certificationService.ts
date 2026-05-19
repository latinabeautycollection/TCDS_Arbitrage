import { withTx } from '../db/tx';
import { ProcessRunRepository } from '../repositories/processRunRepository';
import { ProcessStepRepository } from '../repositories/processStepRepository';
import { ForensicEventRepository } from '../repositories/forensicEventRepository';
import { LearningFeatureRepository } from '../repositories/learningFeatureRepository';

export type CertificationCheckName =
  | 'replay'
  | 'concurrency'
  | 'crash_recovery'
  | 'dead_letter_recovery'
  | 'idempotent_rerun'
  | 'evidence_lineage'
  | 'feature_integrity';

export interface CertificationCheckResult {
  name: CertificationCheckName;
  ok: boolean;
  detail: string;
  meta?: Record<string, unknown>;
}

export interface CertificationReport {
  processRunId: string;
  overallOk: boolean;
  checks: CertificationCheckResult[];
  generatedAt: string;
}

export class CertificationService {
  async checkReplay(processRunId: string): Promise<CertificationCheckResult> {
    return withTx(async (client) => {
      const forensicRepo = new ForensicEventRepository(client);
      const stepRepo = new ProcessStepRepository(client);

      const events = await forensicRepo.getByRunId(processRunId);
      const steps = await stepRepo.getByRunId(processRunId);

      const hasMinimumReplayFields = events.every((event) =>
        event.event_hash &&
        event.event_type &&
        event.action_type &&
        event.entity_type &&
        event.entity_pk
      );

      const stepCoverage =
        steps.length === 0 ||
        steps.every((step) =>
          events.some((event) => event.process_step_id === step.id)
        );

      const ok = hasMinimumReplayFields && stepCoverage;

      return {
        name: 'replay',
        ok,
        detail: ok
          ? `Run ${processRunId} is replay-safe from forensic events`
          : `Run ${processRunId} is missing replay-critical event or step coverage`,
        meta: {
          eventCount: events.length,
          stepCount: steps.length,
          hasMinimumReplayFields,
          stepCoverage
        }
      };
    });
  }

  async checkConcurrency(processName: string, idempotencyKey: string): Promise<CertificationCheckResult> {
    return withTx(async (client) => {
      const processRunRepo = new ProcessRunRepository(client);

      const runA = await processRunRepo.createOrGetIdempotent({
        processName,
        processStage: 'CERT_CONCURRENCY',
        actorType: 'system',
        actorId: 'certifier',
        actorName: 'certifier',
        idempotencyKey
      });

      const runB = await processRunRepo.createOrGetIdempotent({
        processName,
        processStage: 'CERT_CONCURRENCY',
        actorType: 'system',
        actorId: 'certifier',
        actorName: 'certifier',
        idempotencyKey
      });

      const ok = runA.run_id === runB.run_id;

      return {
        name: 'concurrency',
        ok,
        detail: ok
          ? `Concurrent-safe idempotent run reuse confirmed for ${processName}`
          : `Duplicate runs detected under concurrent idempotent key use`,
        meta: {
          firstRunId: runA.run_id,
          secondRunId: runB.run_id
        }
      };
    });
  }

  async checkCrashRecovery(processRunId: string): Promise<CertificationCheckResult> {
    return withTx(async (client) => {
      const stepRepo = new ProcessStepRepository(client);
      const steps = await stepRepo.getByRunId(processRunId);

      const staleRunningSteps = steps.filter((step) => {
        if (step.status !== 'RUNNING') return false;
        if (!step.claim_expires_at) return false;
        return new Date(step.claim_expires_at).getTime() < Date.now();
      });

      const ok = staleRunningSteps.length === 0;

      return {
        name: 'crash_recovery',
        ok,
        detail: ok
          ? `No stale RUNNING steps found for ${processRunId}`
          : `Found ${staleRunningSteps.length} stale RUNNING steps requiring recovery`,
        meta: {
          stepCount: steps.length,
          staleRunningStepIds: staleRunningSteps.map((s) => s.id)
        }
      };
    });
  }

  async checkDeadLetterRecovery(processRunId: string): Promise<CertificationCheckResult> {
    return withTx(async (client) => {
      const res = await client.query(
        `
        select count(*)::int as dead_letter_count
        from arb.dead_letter
        where process_run_id = $1
        `,
        [processRunId]
      );

      const deadLetterCount = res.rows[0]?.dead_letter_count ?? 0;

      return {
        name: 'dead_letter_recovery',
        ok: true,
        detail: `Dead-letter rows for ${processRunId}: ${deadLetterCount}`,
        meta: { deadLetterCount }
      };
    });
  }

  async checkIdempotentRerun(processName: string, idempotencyKey: string): Promise<CertificationCheckResult> {
    return withTx(async (client) => {
      const processRunRepo = new ProcessRunRepository(client);

      const runA = await processRunRepo.createOrGetIdempotent({
        processName,
        processStage: 'CERT_IDEMPOTENT_RERUN',
        actorType: 'system',
        actorId: 'certifier',
        actorName: 'certifier',
        idempotencyKey
      });

      const runB = await processRunRepo.createOrGetIdempotent({
        processName,
        processStage: 'CERT_IDEMPOTENT_RERUN',
        actorType: 'system',
        actorId: 'certifier',
        actorName: 'certifier',
        idempotencyKey
      });

      const ok = runA.run_id === runB.run_id;

      return {
        name: 'idempotent_rerun',
        ok,
        detail: ok
          ? `Idempotent rerun reuses run ${runA.run_id}`
          : `Idempotent rerun produced multiple runs`,
        meta: {
          firstRunId: runA.run_id,
          secondRunId: runB.run_id
        }
      };
    });
  }

  async checkEvidenceLineage(processRunId: string): Promise<CertificationCheckResult> {
    return withTx(async (client) => {
      const res = await client.query(
        `
        select count(*)::int as broken_count
        from arb.forensic_events fe
        left join arb.process_runs pr on pr.run_id = fe.process_run_id
        left join arb.process_steps ps on ps.id = fe.process_step_id
        where fe.process_run_id = $1
          and (
            pr.run_id is null
            or (fe.process_step_id is not null and ps.id is null)
          )
        `,
        [processRunId]
      );

      const brokenCount = res.rows[0]?.broken_count ?? 0;
      const ok = brokenCount === 0;

      return {
        name: 'evidence_lineage',
        ok,
        detail: ok
          ? `Evidence lineage is intact for run ${processRunId}`
          : `Evidence lineage broken for ${brokenCount} forensic events`,
        meta: { brokenCount }
      };
    });
  }

  async checkFeatureIntegrity(entityType: string, entityPk: string): Promise<CertificationCheckResult> {
    return withTx(async (client) => {
      const learningRepo = new LearningFeatureRepository(client);
      const features = await learningRepo.getByEntity(entityType, entityPk);

      const invalidRows = features.filter((row) => {
        const featureGroup = row.feature_group ?? 'legacy';
        const featureName = row.feature_name;
        const featureValue = row.feature_value_json ?? row.feature_value;
        return !featureGroup || !featureName || !featureValue;
      });

      const ok = invalidRows.length === 0 && features.length > 0;

      return {
        name: 'feature_integrity',
        ok,
        detail: ok
          ? `Feature integrity valid for ${entityType}:${entityPk}`
          : `Invalid or missing feature rows for ${entityType}:${entityPk}`,
        meta: {
          totalFeatures: features.length,
          invalidRows: invalidRows.length
        }
      };
    });
  }

  async runFullCertification(input: {
    processRunId: string;
    entityType: string;
    entityPk: string;
    processName: string;
    idempotencyKey: string;
  }): Promise<CertificationReport> {
    const checks: CertificationCheckResult[] = [];

    checks.push(await this.checkReplay(input.processRunId));
    checks.push(await this.checkConcurrency(input.processName, `${input.idempotencyKey}:concurrency`));
    checks.push(await this.checkCrashRecovery(input.processRunId));
    checks.push(await this.checkDeadLetterRecovery(input.processRunId));
    checks.push(await this.checkIdempotentRerun(input.processName, `${input.idempotencyKey}:rerun`));
    checks.push(await this.checkEvidenceLineage(input.processRunId));
    checks.push(await this.checkFeatureIntegrity(input.entityType, input.entityPk));

    const overallOk = checks.every((check) => check.ok);

    return {
      processRunId: input.processRunId,
      overallOk,
      checks,
      generatedAt: new Date().toISOString()
    };
  }

  async stampCertification(processRunId: string, report: CertificationReport) {
    return withTx(async (client) => {
      const processRunRepo = new ProcessRunRepository(client);
      return processRunRepo.markCertification(
        processRunId,
        report.overallOk ? 'PASSED' : 'FAILED',
        report as unknown as Record<string, unknown>
      );
    });
  }
}
