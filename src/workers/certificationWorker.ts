import { Job } from 'bullmq';
import { createWorker } from '../queues/bullmq';
import { CertificationService } from '../services/certificationService';

const QUEUE = 'forensic.certification';
const WORKER = 'certificationWorker';

export interface CertificationJob {
  processRunId: string;
  entityType: string;
  entityPk: string;
  processName: string;
  idempotencyKey: string;
}

export const certificationWorker = createWorker<CertificationJob>(
  QUEUE,
  async (job: Job<CertificationJob>) => {
    const service = new CertificationService();

    const report = await service.runFullCertification({
      processRunId: job.data.processRunId,
      entityType: job.data.entityType,
      entityPk: job.data.entityPk,
      processName: job.data.processName,
      idempotencyKey: job.data.idempotencyKey
    });

    await service.stampCertification(job.data.processRunId, report);

    if (!report.overallOk) {
      throw new Error(`Certification failed for run ${job.data.processRunId}`);
    }

  }
);
