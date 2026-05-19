import { withTx } from '../db/tx';
import { ListingRepository } from '../repositories/listingRepository';
import { CandidateRepository } from '../repositories/candidateRepository';
import { ForensicEventRepository } from '../repositories/forensicEventRepository';
import { ListingEvidenceRepository } from '../repositories/listingEvidenceRepository';
import { MutationLedgerRepository } from '../repositories/mutationLedgerRepository';
import { ProductJournalRepository } from '../repositories/productJournalRepository';
import { PhaseSummaryRepository } from '../repositories/phaseSummaryRepository';

export interface CaptureListingEvidenceInput {
  processRunId: string;
  processStepId: number;
  entityType: string;
  entityPk: string;
  listingId?: string | null;
  candidateId?: number | null;
  queueName: string;
  jobId?: string | null;
  workerName: string;
  workerInstanceId?: string | null;
  correlationId?: string | null;
  causationId?: string | null;
  idempotencyKey: string;
}

export class ListingEvidenceService {
  async capture(input: CaptureListingEvidenceInput) {
    return withTx(async (client) => {
      const listingRepo = new ListingRepository(client);
      const candidateRepo = new CandidateRepository(client);
      const forensicRepo = new ForensicEventRepository(client);
      const evidenceRepo = new ListingEvidenceRepository(client);
      const mutationRepo = new MutationLedgerRepository(client);
      const journalRepo = new ProductJournalRepository(client);
      const summaryRepo = new PhaseSummaryRepository(client);

      const listing =
        input.listingId ? await listingRepo.getById(input.listingId) : null;

      const candidate =
        input.candidateId != null
          ? await candidateRepo.getById(input.candidateId)
          : null;

      const sourceListing =
        listing?.listing_external_id
          ? await listingRepo.getNormalizedByExternalId(listing.listing_external_id)
          : null;

      if (!listing && !candidate) {
        throw new Error(
          `ListingEvidenceService.capture: neither listing nor candidate was resolvable for entity ${input.entityType}:${input.entityPk}`
        );
      }

      const resolvedListingId = listing?.id ?? candidate?.listing_id ?? null;

      const title =
        listing?.title ??
        candidate?.title ??
        sourceListing?.title ??
        sourceListing?.listing_title ??
        null;

      const normalizedTitle =
        listing?.normalized_title ??
        candidate?.normalized_title ??
        null;

      const brand =
        listing?.brand ??
        candidate?.brand ??
        sourceListing?.brand ??
        null;

      const model =
        listing?.model ??
        candidate?.model ??
        sourceListing?.model ??
        null;

      const categoryKey =
        listing?.category_key ??
        candidate?.source_category_key ??
        sourceListing?.category ??
        null;

      const conditionText =
        listing?.condition_text ??
        candidate?.condition_text ??
        sourceListing?.condition_text ??
        null;

      const currentPrice =
        listing?.current_price ??
        candidate?.current_price ??
        sourceListing?.price ??
        sourceListing?.current_bid ??
        null;

      const buyNowPrice =
        listing?.buy_now_price ??
        sourceListing?.buy_now_price ??
        null;

      const inboundShippingUsd =
        listing?.inbound_shipping_usd ??
        candidate?.inbound_shipping_usd ??
        sourceListing?.inbound_shipping_usd ??
        sourceListing?.shipping_cost ??
        null;

      const totalCost =
        listing?.total_cost ?? null;

      const evidencePayload = {
        listingTableId: listing?.id ?? null,
        candidateId: candidate?.id ?? null,
        sourceListingNormalizedId: sourceListing?.id ?? null,
        sourcePlatform: listing?.platform ?? sourceListing?.source ?? null,
        sourceExternalId:
          listing?.listing_external_id ??
          sourceListing?.listing_external_id ??
          null
      };

      const event = await forensicRepo.append({
        processRunId: input.processRunId,
        processStepId: input.processStepId,
        correlationId: input.correlationId ?? null,
        causationId: input.causationId ?? null,
        entityType: input.entityType,
        entityPk: input.entityPk,
        eventType: 'listing_evidence_captured',
        actionType: 'INSERT',
        actorType: 'worker',
        actorId: input.workerName,
        actorName: input.workerName,
        workerName: input.workerName,
        workerInstanceId: input.workerInstanceId ?? null,
        sourceTable: 'arb.listings',
        sourcePk: resolvedListingId ?? null,
        queueName: input.queueName,
        jobId: input.jobId ?? null,
        idempotencyKey: input.idempotencyKey,
        beforeJson: {},
        afterJson: {
          title,
          normalizedTitle,
          brand,
          model,
          categoryKey,
          conditionText,
          currentPrice,
          buyNowPrice,
          inboundShippingUsd,
          totalCost
        },
        evidenceJson: evidencePayload,
        metricsJson: {},
        flagsJson: []
      });

      const evidence = await evidenceRepo.insert({
        processRunId: input.processRunId,
        processStepId: input.processStepId,
        forensicEventId: event.id,
        listingId: resolvedListingId,
        sourceListingNormalizedId: sourceListing?.id ?? null,
        candidateId: candidate?.id ?? null,
        sourcePlatform: listing?.platform ?? sourceListing?.source ?? null,
        sourceExternalId:
          listing?.listing_external_id ??
          sourceListing?.listing_external_id ??
          null,
        title,
        normalizedTitle,
        brand,
        model,
        categoryKey,
        conditionText,
        currentPrice,
        buyNowPrice,
        inboundShippingUsd,
        totalCost,
        payloadJson: evidencePayload
      });

      await mutationRepo.append({
        processRunId: input.processRunId,
        correlationId: input.correlationId ?? null,
        tableName: 'arb.listing_evidence',
        rowPk: String(evidence.id),
        operationType: 'INSERT',
        changedFields: [
          'listing_id',
          'source_listing_normalized_id',
          'candidate_id',
          'title',
          'brand',
          'model',
          'current_price'
        ],
        changeSummary: {
          forensicEventId: event.id,
          listingEvidenceId: evidence.id
        },
        actorType: 'worker',
        actorId: input.workerName,
        workerName: input.workerName,
        workerInstanceId: input.workerInstanceId ?? null
      });

      await journalRepo.append({
        entityType: input.entityType,
        entityPk: input.entityPk,
        listingId: resolvedListingId,
        candidateId: candidate?.id ?? null,
        sourceListingNormalizedId: sourceListing?.id ?? null,
        eventType: 'LISTING_EVIDENCE_CAPTURED',
        processName: 'forensic.capture_listing',
        processStage: 'CAPTURE_LISTING',
        processRunId: input.processRunId,
        correlationId: input.correlationId ?? null,
        actorType: 'worker',
        actorId: input.workerName,
        actorName: input.workerName,
        workerName: input.workerName,
        workerInstanceId: input.workerInstanceId ?? null,
        reasonCodes: ['FORENSIC_CAPTURE'],
        riskFlags: [],
        eventSummary: `Listing evidence captured for ${input.entityType}:${input.entityPk}`,
        eventDetailsJson: {
          forensicEventId: event.id,
          listingEvidenceId: evidence.id
        }
      });

      await summaryRepo.append({
        entityType: input.entityType,
        entityPk: input.entityPk,
        listingId: resolvedListingId,
        candidateId: candidate?.id ?? null,
        processName: 'forensic.capture_listing',
        processStage: 'CAPTURE_LISTING',
        processRunId: input.processRunId,
        summaryLine: `Listing evidence captured: ${brand ?? 'unknown'} ${model ?? ''}`.trim(),
        summaryOrder: 10
      });

      return {
        event,
        evidence,
        listing,
        candidate,
        sourceListing
      };
    });
  }
}
