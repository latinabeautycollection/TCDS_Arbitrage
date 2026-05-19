import os from 'os';
import { withTx } from '../db/tx';
import { ProcessRunRepository } from '../repositories/processRunRepository';
import { ProcessStepRepository } from '../repositories/processStepRepository';
import { QueueIdempotencyRepository } from '../repositories/queueIdempotencyRepository';
import { ProductJournalRepository } from '../repositories/productJournalRepository';
import { PhaseSummaryRepository } from '../repositories/phaseSummaryRepository';
import { DeadLetterRepository } from '../repositories/deadLetterRepository';

export interface StartForensicRunInput {
  processName: string;
  processStage: string;
  actorType: 'user' | 'worker' | 'system' | 'api' | 'service_account';
  actorId?: string | null;
  actorName?: string | null;
  workerName?: string | null;
  workerInstanceId?: string | null;
  correlationId?: string | null;
  idempotencyKey: string;
  entityType: string;
  entityPk: string;
  initialStepName: string;
  initialQueueName: string;
  payloadJson?: Record<string, unknown>;
  codeVersion?: string | null;
  rulesetVersion?: string | null;
  modelVersion?: string | null;
}

export interface StartForensicRunResult {
  run: any;
  initialStep: any;
}

export interface CompleteRunInput {
  processRunId: string;
  entityType: string;
  entityPk: string;
  processName: string;
  processStage: string;
  correlationId?: string | null;
  summaryLine: string;
  detailsJson?: Record<string, unknown>;
}

export interface FailRunInput {
  processRunId: string;
  processStepId?: number | null;
  entityType: string;
  entityPk: string;
  processName: string;
  processStage: string;
  correlationId?: string | null;
  errorClass: string;
  errorSummary: string;
  queueName?: string | null;
  jobId?: string | null;
  payloadJson?: Record<string, unknown>;
  workerName?: string | null;
  workerInstanceId?: string | null;
  detailsJson?: Record<string, unknown>;
}

export class ProcessRunService {
  async startForensicRun(input: StartForensicRunInput): Promise<StartForensicRunResult> {
    return withTx(async (client) => {
      const runRepo = new ProcessRunRepository(client);
      const stepRepo = new ProcessStepRepository(client);
      const queueIdempotencyRepo = new QueueIdempotencyRepository(client);
      const journalRepo = new ProductJournalRepository(client);
      const summaryRepo = new PhaseSummaryRepository(client);

      await queueIdempotencyRepo.reserve({
        queueName: input.initialQueueName,
        idempotencyKey: input.idempotencyKey,
        processRunId: null,
        entityType: input.entityType,
        entityPk: input.entityPk,
        payload: input.payloadJson ?? {}
      });

      const run = await runRepo.createOrGetIdempotent({
        processName: input.processName,
        processStage: input.processStage,
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        actorName: input.actorName ?? null,
        workerName: input.workerName ?? null,
        workerInstanceId: input.workerInstanceId ?? null,
        hostName: os.hostname(),
        entityType: input.entityType,
        entityCount: 1,
        correlationId: input.correlationId ?? null,
        idempotencyKey: input.idempotencyKey,
        codeVersion: input.codeVersion ?? null,
        rulesetVersion: input.rulesetVersion ?? null,
        modelVersion: input.modelVersion ?? null,
        detailsJson: {
          bootstrapped: true,
          bootstrapQueue: input.initialQueueName
        }
      });

      const initialStep = await stepRepo.create({
        processRunId: run.run_id,
        stepName: input.initialStepName,
        queueName: input.initialQueueName,
        entityType: input.entityType,
        entityPk: input.entityPk,
        idempotencyKey: input.idempotencyKey,
        payloadJson: input.payloadJson ?? {}
      });

      await journalRepo.append({
        entityType: input.entityType,
        entityPk: input.entityPk,
        eventType: 'PROCESS_RUN_STARTED',
        processName: input.processName,
        processStage: input.processStage,
        processRunId: run.run_id,
        correlationId: input.correlationId ?? null,
        actorType: input.actorType,
        actorId: input.actorId ?? input.workerName ?? null,
        actorName: input.actorName ?? input.workerName ?? null,
        workerName: input.workerName ?? null,
        workerInstanceId: input.workerInstanceId ?? null,
        codeVersion: input.codeVersion ?? null,
        rulesetVersion: input.rulesetVersion ?? null,
        modelVersion: input.modelVersion ?? null,
        reasonCodes: ['PROCESS_BOOTSTRAPPED'],
        riskFlags: [],
        eventSummary: `Process run ${run.run_id} started with initial step ${initialStep.step_name}`,
        eventDetailsJson: {
          initialStepId: initialStep.id,
          initialQueueName: initialStep.queue_name
        }
      });

      await summaryRepo.append({
        entityType: input.entityType,
        entityPk: input.entityPk,
        processName: input.processName,
        processStage: input.processStage,
        processRunId: run.run_id,
        summaryLine: `Run started: ${input.processName} → ${input.initialStepName}`,
        summaryOrder: 1
      });

      return { run, initialStep };
    });
  }

