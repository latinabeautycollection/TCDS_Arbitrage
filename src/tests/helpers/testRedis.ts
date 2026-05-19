import IORedis from 'ioredis';
import { Queue, QueueEvents } from 'bullmq';
import { env } from '../../config/env';
import { QueueNames } from '../../queues/queueNames';

export const TEST_REDIS_PREFIX = env.TEST_REDIS_PREFIX;

export const testRedis = new IORedis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD || undefined,
  db: env.REDIS_DB,
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  lazyConnect: true
});

export const TEST_QUEUE_NAMES: string[] = Object.values(QueueNames);

export function buildTestQueue(queueName: string): Queue {
  return new Queue(queueName, {
    connection: testRedis,
    prefix: TEST_REDIS_PREFIX,
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: true
    }
  });
}

export function buildTestQueueEvents(queueName: string): QueueEvents {
  return new QueueEvents(queueName, {
    connection: testRedis,
    prefix: TEST_REDIS_PREFIX
  });
}

export async function ensureTestRedisReady(): Promise<void> {
  if (testRedis.status !== 'ready') {
    await testRedis.connect();
  }

  const pong = await testRedis.ping();
  if (pong !== 'PONG') {
    throw new Error(`Redis ping failed. Expected PONG, got ${pong}`);
  }
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function resetTestQueue(queueName: string): Promise<void> {
  const queue = buildTestQueue(queueName);

  try {
    await queue.pause();
  } catch {}

  try {
    await queue.drain(true);
  } catch {}

  try {
    await queue.clean(0, 1000, 'completed');
    await queue.clean(0, 1000, 'failed');
    await queue.clean(0, 1000, 'wait');
    await queue.clean(0, 1000, 'active');
    await queue.clean(0, 1000, 'delayed');
    await queue.clean(0, 1000, 'paused');
  } catch {}

  try {
    await queue.obliterate({ force: true });
  } catch {}

  await queue.close();
}

export async function resetAllTestQueues(): Promise<void> {
  for (const queueName of TEST_QUEUE_NAMES) {
    await resetTestQueue(queueName);
  }
}

export async function clearTestRedisNamespace(): Promise<void> {
  await ensureTestRedisReady();

  const stream = testRedis.scanStream({
    match: `${TEST_REDIS_PREFIX}:*`,
    count: 500
  });

  const keysToDelete: string[] = [];

  await new Promise<void>((resolve, reject) => {
    stream.on('data', (keys: string[]) => {
      if (Array.isArray(keys) && keys.length > 0) {
        keysToDelete.push(...keys);
      }
    });

    stream.on('end', () => resolve());
    stream.on('error', (err) => reject(err));
  });

  const chunkSize = 500;
  for (let i = 0; i < keysToDelete.length; i += chunkSize) {
    const chunk = keysToDelete.slice(i, i + chunkSize);
    if (chunk.length > 0) {
      await testRedis.del(...chunk);
    }
  }
}

export async function resetTestRedis(): Promise<void> {
  await ensureTestRedisReady();
  await resetAllTestQueues();
  await clearTestRedisNamespace();
}

export async function getQueueCounts(queueName: string) {
  const queue = buildTestQueue(queueName);
  try {
    const counts = await queue.getJobCounts(
      'waiting',
      'active',
      'completed',
      'failed',
      'delayed',
      'paused'
    );

    return {
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      completed: counts.completed ?? 0,
      failed: counts.failed ?? 0,
      delayed: counts.delayed ?? 0,
      paused: counts.paused ?? 0
    };
  } finally {
    await queue.close();
  }
}

export async function waitForQueueToSettle(
  queueName: string,
  options?: {
    timeoutMs?: number;
    pollIntervalMs?: number;
  }
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? 15000;
  const pollIntervalMs = options?.pollIntervalMs ?? 250;
  const startedAt = Date.now();

  while (true) {
    const counts = await getQueueCounts(queueName);
    const unsettled =
      counts.waiting > 0 ||
      counts.active > 0 ||
      counts.delayed > 0;

    if (!unsettled) {
      return;
    }

    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(
        `Queue "${queueName}" did not settle within ${timeoutMs}ms. Counts=${JSON.stringify(counts)}`
      );
    }

    await sleep(pollIntervalMs);
  }
}

export async function waitForAllTestQueuesToSettle(
  options?: {
    timeoutMs?: number;
    pollIntervalMs?: number;
  }
): Promise<void> {
  for (const queueName of TEST_QUEUE_NAMES) {
    await waitForQueueToSettle(queueName, options);
  }
}

export async function closeTestRedis(): Promise<void> {
  if (testRedis.status === 'end') {
    return;
  }

  try {
    await testRedis.quit();
  } catch {
    testRedis.disconnect();
  }
}
