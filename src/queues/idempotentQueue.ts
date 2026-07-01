import { Queue } from 'bullmq';
import { uuid } from '../lib/crypto';

export interface IdempotentAddInput<T> {
  queue: Queue;
  queueName: string;
  payload: T;
  idempotencyKey: string;
  jobName?: string;
}

export async function addIdempotentJob<T>({
  queue,
  queueName,
  payload,
  idempotencyKey,
  jobName
}: IdempotentAddInput<T>) {
  const stableJobId = `${queueName}:${idempotencyKey}`.replace(/:/g, '_');
  return queue.add(jobName ?? queueName, payload, {
    jobId: stableJobId,
    deduplication: { id: stableJobId }
  } as any);
}

export function buildIdempotencyKey(parts: Array<string | number | null | undefined>): string {
  return parts.map(v => String(v ?? '')).join(':');
}

export function buildCorrelationId(): string {
  return uuid();
}
