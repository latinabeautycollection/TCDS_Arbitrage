import { Job } from 'bullmq';
import { createWorker } from '../queues/bullmq';
import { QueueNames } from '../queues/queueNames';
import { FinalizeRunJob } from '../types/queue';
import { withTx } from '../db/tx';
import { ProcessStepRepository } from '../repositories/processStepRepository';
import { ProcessRunRepository } from '../repositories/processRunRepository';
import { DeadLetterRepository } from '../repositories/deadLetterRepository';
import { ForensicEventRepository } from '../repositories/forensicEventRepository';
import { ProductJournalRepository } from '../repositories/productJournalRepository';
import { PhaseSummaryRepository } from '../repositories/phaseSummaryRepository';
import { QueueIdempotencyRepository } from '../repositories/queueIdempotencyRepository';
import { logger } from '../lib/logger';
import { UserActorRepository } from '../repositories/userActorRepository';

const workerName = 'finalizeProcessRunWorker';
const actorRepo = new UserActorRepository();
const workerInstanceId = `${workerName}:${process.pid}`;
const actor = actorRepo.buildWorkerActor(workerName, workerInstanceId);
const processName = 'forensic.finalize_run';

export const finalizeProcessRunWorker = createWorker<FinalizeRunJob>(
  QueueNames.FINALIZE_RUN,
  async (job: Job<FinalizeRunJob>) => {
    let currentRunId: string | null = String(job.data.processRunId);
    let currentStepId: number | null = job.data.processStepId ?? null;

    try {
      const claimOutcome = await withTx(async (client) => {
        const stepRepo = new ProcessStepRepository(client);
        const idempotencyRepo = new QueueIdempotencyRepository(client);

        await idempotencyRepo.reserve({
          queueName: QueueNames.FINALIZE_RUN,
          idempotencyKey: job.data.idempotencyKey,
          jobId: String(job.id),
          processRunId: String(job.data.processRunId),
          entityType: job.data.entityType,
          entityPk: job.data.entityPk,
          payload: job.data as unknown as Record<string, unknown>
        });

        const claimed = await stepRepo.claim(job.data.processStepId!, workerName);
        if (!claimed) {
          return { claimed: false as const };
        }

        currentStepId = claimed.id;
        currentRunId = claimed.process_run_id;

        return {
          claimed: true as const,
          step: claimed
        };
      });

      if (!claimOutcome.claimed) {
        logger.info(
          { jobId: job.id, stepId: job.data.processStepId },
          'finalize step already claimed or completed'
        );
        return;
      }

      const finalizeResult = await withTx(async (client) => {
        const stepRepo = new ProcessStepRepository(client);
        const runRepo = new ProcessRunRepository(client);
        const forensicRepo = new ForensicEventRepository(client);
        const journalRepo = new ProductJournalRepository(client);
        const summaryRepo = new PhaseSummaryRepository(client);

        const steps = await stepRepo.getByRunId(String(job.data.processRunId));
        const events = await forensicRepo.getByRunId(String(job.data.processRunId));

        const incompleteSteps = steps.filter(
          (step) =>
            step.id !== job.data.processStepId &&
            !['SUCCEEDED', 'CANCELLED'].includes(step.status)
        );

        const overallOk = incompleteSteps.length === 0;

        const forensicEvent = await forensicRepo.append({
          processRunId: String(job.data.processRunId),
          processStepId: job.data.processStepId!,
          correlationId: job.data.correlationId ?? null,
          causationId: job.data.causationId ?? null,
          entityType: job.data.entityType,
          entityPk: job.data.entityPk,
          eventType: 'forensic_run_finalized',
          actionType: 'UPDATE',
          ...actor,
          workerName: workerName,
          workerInstanceId,
          sourceTable: 'arb.process_runs',
          sourcePk: String(job.data.processRunId),
          queueName: QueueNames.FINALIZE_RUN,
          jobId: String(job.id),
          idempotencyKey: job.data.idempotencyKey,
          beforeJson: {},
          afterJson: {
            overallOk,
            incompleteStepCount: incompleteSteps.length,
            totalStepCount: steps.length,
            eventCount: events.length
          },
          evidenceJson: {
            stepStatuses: steps.map((step) => ({
              id: step.id,
              stepName: step.step_name,
              status: step.status
            }))
          },
          metricsJson: {
            totalStepCount: steps.length,
            incompleteStepCount: incompleteSteps.length,
            eventCount: events.length
          },
          flagsJson: overallOk ? [] : ['INCOMPLETE_STEPS_PRESENT']
        });

        await stepRepo.complete(job.data.processStepId!, {
          finalized: true,
          overallOk,
          forensicEventId: forensicEvent.id
        });

        if (overallOk) {
          await runRepo.markSucceeded(String(job.data.processRunId), {
            finalizedBy: workerName,
            forensicEventId: forensicEvent.id,
            totalStepCount: steps.length,
            eventCount: events.length
          });
        } else {
          await runRepo.markPartial(String(job.data.processRunId), {
            finalizedBy: workerName,
            forensicEventId: forensicEvent.id,
            incompleteSteps: incompleteSteps.map((step) => ({
              id: step.id,
              stepName: step.step_name,
              status: step.status
            }))
          });
        }

        await journalRepo.append({
          entityType: job.data.entityType,
          entityPk: job.data.entityPk,
          eventType: overallOk ? 'FORENSIC_RUN_FINALIZED' : 'FORENSIC_RUN_PARTIAL',
          processName,
          processStage: 'FINALIZE_RUN',
          processRunId: String(job.data.processRunId),
          correlationId: job.data.correlationId ?? null,
          ...actor,
          workerName: workerName,
          workerInstanceId,
          reasonCodes: overallOk ? ['FORENSIC_CHAIN_COMPLETE'] : ['FORENSIC_CHAIN_PARTIAL'],
          riskFlags: overallOk ? [] : ['INCOMPLETE_STEPS_PRESENT'],
          eventSummary: overallOk
            ? `Forensic run ${String(job.data.processRunId)} finalized successfully`
            : `Forensic run ${String(job.data.processRunId)} finalized as PARTIAL with ${incompleteSteps.length} incomplete steps`,
          eventDetailsJson: {
            forensicEventId: forensicEvent.id,
            incompleteStepIds: incompleteSteps.map((step) => step.id)
          }
        });

        await summaryRepo.append({
          entityType: job.data.entityType,
          entityPk: job.data.entityPk,
          processName,
          processStage: 'FINALIZE_RUN',
          processRunId: String(job.data.processRunId),
          summaryLine: overallOk
            ? `Forensic run finalized successfully for ${job.data.entityType}:${job.data.entityPk}`
            : `Forensic run finalized as PARTIAL for ${job.data.entityType}:${job.data.entityPk}`,
          summaryOrder: 50
        });

        return {
          overallOk,
          incompleteStepCount: incompleteSteps.length,
          forensicEventId: forensicEvent.id
        };
      });

      logger.info(
        {
          processRunId: String(job.data.processRunId),
          processStepId: job.data.processStepId,
          overallOk: finalizeResult.overallOk,
          incompleteStepCount: finalizeResult.incompleteStepCount
        },
        'forensic run finalized'
      );
    } catch (err: any) {
      logger.error(
        {
          err,
          jobId: job.id,
          processRunId: String(job.data.processRunId),
          processStepId: job.data.processStepId,
          entityType: job.data.entityType,
          entityPk: job.data.entityPk
        },
        'finalize run worker failed'
      );

      await withTx(async (client) => {
        const stepRepo = new ProcessStepRepository(client);
        const runRepo = new ProcessRunRepository(client);
        const deadRepo = new DeadLetterRepository(client);

        if (currentStepId ?? job.data.processStepId) {
          await stepRepo.fail(
            currentStepId ?? job.data.processStepId!,
            'FINALIZE_RUN_FAILED',
            err.message,
            {
              queueName: QueueNames.FINALIZE_RUN,
              jobId: String(job.id)
            }
          );
        }

        await runRepo.markFailed(
          currentRunId ?? String(job.data.processRunId),
          'FINALIZE_RUN_FAILED',
          err.message,
          {
            failedWorker: workerName,
            failedJobId: String(job.id)
          }
        );

        await deadRepo.insert({
          queueName: QueueNames.FINALIZE_RUN,
          jobId: String(job.id),
          workerName,
          workerInstanceId,
          processRunId: currentRunId ?? String(job.data.processRunId),
          processStepId: currentStepId ?? job.data.processStepId ?? null,
          entityType: job.data.entityType,
          entityPk: job.data.entityPk,
          payloadJson: job.data as unknown as Record<string, unknown>,
          errorCode: 'FINALIZE_RUN_FAILED',
          errorMessage: err.message,
          stackTrace: err.stack,
          retryCount: job.attemptsMade
        });
      });

      throw err;
    }
  }
);
