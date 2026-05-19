import { Job } from 'bullmq';
import { PoolClient } from 'pg';
import { createQueue, createWorker } from '../queues/bullmq';
import { QueueNames } from '../queues/queueNames';
import { ListingEvidenceJob } from '../types/queue';
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

const shippingQueue = createQueue(QueueNames.CAPTURE_SHIPPING);
const workerName = 'captureListingEvidenceWorker';
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

async function resolveListingContext(
  client: PoolClient,
  job: ListingEvidenceJob
): Promise<{
  listing: any;
  candidate: any | null;
  normalized: any | null;
}> {
  const listingRepo = new ListingRepository(client);
  const candidateRepo = new CandidateRepository(client);

  let listing: any | null = null;
  let candidate: any | null = null;
  let normalized: any | null = null;

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
    const res = await client.query(
      `
      select *
      from arb.candidates
      where listing_id = $1
      order by id desc
      limit 1
      `,
      [listing.id]
    );
    candidate = res.rows[0] ?? null;
  }

  if (listing?.listing_external_id) {
    normalized = await listingRepo.getNormalizedByExternalId(listing.listing_external_id);
  }

  if (!listing) {
    throw new Error(
      `captureListingEvidenceWorker: unable to resolve listing context for entityType=${job.entityType}, entityPk=${job.entityPk}`
    );
  }

  return { listing, candidate, normalized };
}

async function insertListingEvidence(
  client: PoolClient,
  input: {
    processRunId: string;
    processStepId: number;
    forensicEventId: number;
    listing: any;
    candidate: any | null;
    normalized: any | null;
  }
) {
  const { rows } = await client.query(
    `
    insert into arb.listing_evidence (
      process_run_id,
      process_step_id,
      forensic_event_id,
      listing_id,
      source_listing_normalized_id,
      candidate_id,
      source_platform,
      source_external_id,
      title,
      normalized_title,
      brand,
      model,
      category_key,
      condition_text,
      current_price,
      buy_now_price,
      inbound_shipping_usd,
      total_cost,
      payload_json
    )
    values (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb
    )
    returning *
    `,
    [
      input.processRunId,
      input.processStepId,
      input.forensicEventId,
      input.listing.id ?? null,
      input.normalized?.id ?? null,
      input.candidate?.id ?? null,
      input.listing.platform ?? null,
      input.listing.listing_external_id ?? null,
      input.listing.title ?? null,
      input.listing.normalized_title ?? input.normalized?.listing_title ?? null,
      input.listing.brand ?? input.normalized?.brand ?? null,
      input.listing.model ?? input.normalized?.model ?? null,
      input.listing.category_key ?? null,
      input.listing.condition_text ?? input.normalized?.condition_text ?? null,
      input.listing.current_price ?? null,
      input.listing.buy_now_price ?? null,
      input.listing.inbound_shipping_usd ?? input.normalized?.inbound_shipping_usd ?? null,
      input.listing.total_cost ?? null,
      JSON.stringify({
        listingPayloadJson: input.listing.payload_json ?? null,
        normalizedPayload: input.normalized?.raw_last_payload ?? null,
        candidateId: input.candidate?.id ?? null
      })
    ]
  );

  return rows[0];
}

