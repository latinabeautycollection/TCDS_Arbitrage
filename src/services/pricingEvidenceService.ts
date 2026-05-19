import { withTx } from '../db/tx';
import { ForensicEventRepository } from '../repositories/forensicEventRepository';
import { PricingEvidenceRepository } from '../repositories/pricingEvidenceRepository';

export class PricingEvidenceService {
  async capture(input: {
    processRunId: number | string;
    processStepId: number;
    entityType: string;
    entityPk: string;
    queueName: string;
    jobId?: string | null;
    workerName: string;
    correlationId?: string | null;
    idempotencyKey: string;
    priceKind: string;
    amount?: number | null;
    currency?: string;
    feeRate?: number | null;
    marginEstimate?: number | null;
  }) {
    return withTx(async (client) => {
      const eventRepo = new ForensicEventRepository(client);
      const pricingRepo = new PricingEvidenceRepository(client);

      const event = await eventRepo.create({
        processRunId: String(input.processRunId),
        processStepId: input.processStepId,
        entityType: input.entityType,
        entityPk: input.entityPk,
        eventType: 'pricing_evidence_captured',
        actionType: 'capture',
        queueName: input.queueName,
        jobId: input.jobId ?? null,
        workerName: input.workerName,
        correlationId: input.correlationId ?? null,
        idempotencyKey: input.idempotencyKey,
        beforeJson: {},
        afterJson: {
          priceKind: input.priceKind,
          amount: input.amount,
          currency: input.currency ?? 'USD',
          feeRate: input.feeRate,
          marginEstimate: input.marginEstimate
        },
        evidenceJson: {},
        metricsJson: {}
      });

      const evidence = await pricingRepo.insert({
        processRunId: input.processRunId,
        forensicEventId: event.id,
        entityType: input.entityType,
        entityPk: input.entityPk,
        priceKind: input.priceKind,
        amount: input.amount ?? null,
        currency: input.currency ?? 'USD',
        feeRate: input.feeRate ?? null,
        marginEstimate: input.marginEstimate ?? null,
        evidencePayload: {
          queueName: input.queueName,
          workerName: input.workerName
        }
      });

      return { event, evidence };
    });
  }
}
