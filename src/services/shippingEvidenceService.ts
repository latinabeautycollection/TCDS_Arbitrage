import { withTx } from '../db/tx';
import { ForensicEventRepository } from '../repositories/forensicEventRepository';
import { ShippingEvidenceRepository } from '../repositories/shippingEvidenceRepository';
import { MutationLedgerRepository } from '../repositories/mutationLedgerRepository';
import { ProductJournalRepository } from '../repositories/productJournalRepository';
import { PhaseSummaryRepository } from '../repositories/phaseSummaryRepository';

export interface CaptureShippingEvidenceInput {
  processRunId: string;
  processStepId: number;
  entityType: string;
  entityPk: string;
  sourceListingNormalizedId?: number | null;
  shipmentId?: number | null;
  queueName: string;
  jobId?: string | null;
  workerName: string;
  workerInstanceId?: string | null;
  correlationId?: string | null;
  causationId?: string | null;
  idempotencyKey: string;
  carrierCode?: string | null;
  serviceCode?: string | null;
  serviceName?: string | null;
  quotedLabelCostUsd?: number | null;
  estimatedDeliveryDays?: number | null;
  onTimeProbability?: number | null;
  trackingQualityScore?: number | null;
  claimRiskScore?: number | null;
  payloadJson?: Record<string, unknown>;
}

export class ShippingEvidenceService {
  async capture(input: CaptureShippingEvidenceInput) {
    return withTx(async (client) => {
      const forensicRepo = new ForensicEventRepository(client);
      const evidenceRepo = new ShippingEvidenceRepository(client);
      const mutationRepo = new MutationLedgerRepository(client);
      const journalRepo = new ProductJournalRepository(client);
      const summaryRepo = new PhaseSummaryRepository(client);

      const payloadJson = input.payloadJson ?? {};

      const event = await forensicRepo.append({
        processRunId: input.processRunId,
        processStepId: input.processStepId,
        correlationId: input.correlationId ?? null,
        causationId: input.causationId ?? null,
        entityType: input.entityType,
        entityPk: input.entityPk,
        eventType: 'shipping_evidence_captured',
        actionType: 'INSERT',
        actorType: 'worker',
        actorId: input.workerName,
        actorName: input.workerName,
        workerName: input.workerName,
        workerInstanceId: input.workerInstanceId ?? null,
        sourceTable: 'arb.shipping_evidence',
        sourcePk: null,
        queueName: input.queueName,
        jobId: input.jobId ?? null,
        idempotencyKey: input.idempotencyKey,
        beforeJson: {},
        afterJson: {
          carrierCode: input.carrierCode ?? null,
          serviceCode: input.serviceCode ?? null,
          serviceName: input.serviceName ?? null,
          quotedLabelCostUsd: input.quotedLabelCostUsd ?? null,
          estimatedDeliveryDays: input.estimatedDeliveryDays ?? null,
          onTimeProbability: input.onTimeProbability ?? null,
          trackingQualityScore: input.trackingQualityScore ?? null,
          claimRiskScore: input.claimRiskScore ?? null
        },
        evidenceJson: payloadJson,
        metricsJson: {},
        flagsJson: []
      });

      const evidence = await evidenceRepo.insert({
        processRunId: input.processRunId,
        processStepId: input.processStepId,
        forensicEventId: event.id,
        entityType: input.entityType,
        entityPk: input.entityPk,
        sourceListingNormalizedId: input.sourceListingNormalizedId ?? null,
        shipmentId: input.shipmentId ?? null,
        carrierCode: input.carrierCode ?? null,
        serviceCode: input.serviceCode ?? null,
        serviceName: input.serviceName ?? null,
        quotedLabelCostUsd: input.quotedLabelCostUsd ?? null,
        estimatedDeliveryDays: input.estimatedDeliveryDays ?? null,
        onTimeProbability: input.onTimeProbability ?? null,
        trackingQualityScore: input.trackingQualityScore ?? null,
        claimRiskScore: input.claimRiskScore ?? null,
        payloadJson
      });

      await mutationRepo.append({
        processRunId: input.processRunId,
        correlationId: input.correlationId ?? null,
        tableName: 'arb.shipping_evidence',
        rowPk: String(evidence.id),
        operationType: 'INSERT',
        changedFields: [
          'carrier_code',
          'service_code',
          'quoted_label_cost_usd',
          'estimated_delivery_days',
          'claim_risk_score'
        ],
        changeSummary: {
          forensicEventId: event.id,
          shippingEvidenceId: evidence.id
        },
        actorType: 'worker',
        actorId: input.workerName,
        workerName: input.workerName,
        workerInstanceId: input.workerInstanceId ?? null
      });

      await journalRepo.append({
        entityType: input.entityType,
        entityPk: input.entityPk,
        sourceListingNormalizedId: input.sourceListingNormalizedId ?? null,
        eventType: 'SHIPPING_EVIDENCE_CAPTURED',
        processName: 'forensic.capture_shipping',
        processStage: 'CAPTURE_SHIPPING',
        processRunId: input.processRunId,
        correlationId: input.correlationId ?? null,
        actorType: 'worker',
        actorId: input.workerName,
        actorName: input.workerName,
        workerName: input.workerName,
        workerInstanceId: input.workerInstanceId ?? null,
        reasonCodes: ['FORENSIC_CAPTURE'],
        riskFlags: [],
        eventSummary: `Shipping evidence captured for ${input.entityType}:${input.entityPk}`,
        eventDetailsJson: {
          forensicEventId: event.id,
          shippingEvidenceId: evidence.id
        }
      });

      await summaryRepo.append({
        entityType: input.entityType,
        entityPk: input.entityPk,
        processName: 'forensic.capture_shipping',
        processStage: 'CAPTURE_SHIPPING',
        processRunId: input.processRunId,
        summaryLine: `Shipping evidence captured: ${input.carrierCode ?? 'unknown'} ${input.serviceCode ?? ''}`.trim(),
        summaryOrder: 20
      });

      return {
        event,
        evidence
      };
    });
  }
}
