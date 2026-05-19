import { Job } from 'bullmq';
import { PoolClient } from 'pg';
import { createQueue, createWorker } from '../queues/bullmq';
import { QueueNames } from '../queues/queueNames';
import { PricingEvidenceJob } from '../types/queue';
import { withTx } from '../db/tx';
import { addIdempotentJob, buildIdempotencyKey } from '../queues/idempotentQueue';
import { logger } from '../lib/logger';
import { ProcessRunRepository } from '../repositories/processRunRepository';
import { ProcessStepRepository } from '../repositories/processStepRepository';
import { ForensicEventRepository } from '../repositories/forensicEventRepository';
import { ListingRepository } from '../repositories/listingRepository';
import { CandidateRepository } from '../repositories/candidateRepository';
import { MutationLedgerRepository } from '../repositories/mutationLedgerRepository';
import { ProductJournalRepository } from '../repositories/productJournalRepository';
import { PhaseSummaryRepository } from '../repositories/phaseSummaryRepository';
import { DeadLetterRepository } from '../repositories/deadLetterRepository';
import { QueueIdempotencyRepository } from '../repositories/queueIdempotencyRepository';
import { UserActorRepository } from '../repositories/userActorRepository';

const learningQueue = createQueue(QueueNames.COMPUTE_LEARNING);
const workerName = 'capturePricingEvidenceWorker';
const actorRepo = new UserActorRepository();

function toRunId(value: string | number): string {
  return String(value);
}

async function setRunStage(client: PoolClient, runId: string, stage: string): Promise<void> {
  await client.query(
    `
    update arb.process_runs
    set process_stage = $2,
        updated_at = now()
    where run_id = $1
    `,
    [runId, stage]
  );
}

async function resolvePricingContext(
  client: PoolClient,
  job: PricingEvidenceJob
): Promise<{
  listing: any | null;
  candidate: any | null;
  normalized: any | null;
  decision: any | null;
  profitAnalysis: any | null;
}> {
  const listingRepo = new ListingRepository(client);
  const candidateRepo = new CandidateRepository(client);

  let listing: any | null = null;
  let candidate: any | null = null;
  let normalized: any | null = null;
  let decision: any | null = null;
  let profitAnalysis: any | null = null;

  const listingId = (job as any).listingId ?? null;
  const candidateId =
    job.entityType === 'candidate' ? Number(job.entityPk) : (job as any).candidateId ?? null;

  if (listingId) {
    listing = await listingRepo.getById(String(listingId));
  }

  if (!listing && candidateId) {
    candidate = await candidateRepo.getById(Number(candidateId));
    if (candidate?.listing_id) {
      listing = await listingRepo.getById(String(candidate.listing_id));
    }
  }

  if (!listing && job.entityType === 'listing') {
    listing = await listingRepo.getById(String(job.entityPk));
  }

  if (!candidate && listing?.id) {
    const candidateRes = await client.query(
      `
      select *
      from arb.candidates
      where listing_id = $1
      order by id desc
      limit 1
      `,
      [listing.id]
    );
    candidate = candidateRes.rows[0] ?? null;
  }

  if (listing?.listing_external_id) {
    normalized = await listingRepo.getNormalizedByExternalId(listing.listing_external_id);
  }

  if (listing?.id) {
    const decisionRes = await client.query(
      `
      select *
      from arb.decisions
      where listing_id = $1
      order by computed_at desc, created_at desc
      limit 1
      `,
      [listing.id]
    );
    decision = decisionRes.rows[0] ?? null;
  }

  if (candidate?.id) {
    const profitRes = await client.query(
      `
      select *
      from arb.profit_analysis
      where candidate_id = $1
      order by created_at desc
      limit 1
      `,
      [candidate.id]
    );
    profitAnalysis = profitRes.rows[0] ?? null;
  }

  return { listing, candidate, normalized, decision, profitAnalysis };
}

