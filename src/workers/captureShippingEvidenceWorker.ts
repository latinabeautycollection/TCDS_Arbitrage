import { Job } from 'bullmq';
import { PoolClient } from 'pg';
import { createQueue, createWorker } from '../queues/bullmq';
import { QueueNames } from '../queues/queueNames';
import { ShippingEvidenceJob } from '../types/queue';
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

const pricingQueue = createQueue(QueueNames.CAPTURE_PRICING);
const workerName = 'captureShippingEvidenceWorker';
const actorRepo = new UserActorRepository();

function toRunId(value: string | number): string {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new Error('CAPTURE_SHIPPING job requires processRunId; relay worker must mint it before enqueue.');
  }
  return String(value);
}

function getPayload(job: ShippingEvidenceJob): Record<string, any> {
  const anyJob = job as any;
  return (anyJob.payloadJson ?? anyJob.payload_json ?? anyJob.data?.payloadJson ?? anyJob.data?.payload_json ?? {}) as Record<string, any>;
}

function numericOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function textOrNull(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  return String(value);
}

function firstNumeric(...values: unknown[]): number | null {
  for (const value of values) {
    const n = numericOrNull(value);
    if (n !== null) return n;
  }
  return null;
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const t = textOrNull(value);
    if (t !== null) return t;
  }
  return null;
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

async function resolveShippingContext(
  client: PoolClient,
  job: ShippingEvidenceJob
): Promise<{
  listing: any | null;
  candidate: any | null;
  normalized: any | null;
  shipmentQuote: any | null;
  shipment: any | null;
}> {
  const payload = getPayload(job);
  const listingRepo = new ListingRepository(client);
  const candidateRepo = new CandidateRepository(client);

  let listing: any | null = null;
  let candidate: any | null = null;
  let normalized: any | null = null;
  let shipmentQuote: any | null = null;
  let shipment: any | null = null;

  const candidateId = firstNumeric((job as any).candidateId, payload.candidate_id, payload.candidateId);
  const sourceListingNormalizedId = firstNumeric(
    (job as any).sourceListingNormalizedId,
    payload.source_listing_normalized_id,
    payload.sourceListingId,
    job.entityType === 'listing' ? job.entityPk : null
  );
  const listingUuid = firstText((job as any).listingId, payload.listing_id, payload.listingId);

  if (listingUuid && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(listingUuid)) {
    listing = await listingRepo.getById(listingUuid);
  }

  if (sourceListingNormalizedId) {
    const normalizedRes = await client.query(
      `select * from arb.listing_normalized where id = $1 order by id desc limit 1`,
      [sourceListingNormalizedId]
    );
    normalized = normalizedRes.rows[0] ?? null;

    if (!listing && normalized?.listing_external_id) {
      listing = await listingRepo.getByExternalId(String(normalized.listing_external_id));
    }
  }

  if (!listing && candidateId) {
    candidate = await candidateRepo.getById(Number(candidateId));
    if (candidate?.listing_id) {
      listing = await listingRepo.getById(String(candidate.listing_id));
    }
  }

  if (!listing && job.entityType === 'listing' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(job.entityPk))) {
    listing = await listingRepo.getById(String(job.entityPk));
  }

  if (!candidate && listing?.id) {
    const candidateRes = await client.query(
      `select * from arb.candidates where listing_id = $1 order by id desc limit 1`,
      [listing.id]
    );
    candidate = candidateRes.rows[0] ?? null;
  }

  if (!normalized && listing?.listing_external_id) {
    normalized = await listingRepo.getNormalizedByExternalId(listing.listing_external_id);
  }

  const finalNormalizedId = normalized?.id ?? sourceListingNormalizedId;

  if (finalNormalizedId) {
    const quoteRes = await client.query(
      `select * from arb.shipment_quotes where source_listing_normalized_id = $1 order by selected_flag desc, id desc limit 1`,
      [finalNormalizedId]
    );
    shipmentQuote = quoteRes.rows[0] ?? null;

    const shipmentRes = await client.query(
      `select * from arb.shipments where source_listing_normalized_id = $1 order by id desc limit 1`,
      [finalNormalizedId]
    );
    shipment = shipmentRes.rows[0] ?? null;
  }

  return { listing, candidate, normalized, shipmentQuote, shipment };
}

