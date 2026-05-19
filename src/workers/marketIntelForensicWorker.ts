import { Job } from 'bullmq';
import { withTx } from '../db/tx';
import { createWorker } from '../queues/bullmq';
import { ProcessRunRepository } from '../repositories/processRunRepository';
import { ProcessStepRepository } from '../repositories/processStepRepository';
import { MarketIntelRepository } from '../repositories/marketIntelRepository';
import { ForensicEventRepository } from '../repositories/forensicEventRepository';
import { LearningFeatureRepository } from '../repositories/learningFeatureRepository';
import { ProductJournalRepository } from '../repositories/productJournalRepository';
import { PhaseSummaryRepository } from '../repositories/phaseSummaryRepository';
import { DeadLetterRepository } from '../repositories/deadLetterRepository';
import { QueueIdempotencyRepository } from '../repositories/queueIdempotencyRepository';
import { UserActorRepository } from '../repositories/userActorRepository';

const QUEUE = 'forensic.market.intel';
const PROCESS = 'forensic.market_intel';
const WORKER = 'marketIntelForensicWorker';
const actorRepo = new UserActorRepository();

export interface MarketIntelJob {
  marketRunId: number;
  snapshotId: number;
  correlationId: string;
  idempotencyKey: string;
}

export const marketIntelForensicWorker = createWorker<MarketIntelJob>(
  QUEUE,
  async (job: Job<MarketIntelJob>) => {
    const workerInstanceId = `${WORKER}:${process.pid}`;
    const actor = actorRepo.buildWorkerActor(WORKER, workerInstanceId);

    try {
      await withTx(async (client) => {
        const runRepo = new ProcessRunRepository(client);
        const stepRepo = new ProcessStepRepository(client);
        const marketRepo = new MarketIntelRepository(client);
        const forensicRepo = new ForensicEventRepository(client);
        const featureRepo = new LearningFeatureRepository(client);
        const journalRepo = new ProductJournalRepository(client);
        const summaryRepo = new PhaseSummaryRepository(client);
        const idempotencyRepo = new QueueIdempotencyRepository(client);

        await idempotencyRepo.reserve({
          queueName: QUEUE,
          idempotencyKey: job.data.idempotencyKey,
          jobId: String(job.id),
          entityType: 'market_intel_run',
          entityPk: String(job.data.marketRunId),
          payload: { ...job.data }
        });

        const processRun = await runRepo.createOrGetIdempotent({
          processName: PROCESS,
          processStage: 'CAPTURE_MARKET_INTEL',
          ...actor,
          workerName: WORKER,
          workerInstanceId,
          entityType: 'market_intel_run',
          entityCount: 1,
          correlationId: job.data.correlationId,
          idempotencyKey: job.data.idempotencyKey
        });

        const step = await stepRepo.create({
          processRunId: processRun.run_id,
          stepName: 'capture_market_snapshot',
          queueName: QUEUE,
          entityType: 'market_intel_run',
          entityPk: String(job.data.marketRunId),
          idempotencyKey: job.data.idempotencyKey,
          payloadJson: {
            ...job.data,
            jobId: String(job.id)
          }
        });

        await stepRepo.claimById(step.id, WORKER);

        const marketRun = await marketRepo.getRun(job.data.marketRunId);
        const snapshot = await marketRepo.getSnapshot(job.data.snapshotId);

        if (!marketRun) throw new Error(`market_intel_runs ${job.data.marketRunId} not found`);
        if (!snapshot) throw new Error(`ebay_market_snapshots ${job.data.snapshotId} not found`);

        await marketRepo.updateRunLinkage({
          marketIntelRunId: marketRun.id,
          processRunId: processRun.run_id,
          ...actor,
        });

        await marketRepo.updateSnapshotLinkage({
          snapshotId: snapshot.id,
          processRunId: processRun.run_id,
          ...actor,
        });

        const products = await marketRepo.getProductsByRun(job.data.marketRunId);

        const runEvent = await forensicRepo.append({
          processRunId: processRun.run_id,
          processStepId: step.id,
          correlationId: job.data.correlationId,
          entityType: 'market_intel_run',
          entityPk: String(marketRun.id),
          eventType: 'market_intel_snapshot_captured',
          actionType: 'CAPTURE',
          ...actor,
          workerName: WORKER,
          workerInstanceId,
          sourceTable: 'arb.ebay_market_snapshots',
          sourcePk: String(snapshot.id),
          queueName: QUEUE,
          jobId: String(job.id),
          idempotencyKey: job.data.idempotencyKey,
          beforeJson: {},
          afterJson: snapshot,
          evidenceJson: {
            marketRunStatus: marketRun.status,
            categoryKey: snapshot.category_key,
            itemCount: snapshot.item_count,
            productCount: products.length
          }
        });

        await featureRepo.insert({
          processRunId: processRun.run_id,
          forensicEventId: runEvent.id,
          entityType: 'market_intel_run',
          entityPk: String(marketRun.id),
          featureGroup: 'market_snapshot',
          featureName: 'snapshot_density',
          featureValueJson: {
            itemCount: snapshot.item_count,
            productCount: products.length
          }
        });

        await featureRepo.insert({
          processRunId: processRun.run_id,
          forensicEventId: runEvent.id,
          entityType: 'market_intel_run',
          entityPk: String(marketRun.id),
          featureGroup: 'market_snapshot',
          featureName: 'pricing_anchor',
          featureValueJson: {
            avgPriceUsd: snapshot.avg_price_usd,
            medianPriceUsd: snapshot.median_price_usd
          }
        });

        for (const product of products) {
          await marketRepo.claimProduct(product.id, PROCESS, processRun.run_id, WORKER);

          await journalRepo.append({
            entityType: 'market_snapshot_product',
            entityPk: String(product.id),
            eventType: 'MARKET_PRODUCT_CAPTURED',
            processName: PROCESS,
            processStage: 'CAPTURE_MARKET_INTEL',
            processRunId: processRun.run_id,
            correlationId: job.data.correlationId,
            ...actor,
            workerName: WORKER,
            workerInstanceId,
            eventSummary: `Market snapshot product ${product.id} captured for category ${product.category_key}`,
            eventDetailsJson: {
              runId: product.run_id,
              snapshotId: product.snapshot_id,
              demandScore: product.demand_score,
              predictedProfitUsd: product.predicted_profit_usd
            }
          });
        }

        await summaryRepo.append({
          entityType: 'market_intel_run',
          entityPk: String(marketRun.id),
          processName: PROCESS,
          processStage: 'CAPTURE_MARKET_INTEL',
          processRunId: processRun.run_id,
          summaryLine: `Market intel run ${marketRun.id} captured snapshot ${snapshot.id} with ${products.length} products`,
          summaryOrder: 1
        });

        await stepRepo.complete(step.id, {
          forensicEventId: runEvent.id,
          productsCaptured: products.length
        });

        await runRepo.markSucceeded(processRun.run_id, {
          marketRunId: marketRun.id,
          snapshotId: snapshot.id,
          productsCaptured: products.length
        });
      });
    } catch (error: any) {
      await withTx(async (client) => {
        const deadRepo = new DeadLetterRepository(client);
        await deadRepo.insert({
          queueName: QUEUE,
          jobId: String(job.id),
          entityType: 'market_intel_run',
          entityPk: String(job.data.marketRunId),
          workerName: WORKER,
          workerInstanceId,
          errorCode: 'MARKET_INTEL_FORENSIC_FAILED',
          errorMessage: error.message,
          stackTrace: error.stack,
          payloadJson: { ...job.data },
          retryCount: job.attemptsMade
        });
      });
      throw error;
    }
  }
);