async function insertPricingEvidence(
  client: PoolClient,
  input: {
    processRunId: string;
    processStepId: number;
    forensicEventId: number;
    entityType: string;
    entityPk: string;
    listing: any | null;
    candidate: any | null;
    normalized: any | null;
    decision: any | null;
    profitAnalysis: any | null;
  }
) {
  const amountUsd =
    input.decision?.expected_resale_usd ??
    input.profitAnalysis?.recommended_sale_price_usd ??
    input.normalized?.price ??
    input.listing?.buy_now_price ??
    input.listing?.current_price ??
    null;

  const totalCostBasisUsd =
    input.decision?.expected_total_cost_basis_usd ??
    input.profitAnalysis?.total_cost_basis_usd ??
    input.listing?.total_cost ??
    null;

  const expectedProfitUsd =
    input.decision?.estimated_profit_usd ??
    input.profitAnalysis?.estimated_net_profit_usd ??
    input.decision?.expected_net_profit ??
    null;

  const roiPct =
    input.decision?.estimated_roi ??
    input.profitAnalysis?.estimated_margin_pct ??
    null;

  const marginPct =
    input.profitAnalysis?.estimated_margin_pct ??
    input.decision?.expected_roi ??
    null;

  const { rows } = await client.query(
    `
    insert into arb.pricing_evidence (
      process_run_id,
      process_step_id,
      forensic_event_id,
      entity_type,
      entity_pk,
      source_listing_normalized_id,
      candidate_id,
      decision_id,
      price_type,
      amount_usd,
      ebay_fee_usd,
      payment_fee_usd,
      shipping_usd,
      total_cost_basis_usd,
      expected_profit_usd,
      roi_pct,
      margin_pct,
      payload_json
    )
    values (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb
    )
    returning *
    `,
    [
      input.processRunId,
      input.processStepId,
      input.forensicEventId,
      input.entityType,
      input.entityPk,
      input.normalized?.id ?? null,
      input.candidate?.id ?? null,
      input.decision?.id ?? null,
      input.decision ? 'decision' : input.profitAnalysis ? 'profit_analysis' : 'listing_fallback',
      amountUsd,
      input.profitAnalysis?.ebay_fee_estimate_usd ?? null,
      input.decision?.purchase_price_inputs_json?.payment_fee_usd ?? null,
      input.profitAnalysis?.outbound_shipping_estimate_usd ?? input.listing?.inbound_shipping_usd ?? null,
      totalCostBasisUsd,
      expectedProfitUsd,
      roiPct,
      marginPct,
      JSON.stringify({
        decisionId: input.decision?.id ?? null,
        profitAnalysisId: input.profitAnalysis?.id ?? null,
        source: input.decision ? 'decisions' : input.profitAnalysis ? 'profit_analysis' : 'listing_fallback'
      })
    ]
  );

  return rows[0];
}

