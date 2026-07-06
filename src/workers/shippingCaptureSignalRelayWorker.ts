import os from 'node:os';
import { createQueue } from '../queues/bullmq';
import { QueueNames } from '../queues/queueNames';
import { addIdempotentJob, buildIdempotencyKey } from '../queues/idempotentQueue';
import { withTx } from '../db/tx';
import { logger } from '../lib/logger';
import { ProcessRunRepository } from '../repositories/processRunRepository';
import { ProcessStepRepository } from '../repositories/processStepRepository';

const workerName = 'shippingCaptureSignalRelayWorker';
const captureShippingQueue = createQueue(QueueNames.CAPTURE_SHIPPING);

type OutboxRow = {
  id: number;
  signal_hash: string;
  attempts: number;
  max_attempts: number;
  process_run_id: string | null;
  process_step_id: number | null;
  candidate_id: number | null;
  listing_id: string | null;
  source_listing_normalized_id: number | null;
  entity_type: string;
  entity_pk: string;
  payload_json: Record<string, unknown>;
};

function numberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export class ShippingCaptureSignalRelayWorker {
  private timer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(
    private readonly intervalMs = Number(process.env.SHIPPING_CAPTURE_RELAY_INTERVAL_MS ?? 5000),
    private readonly batchSize = Number(process.env.SHIPPING_CAPTURE_RELAY_BATCH_SIZE ?? 25)
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.runOnce().catch((err) => logger.error({ err }, 'shipping capture relay loop failed'));
    }, this.intervalMs);
    this.timer.unref?.();
    void this.runOnce().catch((err) => logger.error({ err }, 'shipping capture relay initial run failed'));
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await captureShippingQueue.close();
  }

  on(_event: string, _handler: (...args: any[]) => void): void {
    // Compatibility with workerBootstrap ManagedWorker shape.
  }

  async runOnce(): Promise<number> {
    if (this.closed) return 0;
    let processed = 0;

    for (let i = 0; i < this.batchSize; i += 1) {
      const row = await this.claimNext();
      if (!row) break;

      try {
        await this.publish(row);
        processed += 1;
      } catch (error: any) {
        await this.markFailed(row, error);
      }
    }

    return processed;
  }

  private async claimNext(): Promise<OutboxRow | null> {
    return withTx(async (client) => {
      const { rows } = await client.query(
        `
        WITH candidate AS (
          SELECT *
          FROM arb.shipping_capture_signal_outbox
          WHERE status IN ('PENDING','FAILED')
            AND attempts < max_attempts
            AND available_at <= now()
          ORDER BY priority ASC, created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE arb.shipping_capture_signal_outbox o
        SET
          status = 'CLAIMED',
          attempts = o.attempts + 1,
          locked_by = $1,
          locked_at = now(),
          updated_at = now()
        FROM candidate
        WHERE o.id = candidate.id
        RETURNING o.*
        `,
        [`${workerName}:${process.pid}`]
      );

      return rows[0] ?? null;
    });
  }

  private async publish(row: OutboxRow): Promise<void> {
    const workerInstanceId = `${workerName}:${process.pid}`;
    const entityType = row.entity_type || 'listing';
    const entityPk = String(row.entity_pk);
    const payloadJson = row.payload_json ?? {};
    const sourceListingNormalizedId =
      row.source_listing_normalized_id ??
      numberOrNull((payloadJson as any).source_listing_normalized_id) ??
      numberOrNull((payloadJson as any).sourceListingId) ??
      numberOrNull(entityPk);

    const processContext = await withTx(async (client) => {
      const runRepo = new ProcessRunRepository(client);
      const stepRepo = new ProcessStepRepository(client);
      const idempotencyKey = buildIdempotencyKey(['shipping-capture-signal', row.signal_hash]);

      const run = row.process_run_id
        ? await runRepo.getByRunId(row.process_run_id)
        : await runRepo.createOrGetIdempotent({
            processName: 'forensic.capture_shipping',
            processStage: 'CAPTURE_SHIPPING_RELAY',
            correlationId: String((payloadJson as any).correlationId ?? (payloadJson as any).correlation_id ?? row.signal_hash),
            actorType: 'worker',
            actorId: workerInstanceId,
            actorName: workerName,
            workerName,
            workerInstanceId,
            hostName: os.hostname(),
            entityType,
            entityCount: 1,
            detailsJson: {
              shippingCaptureSignalOutboxId: row.id,
              signalHash: row.signal_hash,
              candidateId: row.candidate_id,
              sourceListingNormalizedId,
            },
            idempotencyKey,
          });

      if (!run?.run_id) {
        throw new Error(`Unable to create or resolve process run for shipping capture signal ${row.id}`);
      }

      const step = row.process_step_id
        ? { id: row.process_step_id }
        : await stepRepo.create({
            processRunId: String(run.run_id),
            stepName: 'capture_shipping',
            queueName: QueueNames.CAPTURE_SHIPPING,
            entityType,
            entityPk,
            idempotencyKey: buildIdempotencyKey(['shipping-capture-step', row.signal_hash]),
            payloadJson: {
              ...payloadJson,
              shipping_capture_signal_outbox_id: row.id,
              signal_hash: row.signal_hash,
              source_listing_normalized_id: sourceListingNormalizedId,
              candidate_id: row.candidate_id ?? (payloadJson as any).candidate_id ?? null,
              listing_id: row.listing_id ?? (payloadJson as any).listing_id ?? null,
              entity_type: entityType,
              entity_pk: entityPk,
            },
          });

      await client.query(
        `
        UPDATE arb.shipping_capture_signal_outbox
        SET process_run_id = $2,
            process_step_id = $3,
            source_listing_normalized_id = coalesce(source_listing_normalized_id, $4),
            updated_at = now()
        WHERE id = $1
        `,
        [row.id, run.run_id, step.id, sourceListingNormalizedId]
      );

      return { runId: String(run.run_id), stepId: Number(step.id) };
    });

    const jobPayload = {
      processRunId: processContext.runId,
      processStepId: processContext.stepId,
      entityType,
      entityPk,
      candidateId: row.candidate_id ?? (payloadJson as any).candidate_id ?? null,
      sourceListingNormalizedId,
      listingId: row.listing_id ?? (payloadJson as any).listing_id ?? null,
      correlationId: String((payloadJson as any).correlationId ?? (payloadJson as any).correlation_id ?? row.signal_hash),
      causationId: String(row.id),
      idempotencyKey: buildIdempotencyKey(['capture-shipping', row.signal_hash]),
      shippingCaptureSignalOutboxId: row.id,
      signalHash: row.signal_hash,
      payloadJson: {
        ...payloadJson,
        shipping_capture_signal_outbox_id: row.id,
        signal_hash: row.signal_hash,
        source_listing_normalized_id: sourceListingNormalizedId,
        entity_type: entityType,
        entity_pk: entityPk,
      },
    };

    await addIdempotentJob({
      queue: captureShippingQueue,
      queueName: QueueNames.CAPTURE_SHIPPING,
      idempotencyKey: jobPayload.idempotencyKey,
      payload: jobPayload,
    });

    logger.info(
      {
        outboxId: row.id,
        processRunId: processContext.runId,
        processStepId: processContext.stepId,
        queueName: QueueNames.CAPTURE_SHIPPING,
      },
      'shipping capture signal relayed to forensic capture queue'
    );
  }

  private async markFailed(row: OutboxRow, error: Error): Promise<void> {
    await withTx(async (client) => {
      await client.query(
        `
        UPDATE arb.shipping_capture_signal_outbox
        SET status = CASE WHEN attempts >= max_attempts THEN 'DEAD_LETTER' ELSE 'FAILED' END,
            last_error = $2,
            available_at = CASE WHEN attempts >= max_attempts THEN available_at ELSE now() + interval '60 seconds' END,
            updated_at = now()
        WHERE id = $1
        `,
        [row.id, error.message]
      );
    });

    logger.error({ outboxId: row.id, err: error }, 'shipping capture signal relay failed');
  }
}

export const shippingCaptureSignalRelayWorker = new ShippingCaptureSignalRelayWorker();
shippingCaptureSignalRelayWorker.start();
