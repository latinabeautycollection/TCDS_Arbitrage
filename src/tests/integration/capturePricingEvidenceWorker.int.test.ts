import { ProcessRunService } from '../../services/processRunService';
import { randomUUID } from 'crypto';

describe('capturePricingEvidenceWorker integration', () => {
  it('placeholder integration test scaffold exists', async () => {
    expect(true).toBe(true);
  });

  it('starts a forensic run for pricing evidence capture', async () => {
    const svc = new ProcessRunService();
    const { run, initialStep } = await svc.startForensicRun({
      processName: 'forensic.capture_pricing',
      processStage: 'CAPTURE_PRICING',
      actorType: 'system',
      actorId: 'jest',
      actorName: 'jest',
      idempotencyKey: `cert-pricing-${randomUUID()}`,
      entityType: 'listing',
      entityPk: 'listing:4001',
      initialStepName: 'capture_pricing',
      initialQueueName: 'forensic.capture.pricing'
    });

    expect(run.run_id).toBeTruthy();
    expect(initialStep.step_name).toBe('capture_pricing');
  });
});