export const capturePricingEvidenceWorker = createWorker<PricingEvidenceJob>(
  QueueNames.CAPTURE_PRICING,
  async (job: Job<PricingEvidenceJob>) => {
    const processRunId = toRunId(job.data.processRunId);
    const workerInstanceId = `${workerName}:${process.pid}`;
    const actor = actorRepo.buildWorkerActor(workerName, workerInstanceId);

    try {
      const stepContext = await withTx(async (client) => {
        const stepRepo = new ProcessStepRepository(client);
        const claimed = await stepRepo.claim(job.data.processStepId!, workerName);

        if (!claimed) {
          logger.info(
            { jobId: job.id, processStepId: job.data.processStepId },
            'pricing step already claimed or completed'
          );
          return null;
        }

        await setRunStage(client, processRunId, 'CAPTURE_PRICING');
        return claimed;
      });

      if (!stepContext) {
        return;
      }

      const result = await withTx(async (client) => {
        const context = await resolvePricingContext(client, job.data);

        const runRepo = new ProcessRunRepository(client);
        const forensicRepo = new ForensicEventRepository(client);
        const mutationRepo = new MutationLedgerRepository(client);
        const journalRepo = new ProductJournalRepository(client);
        const summaryRepo = new PhaseSummaryRepository(client);

        const startEvent = await forensicRepo.append({
          processRunId,
          processStepId: job.data.processStepId!,
          correlationId: job.data.correlationId ?? null,
          causationId: (job.data as any).causationId ?? null,
          entityType: job.data.entityType,
          entityPk: job.data.entityPk,
          eventType: 'pricing_evidence_capture_started',
          actionType: 'CAPTURE',
          ...actor,
          workerName,
          workerInstanceId,
          sourceTable: context.decision ? 'arb.decisions' : context.profitAnalysis ? 'arb.profit_analysis' : 'arb.listings',
          sourcePk: String(
            context.decision?.id ??
            context.profitAnalysis?.id ??
            context.listing?.id ??
            job.data.entityPk
          ),
          queueName: QueueNames.CAPTURE_PRICING,
          jobId: String(job.id),
          idempotencyKey: job.data.idempotencyKey,
          beforeJson: {},
          afterJson: {
            decisionId: context.decision?.id ?? null,
            profitAnalysisId: context.profitAnalysis?.id ?? null
          },
          evidenceJson: {
            stage: 'capture_started'
          }
        });

        const evidence = await insertPricingEvidence(client, {
          processRunId,
          processStepId: job.data.processStepId!,
          forensicEventId: startEvent.id,
          entityType: job.data.entityType,
          entityPk: job.data.entityPk,
          listing: context.listing,
          candidate: context.candidate,
          normalized: context.normalized,
          decision: context.decision,
          profitAnalysis: context.profitAnalysis
        });

        const finalEvent = await forensicRepo.append({
          processRunId,
          processStepId: job.data.processStepId!,
          correlationId: job.data.correlationId ?? null,
          causationId: String(startEvent.id),
          entityType: job.data.entityType,
          entityPk: job.data.entityPk,
          eventType: 'pricing_evidence_captured',
          actionType: 'INSERT',
          ...actor,
          workerName,
          workerInstanceId,
          sourceTable: 'arb.pricing_evidence',
          sourcePk: String(evidence.id),
          queueName: QueueNames.CAPTURE_PRICING,
          jobId: String(job.id),
          idempotencyKey: job.data.idempotencyKey,
          beforeJson: {},
          afterJson: evidence,
          evidenceJson: {
            decisionId: context.decision?.id ?? null,
            profitAnalysisId: context.profitAnalysis?.id ?? null,
            sourceListingNormalizedId: context.normalized?.id ?? null
          }
        });

        await mutationRepo.append({
          processRunId,
          correlationId: job.data.correlationId ?? null,
          tableName: 'arb.pricing_evidence',
          rowPk: String(evidence.id),
          operationType: 'INSERT',
          changedFields: [
            'source_listing_normalized_id',
            'candidate_id',
            'decision_id',
            'price_type',
            'amount_usd',
            'total_cost_basis_usd',
            'expected_profit_usd',
            'roi_pct',
            'margin_pct'
          ],
          changeSummary: {
            forensicEventId: finalEvent.id,
            entityType: job.data.entityType,
            entityPk: job.data.entityPk
          },
          ...actor,
          workerName,
          workerInstanceId
        });

        const summaryLine = `Pricing evidence captured for ${job.data.entityType} ${job.data.entityPk}`;

        await journalRepo.append({
          entityType: job.data.entityType,
          entityPk: job.data.entityPk,
          listingId: context.listing?.id ?? null,
          candidateId: context.candidate?.id ?? null,
          sourceListingNormalizedId: context.normalized?.id ?? null,
          eventType: 'PRICING_EVIDENCE_CAPTURED',
          processName: 'forensic.capture_pricing',
          processStage: 'CAPTURE_PRICING',
          processRunId,
          correlationId: job.data.correlationId ?? null,
          ...actor,
          workerName,
          workerInstanceId,
          eventSummary: summaryLine,
          eventDetailsJson: {
            pricingEvidenceId: evidence.id,
            forensicEventId: finalEvent.id
          }
        });

        await summaryRepo.append({
          entityType: job.data.entityType,
          entityPk: job.data.entityPk,
          listingId: context.listing?.id ?? null,
          candidateId: context.candidate?.id ?? null,
          processName: 'forensic.capture_pricing',
          processStage: 'CAPTURE_PRICING',
          processRunId,
          summaryLine,
          summaryOrder: 3
        });

        await runRepo.updateCounts({
          runId: processRunId,
          rowsSeen: 1,
          rowsSucceeded: 1,
          entityCount: 1,
          detailsJson: {
            pricingEvidenceId: evidence.id
          }
        });

        return { evidence, finalEvent };
      });

      const nextStep = await withTx(async (client) => {
        const stepRepo = new ProcessStepRepository(client);
        const idempotencyRepo = new QueueIdempotencyRepository(client);

        const nextStepRow = await stepRepo.create({
          processRunId,
          stepName: 'compute_learning',
          queueName: QueueNames.COMPUTE_LEARNING,
          entityType: job.data.entityType,
          entityPk: job.data.entityPk,
          idempotencyKey: buildIdempotencyKey(['learning-step', processRunId, job.data.entityType, job.data.entityPk]),
          payloadJson: {
            processRunId,
            entityType: job.data.entityType,
            entityPk: job.data.entityPk,
            correlationId: job.data.correlationId ?? null,
            causationId: String(result.finalEvent.id)
          }
        });

        await stepRepo.complete(job.data.processStepId!, {
          pricingEvidenceId: result.evidence.id,
          forensicEventId: result.finalEvent.id,
          nextProcessStepId: nextStepRow.id
        });

        await idempotencyRepo.reserve({
          queueName: QueueNames.COMPUTE_LEARNING,
          idempotencyKey: `run:${processRunId}:step:${nextStepRow.id}`,
          processRunId,
          entityType: job.data.entityType,
          entityPk: job.data.entityPk,
          payload: {
            processRunId,
            processStepId: nextStepRow.id,
            entityType: job.data.entityType,
            entityPk: job.data.entityPk,
            correlationId: job.data.correlationId ?? null,
            causationId: String(result.finalEvent.id),
            idempotencyKey: buildIdempotencyKey(['learning-step', processRunId, job.data.entityType, job.data.entityPk])
          }
        });

        return nextStepRow;
      });

      await addIdempotentJob({
        queue: learningQueue,
        queueName: QueueNames.COMPUTE_LEARNING,
        idempotencyKey: `run:${processRunId}:step:${nextStep.id}`,
        payload: {
          processRunId,
          processStepId: nextStep.id,
          entityType: job.data.entityType,
          entityPk: job.data.entityPk,
          correlationId: job.data.correlationId ?? null,
          causationId: String(result.finalEvent.id),
          idempotencyKey: buildIdempotencyKey(['learning-step', processRunId, job.data.entityType, job.data.entityPk])
        }
      });
    } catch (err: any) {
      await withTx(async (client) => {
        const stepRepo = new ProcessStepRepository(client);
        const runRepo = new ProcessRunRepository(client);
        const deadRepo = new DeadLetterRepository(client);

        if (job.data.processStepId) {
          await stepRepo.fail(
            job.data.processStepId,
            'PRICING_CAPTURE_FAILED',
            err.message,
            { stack: err.stack ?? null }
          );
        }

        await runRepo.markFailed(
          processRunId,
          'PRICING_CAPTURE_FAILED',
          err.message,
          { workerName, jobId: String(job.id) }
        );

        await deadRepo.insert({
          queueName: QueueNames.CAPTURE_PRICING,
          jobId: String(job.id),
          workerName,
          workerInstanceId,
          processRunId,
          processStepId: job.data.processStepId,
          entityType: job.data.entityType,
          entityPk: job.data.entityPk,
          payloadJson: job.data as any,
          errorCode: 'PRICING_CAPTURE_FAILED',
          errorMessage: err.message,
          stackTrace: err.stack,
          retryCount: job.attemptsMade
        });
      });

      throw err;
    }
  }
);