function buildEvidenceValues(input: {
  job: ShippingEvidenceJob;
  normalized: any | null;
  shipmentQuote: any | null;
  shipment: any | null;
  listing: any | null;
}) {
  const payload = getPayload(input.job);
  const selectedRate = (payload.selected_rate ?? payload.selectedRate ?? {}) as Record<string, any>;
  const rawRate = (payload.raw_rate_response ?? {}) as Record<string, any>;

  const quotedLabelCostUsd = firstNumeric(
    payload.quoted_label_cost_usd,
    payload.quotedAmount,
    payload.quoted_amount,
    selectedRate.quoted_label_cost_usd,
    selectedRate.expectedTotalCostUsd,
    selectedRate.amount,
    (rawRate as any).quoted_label_cost_usd,
    (rawRate as any).expectedTotalCostUsd,
    (rawRate as any).amount,
    input.shipmentQuote?.quoted_label_cost_usd,
    input.shipment?.label_cost_usd,
    input.listing?.inbound_shipping_usd
  );

  const carrierCode = firstText(
    payload.selected_carrier_code,
    payload.carrier_code,
    payload.carrier,
    selectedRate.carrierCode,
    selectedRate.carrier_code,
    input.shipmentQuote?.carrier_code,
    input.shipment?.selected_carrier_code
  );

  const serviceCode = firstText(
    payload.selected_service_code,
    payload.service_code,
    payload.service,
    selectedRate.serviceCode,
    selectedRate.service_code,
    input.shipmentQuote?.service_code,
    input.shipment?.selected_service_code
  );

  const serviceName = firstText(
    payload.selected_service_name,
    payload.service_name,
    selectedRate.serviceName,
    selectedRate.service_name,
    input.shipmentQuote?.service_name
  );

  return {
    sourceListingNormalizedId: input.normalized?.id ?? firstNumeric(payload.source_listing_normalized_id, payload.sourceListingId),
    shipmentId: input.shipment?.id ?? firstNumeric(payload.shipment_id),
    carrierCode,
    serviceCode,
    serviceName,
    quotedLabelCostUsd,
    estimatedDeliveryDays: firstNumeric(payload.estimated_delivery_days, selectedRate.deliveryDays, input.shipmentQuote?.estimated_delivery_days),
    onTimeProbability: firstNumeric(payload.on_time_probability, payload.tracking_probability, input.shipmentQuote?.on_time_probability),
    trackingQualityScore: firstNumeric(payload.tracking_quality_score, input.shipmentQuote?.tracking_quality_score),
    claimRiskScore: firstNumeric(payload.claim_risk_score, selectedRate.claimRiskScore, input.shipmentQuote?.claim_risk_score),
    payloadJson: {
      ...payload,
      capture_worker_cost_source:
        firstNumeric(payload.quoted_label_cost_usd, payload.quotedAmount, payload.quoted_amount, selectedRate.quoted_label_cost_usd, selectedRate.expectedTotalCostUsd, selectedRate.amount) !== null
          ? 'payload_json'
          : input.shipmentQuote
            ? 'shipment_quote'
            : input.shipment
              ? 'shipment'
              : input.listing?.inbound_shipping_usd != null
                ? 'listing.inbound_shipping_usd'
                : 'none',
      shipmentQuoteId: input.shipmentQuote?.id ?? null,
      shipmentId: input.shipment?.id ?? null,
      sourceListingNormalizedId: input.normalized?.id ?? firstNumeric(payload.source_listing_normalized_id, payload.sourceListingId),
    },
  };
}