export const captureListingEvidenceWorker = createWorker<ListingEvidenceJob>(
  QueueNames.CAPTURE_LISTING,
  async (job: Job<ListingEvidenceJob>) => {
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
            'listing step already claimed or completed'
          );
          return null;
        }

        await setRunStage(client, processRunId, 'CAPTURE_LISTING');
        return claimed;
      });

      if (!stepContext) {
        return;
      }

      const result = await withTx(async (client) => {
        const listingContext = await resolveListingContext(client, job.data);

        const runRepo = new ProcessRunRepository(client);
        const forensicRepo = new ForensicEventRepository(client);
        const mutationRepo = new MutationLedgerRepository(client);
        const journalRepo = new ProductJournalRepository(client);
        const summaryRepo = new PhaseSummaryRepository(client);

        const preEvent = await forensicRepo.append({
          processRunId,
          processStepId: job.data.processStepId!,
          correlationId: job.data.correlationId ?? null,
          causationId: (job.data as any).causationId ?? null,
          entityType: job.data.entityType,
          entityPk: job.data.entityPk,
          eventType: 'listing_evidence_capture_started',
          actionType: 'CAPTURE',
          ...actor,
          workerName,
          workerInstanceId,
          sourceTable: 'arb.listings',
          sourcePk: String(listingContext.listing.id),
          queueName: QueueNames.CAPTURE_LISTING,
          jobId: String(job.id),
          idempotencyKey: job.data.idempotencyKey,
          beforeJson: {},
          afterJson: {
            listingId: listingContext.listing.id,
            candidateId: listingContext.candidate?.id ?? null,
            normalizedId: listingContext.normalized?.id ?? null
          },
          evidenceJson: {
            stage: 'capture_started'
          }
        });

        const evidence = await insertListingEvidence(client, {
          processRunId,
          processStepId: job.data.processStepId!,
          forensicEventId: preEvent.id,
          listing: listingContext.listing,
          candidate: listingContext.candidate,
          normalized: listingContext.normalized
        });

        const finalEvent = await forensicRepo.append({
          processRunId,
          processStepId: job.data.processStepId!,
          correlationId: job.data.correlationId ?? null,
          causationId: String(preEvent.id),
          entityType: job.data.entityType,
          entityPk: job.data.entityPk,
          eventType: 'listing_evidence_captured',
          actionType: 'INSERT',
          ...actor,
          workerName,
          workerInstanceId,
          sourceTable: 'arb.listing_evidence',
          sourcePk: String(evidence.id),
          queueName: QueueNames.CAPTURE_LISTING,
          jobId: String(job.id),
          idempotencyKey: job.data.idempotencyKey,
          beforeJson: {},
          afterJson: evidence,
          evidenceJson: {
            listingId: listingContext.listing.id,
            candidateId: listingContext.candidate?.id ?? null,
            sourceListingNormalizedId: listingContext.normalized?.id ?? null
          }
        });

        await mutationRepo.append({
          processRunId,
          correlationId: job.data.correlationId ?? null,
          tableName: 'arb.listing_evidence',
          rowPk: String(evidence.id),
          operationType: 'INSERT',
          changedFields: [
            'listing_id',
            'source_listing_normalized_id',
            'candidate_id',
            'title',
            'normalized_title',
            'brand',
            'model',
            'current_price',
            'buy_now_price',
            'inbound_shipping_usd',
            'total_cost'
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

        const summaryLine = `Listing evidence captured for listing ${listingContext.listing.id}`;

        await journalRepo.append({
          entityType: job.data.entityType,
          entityPk: job.data.entityPk,
          listingId: listingContext.listing.id,
          candidateId: listingContext.candidate?.id ?? null,
          sourceListingNormalizedId: listingContext.normalized?.id ?? null,
          eventType: 'LISTING_EVIDENCE_CAPTURED',
          processName: 'forensic.capture_listing',
          processStage: 'CAPTURE_LISTING',
          processRunId,
          correlationId: job.data.correlationId ?? null,
          ...actor,
          workerName,
          workerInstanceId,
          eventSummary: summaryLine,
          eventDetailsJson: {
            listingEvidenceId: evidence.id,
            forensicEventId: finalEvent.id
          }
        });

        await summaryRepo.append({
          entityType: job.data.entityType,
          entityPk: job.data.entityPk,
          listingId: listingContext.listing.id,
          candidateId: listingContext.candidate?.id ?? null,
          processName: 'forensic.capture_listing',
          processStage: 'CAPTURE_LISTING',
          processRunId,
          summaryLine,
          summaryOrder: 1
        });

        await runRepo.updateCounts({
          runId: processRunId,
          rowsSeen: 1,
          rowsSucceeded: 1,
          entityCount: 1,
          detailsJson: {
            listingEvidenceId: evidence.id
          }
        });

        return {
          evidence,
          finalEvent,
          listing: listingContext.listing
        };
      });

      const nextStep = await withTx(async (client) => {
        const stepRepo = new ProcessStepRepository(client);
        const idempotencyRepo = new QueueIdempotencyRepository(client);

        const nextStepRow = await stepRepo.create({
          processRunId,
          stepName: 'capture_shipping',
          queueName: QueueNames.CAPTURE_SHIPPING,
          entityType: job.data.entityType,
          entityPk: job.data.entityPk,
          idempotencyKey: buildIdempotencyKey(['shipping-step', processRunId, job.data.entityType, job.data.entityPk]),
          payloadJson: {
            processRunId,
            entityType: job.data.entityType,
            entityPk: job.data.entityPk,
            correlationId: job.data.correlationId ?? null,
            causationId: String(result.finalEvent.id)
          }
        });

        await stepRepo.complete(job.data.processStepId!, {
          listingEvidenceId: result.evidence.id,
          forensicEventId: result.finalEvent.id,
          nextProcessStepId: nextStepRow.id
        });

        await idempotencyRepo.reserve({
          queueName: QueueNames.CAPTURE_SHIPPING,
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
            idempotencyKey: buildIdempotencyKey(['shipping-step', processRunId, job.data.entityType, job.data.entityPk])
          }
        });

        return nextStepRow;
      });

      await addIdempotentJob({
        queue: shippingQueue,
        queueName: QueueNames.CAPTURE_SHIPPING,
        idempotencyKey: `run:${processRunId}:step:${nextStep.id}`,
        payload: {
          processRunId,
          processStepId: nextStep.id,
          entityType: job.data.entityType,
          entityPk: job.data.entityPk,
          correlationId: job.data.correlationId ?? null,
          causationId: String(result.finalEvent.id),
          idempotencyKey: buildIdempotencyKey(['shipping-step', processRunId, job.data.entityType, job.data.entityPk])
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
            'LISTING_CAPTURE_FAILED',
            err.message,
            { stack: err.stack ?? null }
          );
        }

        await runRepo.markFailed(
          processRunId,
          'LISTING_CAPTURE_FAILED',
          err.message,
          { workerName, jobId: String(job.id) }
        );

        await deadRepo.insert({
          queueName: QueueNames.CAPTURE_LISTING,
          jobId: String(job.id),
          workerName,
          workerInstanceId,
          processRunId,
          processStepId: job.data.processStepId,
          entityType: job.data.entityType,
          entityPk: job.data.entityPk,
          payloadJson: job.data as any,
          errorCode: 'LISTING_CAPTURE_FAILED',
          errorMessage: err.message,
          stackTrace: err.stack,
          retryCount: job.attemptsMade
        });
      });

      throw err;
    }
  }
);