  async completeRun(input: CompleteRunInput) {
    return withTx(async (client) => {
      const runRepo = new ProcessRunRepository(client);
      const summaryRepo = new PhaseSummaryRepository(client);
      const journalRepo = new ProductJournalRepository(client);

      const run = await runRepo.markSucceeded(
        input.processRunId,
        input.detailsJson ?? {}
      );

      await journalRepo.append({
        entityType: input.entityType,
        entityPk: input.entityPk,
        eventType: 'PROCESS_RUN_COMPLETED',
        processName: input.processName,
        processStage: input.processStage,
        processRunId: input.processRunId,
        correlationId: input.correlationId ?? null,
        actorType: 'system',
        actorId: 'processRunService',
        actorName: 'processRunService',
        reasonCodes: ['PROCESS_COMPLETE'],
        riskFlags: [],
        eventSummary: input.summaryLine,
        eventDetailsJson: input.detailsJson ?? {}
      });

      await summaryRepo.append({
        entityType: input.entityType,
        entityPk: input.entityPk,
        processName: input.processName,
        processStage: input.processStage,
        processRunId: input.processRunId,
        summaryLine: input.summaryLine,
        summaryOrder: 99
      });

      return run;
    });
  }

  async failRun(input: FailRunInput) {
    return withTx(async (client) => {
      const runRepo = new ProcessRunRepository(client);
      const deadRepo = new DeadLetterRepository(client);
      const journalRepo = new ProductJournalRepository(client);
      const summaryRepo = new PhaseSummaryRepository(client);

      const run = await runRepo.markFailed(
        input.processRunId,
        input.errorClass,
        input.errorSummary,
        input.detailsJson ?? {}
      );

      if (input.queueName) {
        await deadRepo.insert({
          processRunId: input.processRunId,
          processStepId: input.processStepId ?? null,
          queueName: input.queueName,
          jobId: input.jobId ?? null,
          entityType: input.entityType,
          entityPk: input.entityPk,
          workerName: input.workerName ?? null,
          workerInstanceId: input.workerInstanceId ?? null,
          errorCode: input.errorClass,
          errorMessage: input.errorSummary,
          payloadJson: input.payloadJson ?? {}
        });
      }

      await journalRepo.append({
        entityType: input.entityType,
        entityPk: input.entityPk,
        eventType: 'PROCESS_RUN_FAILED',
        processName: input.processName,
        processStage: input.processStage,
        processRunId: input.processRunId,
        correlationId: input.correlationId ?? null,
        actorType: 'system',
        actorId: 'processRunService',
        actorName: 'processRunService',
        workerName: input.workerName ?? null,
        workerInstanceId: input.workerInstanceId ?? null,
        reasonCodes: ['PROCESS_FAILED'],
        riskFlags: [input.errorClass],
        eventSummary: `Process run failed: ${input.errorSummary}`,
        eventDetailsJson: {
          errorClass: input.errorClass,
          details: input.detailsJson ?? {}
        }
      });

      await summaryRepo.append({
        entityType: input.entityType,
        entityPk: input.entityPk,
        processName: input.processName,
        processStage: input.processStage,
        processRunId: input.processRunId,
        summaryLine: `Run failed: ${input.errorSummary}`,
        summaryOrder: 999
      });

      return run;
    });
  }

  async getRunWithSteps(processRunId: string) {
    return withTx(async (client) => {
      const runRepo = new ProcessRunRepository(client);
      const stepRepo = new ProcessStepRepository(client);

      const run = await runRepo.getByRunId(processRunId);
      const steps = await stepRepo.getByRunId(processRunId);

      return { run, steps };
    });
  }
}
