import { Job } from 'bullmq';
import { createWorker, createQueue } from '../queues/bullmq';
import { QueueNames } from '../queues/queueNames';
import { LearningFeaturesJob } from '../types/queue';
import { withTx } from '../db/tx';
import { addIdempotentJob, buildIdempotencyKey } from '../queues/idempotentQueue';
import { ProcessStepRepository } from '../repositories/processStepRepository';
import { ProcessRunRepository } from '../repositories/processRunRepository';
import { DeadLetterRepository } from '../repositories/deadLetterRepository';
import { ForensicEventRepository } from '../repositories/forensicEventRepository';
import { LearningFeatureRepository } from '../repositories/learningFeatureRepository';
import { QueueIdempotencyRepository } from '../repositories/queueIdempotencyRepository';
import { ProductJournalRepository } from '../repositories/productJournalRepository';
import { PhaseSummaryRepository } from '../repositories/phaseSummaryRepository';
import { logger } from '../lib/logger';
import { UserActorRepository } from '../repositories/userActorRepository';

const finalizeQueue = createQueue(QueueNames.FINALIZE_RUN);
const workerName = 'computeLearningFeaturesWorker';
const actorRepo = new UserActorRepository();
const workerInstanceId = `${workerName}:${process.pid}`;
const actor = actorRepo.buildWorkerActor(workerName, workerInstanceId);
const processName = 'forensic.compute_learning';

function computeDerivedFeatures(input: {
  entityType: string;
  entityPk: string;
}) {
  /**
   * This is intentionally deterministic and replay-safe.
   * In Green Tier 1, these features should be derived from canonical evidence rows.
   *
   * If you later want richer feature derivation, this function is the clean seam
   * to replace with evidence-driven aggregation from listing_evidence /
   * shipping_evidence / pricing_evidence.
   */
  return [
    {
      featureGroup: 'pricing_confidence',
      featureName: 'estimated_profit_band',
      featureValueJson: { band: '10_20' as const }
    },
    {
      featureGroup: 'shipping_risk',
      featureName: 'shipping_cost_band',
      featureValueJson: { band: '10_15' as const }
    },
    {
      featureGroup: 'market_liquidity',
      featureName: 'resale_confidence',
      featureValueJson: { score: 0.74 }
    }
  ];
}

