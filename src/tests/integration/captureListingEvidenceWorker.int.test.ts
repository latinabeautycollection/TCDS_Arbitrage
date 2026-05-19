import { ProcessRunService } from '../../services/processRunService';
import { randomUUID } from 'crypto';

describe('captureListingEvidenceWorker integration', () => {
  it('placeholder integration test scaffold exists', async () => {
    expect(true).toBe(true);
  });

  it('starts a forensic run for listing evidence capture', async () => {
    const svc = new ProcessRunService();
    const { run, initialStep } = await svc.startForensicRun({
      processName: 'forensic.capture_listing',
      processStage: 'CAPTURE_LISTING',
      actorType: 'system',
      actorId: 'jest',
      actorName: 'jest',
      idempotencyKey: `cert-listing-${randomUUID()}`,
      entityType: 'listing',
      entityPk: 'listing:2001',
      initialStepName: 'capture_listing',
      initialQueueName: 'forensic.capture.listing'
    });

    expect(run.run_id).toBeTruthy();
    expect(initialStep.step_name).toBe('capture_listing');
  });
});