async function insertShippingEvidence(
  client: PoolClient,
  input: {
    processRunId: string;
    processStepId: number;
    forensicEventId: number;
    entityType: string;
    entityPk: string;
    normalized: any | null;
    shipmentQuote: any | null;
    shipment: any | null;
    listing: any | null;
    job: ShippingEvidenceJob;
  }
) {
  const values = buildEvidenceValues({
    job: input.job,
    normalized: input.normalized,
    shipmentQuote: input.shipmentQuote,
    shipment: input.shipment,
    listing: input.listing,
  });

  const { rows } = await client.query(
    `
    insert into arb.shipping_evidence (
      process_run_id,
      process_step_id,
      forensic_event_id,
      entity_type,
      entity_pk,
      source_listing_normalized_id,
      shipment_id,
      carrier_code,
      service_code,
      service_name,
      quoted_label_cost_usd,
      estimated_delivery_days,
      on_time_probability,
      tracking_quality_score,
      claim_risk_score,
      payload_json
    )
    values (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb
    )
    returning *
    `,
    [
      input.processRunId,
      input.processStepId,
      input.forensicEventId,
      input.entityType,
      input.entityPk,
      values.sourceListingNormalizedId,
      values.shipmentId,
      values.carrierCode,
      values.serviceCode,
      values.serviceName,
      values.quotedLabelCostUsd,
      values.estimatedDeliveryDays,
      values.onTimeProbability,
      values.trackingQualityScore,
      values.claimRiskScore,
      JSON.stringify(values.payloadJson),
    ]
  );

  return rows[0];
}

async function markOutboxCaptured(client: PoolClient, job: ShippingEvidenceJob, evidenceId: number): Promise<void> {
  const payload = getPayload(job);
  const outboxId = firstNumeric((job as any).shippingCaptureSignalOutboxId, payload.shipping_capture_signal_outbox_id);
  if (!outboxId) return;

  await client.query(
    `
    update arb.shipping_capture_signal_outbox
    set status = 'CAPTURED',
        captured_at = now(),
        updated_at = now(),
        payload_json = coalesce(payload_json, '{}'::jsonb) || $2::jsonb
    where id = $1
    `,
    [
      outboxId,
      JSON.stringify({
        shipping_evidence_id: evidenceId,
        captured_by: workerName,
      }),
    ]
  );
}