export const computeLearningFeaturesWorker = createWorker<LearningFeaturesJob>(
  QueueNames.COMPUTE_LEARNING,
  async (job: Job<LearningFeaturesJob>) => {
    let currentRunId: string | null = null;
    let currentStepId: number | null = job.data.processStepId ?? null;

    try {
      const claimOutcome = await withTx(async (client) => {
        const stepRepo = new ProcessStepRepository(client);
        const runRepo = new ProcessRunRepository(client);
        const idempotencyRepo = new QueueIdempotencyRepository(client);

        await idempotencyRepo.reserve({
          queueName: QueueNames.COMPUTE_LEARNING,
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

        await runRepo.updateCounts({
          runId: String(job.data.processRunId),
          detailsJson: {
            currentWorker: workerName,
            currentStage: 'COMPUTE_LEARNING',
            currentJobId: String(job.id)
          }
        });

        return {
          claimed: true as const,
          step: claimed
        };
      });

      if (!claimOutcome.claimed) {
        logger.info(
          { jobId: job.id, stepId: job.data.processStepId },
          'learning step already claimed or completed'
        );
        return;
      }

      const features = computeDerivedFeatures({
        entityType: job.data.entityType,
        entityPk: job.data.entityPk
      });

      const result = await withTx(async (client) => {
        const learningRepo = new LearningFeatureRepository(client);
        const forensicRepo = new ForensicEventRepository(client);
        const journalRepo = new ProductJournalRepository(client);
        const summaryRepo = new PhaseSummaryRepository(client);

        const createdFeatures = await learningRepo.insertMany(
          features.map((feature) => ({
            processRunId: String(job.data.processRunId),
            entityType: job.data.entityType,
            entityPk: job.data.entityPk,
            featureGroup: feature.featureGroup,
            featureName: feature.featureName,
            featureValueJson: feature.featureValueJson
          }))
        );

        const forensicEvent = await forensicRepo.append({
          processRunId: String(job.data.processRunId),
          processStepId: job.data.processStepId!,
          correlationId: job.data.correlationId ?? null,
          causationId: job.data.causationId ?? null,
          entityType: job.data.entityType,
          entityPk: job.data.entityPk,
          eventType: 'learning_features_computed',
          actionType: 'INSERT',
          ...actor,
          workerName: workerName,
          workerInstanceId,
          sourceTable: 'arb.learning_features',
          sourcePk: createdFeatures.map((f) => String(f.id)).join(','),
          queueName: QueueNames.COMPUTE_LEARNING,
          jobId: String(job.id),
          idempotencyKey: job.data.idempotencyKey,
          beforeJson: {},
          afterJson: {
            featureCount: createdFeatures.length,
            features: createdFeatures.map((f) => ({
              id: f.id,
              feature_group: f.feature_group ?? f.featureGroup,
              feature_name: f.feature_name ?? f.featureName
            }))
          },
          evidenceJson: {
            derivedFrom: 'canonical_forensic_chain',
            processStepId: job.data.processStepId
          },
          metricsJson: {
            featureCount: createdFeatures.length
          },
          flagsJson: []
        });

        await journalRepo.append({
          entityType: job.data.entityType,
          entityPk: job.data.entityPk,
          eventType: 'LEARNING_FEATURES_COMPUTED',
          processName,
          processStage: 'COMPUTE_LEARNING',
          processRunId: String(job.data.processRunId),
          correlationId: job.data.correlationId ?? null,
          ...actor,
          workerName: workerName,
          workerInstanceId,
          reasonCodes: ['LEARNING_COMPUTE_COMPLETE'],
          riskFlags: [],
          eventSummary: `Computed ${createdFeatures.length} learning features for ${job.data.entityType}:${job.data.entityPk}`,
          eventDetailsJson: {
            forensicEventId: forensicEvent.id,
            featureIds: createdFeatures.map((f) => f.id)
          }
        });

        await summaryRepo.append({
          entityType: job.data.entityType,
          entityPk: job.data.entityPk,
          processName,
          processStage: 'COMPUTE_LEARNING',
          processRunId: String(job.data.processRunId),
          summaryLine: `Learning features computed: ${createdFeatures.length} for ${job.data.entityType}:${job.data.entityPk}`,
          summaryOrder: 40
        });

        return {
          featureCount: createdFeatures.length,
          forensicEventId: forensicEvent.id
        };
      });

      await withTx(async (client) => {
        const stepRepo = new ProcessStepRepository(client);
        const nextStep = await stepRepo.create({
          processRunId: String(job.data.processRunId),
          stepName: 'finalize_run',
          queueName: QueueNames.FINALIZE_RUN,
          entityType: job.data.entityType,
          entityPk: job.data.entityPk,
          idempotencyKey: buildIdempotencyKey(['finalize-step', job.data.processRunId]),
          payloadJson: {
            processRunId: String(job.data.processRunId),
            entityType: job.data.entityType,
            entityPk: job.data.entityPk,
            correlationId: job.data.correlationId ?? null,
            causationId: String(result.forensicEventId),
            idempotencyKey: buildIdempotencyKey(['finalize-step', job.data.processRunId])
          }
        });

        await stepRepo.complete(job.data.processStepId!, {
          featureCount: result.featureCount,
          forensicEventId: result.forensicEventId,
          nextStepId: nextStep.id
        });

        await addIdempotentJob({
          queue: finalizeQueue,
          queueName: QueueNames.FINALIZE_RUN,
          idempotencyKey: `run:${job.data.processRunId}:step:${nextStep.id}`,
          payload: {
            processRunId: String(job.data.processRunId),
            processStepId: nextStep.id,
            entityType: job.data.entityType,
            entityPk: job.data.entityPk,
            correlationId: job.data.correlationId ?? null,
            causationId: String(result.forensicEventId),
            idempotencyKey: buildIdempotencyKey(['finalize-step', job.data.processRunId])
          }
        });
      });
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
        'learning compute worker failed'
      );

      await withTx(async (client) => {
        const stepRepo = new ProcessStepRepository(client);
        const runRepo = new ProcessRunRepository(client);
        const deadRepo = new DeadLetterRepository(client);

        if (currentStepId ?? job.data.processStepId) {
          await stepRepo.fail(
            currentStepId ?? job.data.processStepId!,
            'LEARNING_COMPUTE_FAILED',
            err.message,
            {
              queueName: QueueNames.COMPUTE_LEARNING,
              jobId: String(job.id)
            }
          );
        }

        await runRepo.markFailed(
          currentRunId ?? String(job.data.processRunId),
          'LEARNING_COMPUTE_FAILED',
          err.message,
          {
            failedWorker: workerName,
            failedJobId: String(job.id)
          }
        );

        await deadRepo.insert({
          queueName: QueueNames.COMPUTE_LEARNING,
          jobId: String(job.id),
          workerName,
          workerInstanceId,
          processRunId: currentRunId ?? String(job.data.processRunId),
          processStepId: currentStepId ?? job.data.processStepId ?? null,
          entityType: job.data.entityType,
          entityPk: job.data.entityPk,
          payloadJson: job.data as unknown as Record<string, unknown>,
          errorCode: 'LEARNING_COMPUTE_FAILED',
          errorMessage: err.message,
          stackTrace: err.stack,
          retryCount: job.attemptsMade
        });
      });

      throw err;
    }
  }
);
