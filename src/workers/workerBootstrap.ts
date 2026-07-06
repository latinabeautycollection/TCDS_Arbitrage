import { logger } from '../lib/logger';
import { redisConnection } from '../queues/bullmq';
import { captureListingEvidenceWorker } from './captureListingEvidenceWorker';
import { captureShippingEvidenceWorker } from './captureShippingEvidenceWorker';
import { capturePricingEvidenceWorker } from './capturePricingEvidenceWorker';
import { computeLearningFeaturesWorker } from './computeLearningFeaturesWorker';
import { finalizeProcessRunWorker } from './finalizeProcessRunWorker';
import { candidateOpportunityWorker } from './candidateOpportunityWorker';
import { marketIntelForensicWorker } from './marketIntelForensicWorker';
import { certificationWorker } from './certificationWorker';
import { shippingCaptureSignalRelayWorker } from './shippingCaptureSignalRelayWorker';

type ManagedWorker = {
  name: string;
  instance: any;
  _unused?: {
    close: () => Promise<void>;
    on?: (event: string, handler: (...args: any[]) => void) => void;
  };
};

const managedWorkers: ManagedWorker[] = [
  { name: 'shippingCaptureSignalRelayWorker', instance: shippingCaptureSignalRelayWorker },
  { name: 'captureListingEvidenceWorker', instance: captureListingEvidenceWorker },
  { name: 'captureShippingEvidenceWorker', instance: captureShippingEvidenceWorker },
  { name: 'capturePricingEvidenceWorker', instance: capturePricingEvidenceWorker },
  { name: 'computeLearningFeaturesWorker', instance: computeLearningFeaturesWorker },
  { name: 'finalizeProcessRunWorker', instance: finalizeProcessRunWorker },
  { name: 'candidateOpportunityWorker', instance: candidateOpportunityWorker },
  { name: 'marketIntelForensicWorker', instance: marketIntelForensicWorker },
  { name: 'certificationWorker', instance: certificationWorker },
];

let shuttingDown = false;

function wireWorkerEvents(worker: ManagedWorker) {
  if (!worker.instance.on) return;
  worker.instance.on('ready', () => {
    logger.info({ worker: worker.name }, 'worker ready');
  });
  worker.instance.on('active', (job: any) => {
    logger.info({ worker: worker.name, jobId: job?.id ?? null }, 'worker job active');
  });
  worker.instance.on('completed', (job: any) => {
    logger.info({ worker: worker.name, jobId: job?.id ?? null }, 'worker job completed');
  });
  worker.instance.on('failed', (job: any, err: Error) => {
    logger.error({ worker: worker.name, jobId: job?.id ?? null, err }, 'worker job failed');
  });
  worker.instance.on('error', (err: Error) => {
    logger.error({ worker: worker.name, err }, 'worker error');
  });
  worker.instance.on('stalled', (jobId: string) => {
    logger.warn({ worker: worker.name, jobId }, 'worker job stalled');
  });
}

async function gracefulShutdown(signal: string) {
  if (shuttingDown) {
    logger.warn({ signal }, 'shutdown already in progress');
    return;
  }

  shuttingDown = true;
  logger.info({ signal }, 'worker bootstrap shutdown started');

  const closeResults = await Promise.allSettled(
    managedWorkers.map(async (worker) => {
      await worker.instance.close();
      logger.info({ worker: worker.name }, 'worker closed');
    })
  );

  for (const result of closeResults) {
    if (result.status === 'rejected') {
      logger.error({ err: result.reason }, 'worker close failure');
    }
  }

  try {
    await redisConnection.quit();
    logger.info('redis connection closed');
  } catch (err) {
    logger.error({ err }, 'failed to close redis connection');
  }

  process.exit(0);
}

async function main() {
  const ping = await redisConnection.ping();
  if (ping !== 'PONG') {
    throw new Error(`Redis ping failed during worker bootstrap. Response=${ping}`);
  }

  for (const worker of managedWorkers) {
    wireWorkerEvents(worker);
  }

  logger.info({ workers: managedWorkers.map((w) => w.name) }, 'worker bootstrap started');

  process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
  process.on('uncaughtException', (err) => {
    logger.error({ err }, 'uncaught exception in worker bootstrap');
    void gracefulShutdown('uncaughtException');
  });
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'unhandled rejection in worker bootstrap');
    void gracefulShutdown('unhandledRejection');
  });
}

void main().catch((err) => {
  logger.error({ err }, 'worker bootstrap failed to start');
  process.exit(1);
});
