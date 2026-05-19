import IORedis from 'ioredis';
import { Queue, Worker, Job } from 'bullmq';
import { env } from '../config/env';

export const redisConnection = new IORedis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null
});

export function createQueue(name: string): Queue {
  return new Queue(name, {
    connection: redisConnection,
    defaultJobOptions: {
      attempts: 5,
      removeOnComplete: 500,
      removeOnFail: 1000,
      backoff: {
        type: 'exponential',
        delay: 3000
      }
    }
  });
}

export function createWorker<T>(
  name: string,
  processor: (job: Job<T>) => Promise<void>
): Worker<T> {
  return new Worker<T>(name, processor, {
    connection: redisConnection,
    concurrency: env.WORKER_CONCURRENCY_DEFAULT
  });
}
