import { ProcessRunService } from '../../services/processRunService';
import { randomUUID } from 'crypto';

describe('finalizeProcessRunWorker integration', () => {
  it('placeholder integration test scaffold exists', async () => {
    expect(true).toBe(true);
  });

  it('starts a forensic run for finalization', async () => {
    const svc = new ProcessRunService();
    const { run, initialStep } = await svc.startForensicRun({
      processName: 'forensic.capture_listing',
      processStage: 'FINALIZE',
      actorType: 'system',
      actorId: 'jest',
      actorName: 'jest',
      idempotencyKey: `cert-finalize-${randomUUID()}`,
      entityType: 'listing',
      entityPk: 'listing:6001',
      initialStepName: 'finalize_step',
      initialQueueName: 'forensic.cert.finalize'
    });

    expect(run.run_id).toBeTruthy();
    expect(initialStep.step_name).toBe('finalize_step');
  });
});