export const captureShippingEvidenceWorker = createWorker(
  QueueNames.CAPTURE_SHIPPING,
  async (job: Job<ShippingEvidenceJob>) => {
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
            'shipping step already claimed or completed'
          );
          return null;
        }

        await setRunStage(client, processRunId, 'CAPTURE_SHIPPING');
        return claimed;
      });

      if (!stepContext) return; 

      const result = await withTx(async (client) => {
        const context = await resolveShippingContext(client, job.data);
        const payload = getPayload(job.data);
        const runRepo = new ProcessRunRepository(client);
        const forensicRepo = new ForensicEventRepository(client);
        const mutationRepo = new MutationLedgerRepository(client);
        const journalRepo = new ProductJournalRepository(client);
        const summaryRepo = new PhaseSummaryRepository(client);

        const sourceTable = firstNumeric((job.data as any).shippingCaptureSignalOutboxId, payload.shipping_capture_signal_outbox_id)
          ? 'arb.shipping_capture_signal_outbox'
          : context.shipmentQuote
            ? 'arb.shipment_quotes'
            : context.shipment
              ? 'arb.shipments'
              : 'arb.listings';

        const sourcePk = String(
          (job.data as any).shippingCaptureSignalOutboxId ??
            payload.shipping_capture_signal_outbox_id ??
            context.shipmentQuote?.id ??
            context.shipment?.id ??
            context.listing?.id ??
            job.data.entityPk
        );

        const startEvent = await forensicRepo.append({
          processRunId,
          processStepId: job.data.processStepId!,
          correlationId: job.data.correlationId ?? null,
          causationId: (job.data as any).causationId ?? null,
          entityType: job.data.entityType,
          entityPk: job.data.entityPk,
          eventType: 'shipping_evidence_capture_started',
          actionType: 'CAPTURE',
          ...actor,
          workerName,
          workerInstanceId,
          sourceTable,
          sourcePk,
          queueName: QueueNames.CAPTURE_SHIPPING,
          jobId: String(job.id),
          idempotencyKey: job.data.idempotencyKey,
          beforeJson: {},
          afterJson: {
            shipmentQuoteId: context.shipmentQuote?.id ?? null,
            shipmentId: context.shipment?.id ?? null,
            shippingCaptureSignalOutboxId: payload.shipping_capture_signal_outbox_id ?? (job.data as any).shippingCaptureSignalOutboxId ?? null,
          },
          evidenceJson: {
            stage: 'capture_started',
            payload_cost: payload.quoted_label_cost_usd ?? payload.quotedAmount ?? null,
          },
        });

        const evidence = await insertShippingEvidence(client, {
          processRunId,
          processStepId: job.data.processStepId!,
          forensicEventId: startEvent.id,
          entityType: job.data.entityType,
          entityPk: job.data.entityPk,
          normalized: context.normalized,
          shipmentQuote: context.shipmentQuote,
          shipment: context.shipment,
          listing: context.listing,
          job: job.data,
        });

        await markOutboxCaptured(client, job.data, evidence.id);

        const finalEvent = await forensicRepo.append({
          processRunId,
          processStepId: job.data.processStepId!,
          correlationId: job.data.correlationId ?? null,
          causationId: String(startEvent.id),
          entityType: job.data.entityType,
          entityPk: job.data.entityPk,
          eventType: 'shipping_evidence_captured',
          actionType: 'INSERT',
          ...actor,
          workerName,
          workerInstanceId,
          sourceTable: 'arb.shipping_evidence',
          sourcePk: String(evidence.id),
          queueName: QueueNames.CAPTURE_SHIPPING,
          jobId: String(job.id),
          idempotencyKey: job.data.idempotencyKey,
          beforeJson: {},
          afterJson: evidence,
          evidenceJson: {
            shipmentQuoteId: context.shipmentQuote?.id ?? null,
            shipmentId: context.shipment?.id ?? null,
            sourceListingNormalizedId: context.normalized?.id ?? (evidence as any).source_listing_normalized_id ?? null,
            shippingCaptureSignalOutboxId: payload.shipping_capture_signal_outbox_id ?? (job.data as any).shippingCaptureSignalOutboxId ?? null,
          },
        });

        await mutationRepo.append({
          processRunId,
          correlationId: job.data.correlationId ?? null,
          tableName: 'arb.shipping_evidence',
          rowPk: String(evidence.id),
          operationType: 'INSERT',
          changedFields: [
            'source_listing_normalized_id',
            'shipment_id',
            'carrier_code',
            'service_code',
            'quoted_label_cost_usd',
            'estimated_delivery_days',
            'payload_json',
          ],
          changeSummary: {
            forensicEventId: finalEvent.id,
            entityType: job.data.entityType,
            entityPk: job.data.entityPk,
          },
          ...actor,
          workerName,
          workerInstanceId,
        });

        const summaryLine = `Shipping evidence captured for ${job.data.entityType} ${job.data.entityPk}`;

        await journalRepo.append({
          entityType: job.data.entityType,
          entityPk: job.data.entityPk,
          listingId: context.listing?.id ?? null,
          candidateId: context.candidate?.id ?? firstNumeric(payload.candidate_id, payload.candidateId),
          sourceListingNormalizedId: context.normalized?.id ?? (evidence as any).source_listing_normalized_id ?? null,
          eventType: 'SHIPPING_EVIDENCE_CAPTURED',
          processName: 'forensic.capture_shipping',
          processStage: 'CAPTURE_SHIPPING',
          processRunId,
          correlationId: job.data.correlationId ?? null,
          ...actor,
          workerName,
          workerInstanceId,
          eventSummary: summaryLine,
          eventDetailsJson: { shippingEvidenceId: evidence.id, forensicEventId: finalEvent.id },
        });

        await summaryRepo.append({
          entityType: job.data.entityType,
          entityPk: job.data.entityPk,
          listingId: context.listing?.id ?? null,
          candidateId: context.candidate?.id ?? firstNumeric(payload.candidate_id, payload.candidateId),
          processName: 'forensic.capture_shipping',
          processStage: 'CAPTURE_SHIPPING',
          processRunId,
          summaryLine,
          summaryOrder: 2,
        });

        await runRepo.updateCounts({
          runId: processRunId,
          rowsSeen: 1,
          rowsSucceeded: 1,
          entityCount: 1,
          detailsJson: { shippingEvidenceId: evidence.id },
        });

        return { evidence, finalEvent };
      });

      const nextStep = await withTx(async (client) => {
        const stepRepo = new ProcessStepRepository(client);
        const idempotencyRepo = new QueueIdempotencyRepository(client);
        const nextStepRow = await stepRepo.create({
          processRunId,
          stepName: 'capture_pricing',
          queueName: QueueNames.CAPTURE_PRICING,
          entityType: job.data.entityType,
          entityPk: job.data.entityPk,
          idempotencyKey: buildIdempotencyKey(['pricing-step', processRunId, job.data.entityType, job.data.entityPk]),
          payloadJson: {
            processRunId,
            entityType: job.data.entityType,
            entityPk: job.data.entityPk,
            correlationId: job.data.correlationId ?? null,
            causationId: String(result.finalEvent.id),
          },
        });

        await stepRepo.complete(job.data.processStepId!, {
          shippingEvidenceId: result.evidence.id,
          forensicEventId: result.finalEvent.id,
          nextProcessStepId: nextStepRow.id,
        });

        await idempotencyRepo.reserve({
          queueName: QueueNames.CAPTURE_PRICING,
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
            idempotencyKey: buildIdempotencyKey(['pricing-step', processRunId, job.data.entityType, job.data.entityPk]),
          },
        });

        return nextStepRow;
      });

      await addIdempotentJob({
        queue: pricingQueue,
        queueName: QueueNames.CAPTURE_PRICING,
        idempotencyKey: `run:${processRunId}:step:${nextStep.id}`,
        payload: {
          processRunId,
          processStepId: nextStep.id,
          entityType: job.data.entityType,
          entityPk: job.data.entityPk,
          correlationId: job.data.correlationId ?? null,
          causationId: String(result.finalEvent.id),
          idempotencyKey: buildIdempotencyKey(['pricing-step', processRunId, job.data.entityType, job.data.entityPk]),
        },
      });
    } catch (err: any) {
      await withTx(async (client) => {
        const stepRepo = new ProcessStepRepository(client);
        const runRepo = new ProcessRunRepository(client);
        const deadRepo = new DeadLetterRepository(client);

        if (job.data.processStepId) {
          await stepRepo.fail(job.data.processStepId, 'SHIPPING_CAPTURE_FAILED', err.message, {
            stack: err.stack ?? null,
          });
        }

        await runRepo.markFailed(processRunId, 'SHIPPING_CAPTURE_FAILED', err.message, {
          workerName,
          jobId: String(job.id),
        });

        await deadRepo.insert({
          queueName: QueueNames.CAPTURE_SHIPPING,
          jobId: String(job.id),
          workerName,
          workerInstanceId,
          processRunId,
          processStepId: job.data.processStepId,
          entityType: job.data.entityType,
          entityPk: job.data.entityPk,
          payloadJson: job.data as any,
          errorCode: 'SHIPPING_CAPTURE_FAILED',
          errorMessage: err.message,
          stackTrace: err.stack,
          retryCount: job.attemptsMade,
        });

        const payload = getPayload(job.data);
        const outboxId = firstNumeric((job.data as any).shippingCaptureSignalOutboxId, payload.shipping_capture_signal_outbox_id);
        if (outboxId) {
          await client.query(
            `
            update arb.shipping_capture_signal_outbox
            set status = case when attempts >= max_attempts then 'DEAD_LETTER' else 'FAILED' end,
                last_error = $2,
                available_at = now() + interval '60 seconds',
                updated_at = now()
            where id = $1
            `,
            [outboxId, err.message]
          );
        }
      });

      throw err;
    }
  }
);
