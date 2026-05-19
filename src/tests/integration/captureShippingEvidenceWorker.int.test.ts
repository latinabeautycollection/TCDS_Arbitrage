import { ProcessRunService } from '../../services/processRunService';
import { randomUUID } from 'crypto';

describe('captureShippingEvidenceWorker integration', () => {
  it('placeholder integration test scaffold exists', async () => {
    expect(true).toBe(true);
  });

  it('starts a forensic run for shipping evidence capture', async () => {
    const svc = new ProcessRunService();
    const { run, initialStep } = await svc.startForensicRun({
      processName: 'forensic.capture_shipping',
      processStage: 'CAPTURE_SHIPPING',
      actorType: 'system',
      actorId: 'jest',
      actorName: 'jest',
      idempotencyKey: `cert-shipping-${randomUUID()}`,
      entityType: 'listing',
      entityPk: 'listing:3001',
      initialStepName: 'capture_shipping',
      initialQueueName: 'forensic.capture.shipping'
    });

    expect(run.run_id).toBeTruthy();
    expect(initialStep.step_name).toBe('capture_shipping');
  });
});
