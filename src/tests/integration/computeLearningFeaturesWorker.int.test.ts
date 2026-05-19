import { ProcessRunService } from '../../services/processRunService';
import { randomUUID } from 'crypto';

describe('computeLearningFeaturesWorker integration', () => {
  it('placeholder integration test scaffold exists', async () => {
    expect(true).toBe(true);
  });

  it('starts a forensic run for learning feature computation', async () => {
    const svc = new ProcessRunService();
    const { run, initialStep } = await svc.startForensicRun({
      processName: 'forensic.capture_pricing',
      processStage: 'COMPUTE_LEARNING',
      actorType: 'system',
      actorId: 'jest',
      actorName: 'jest',
      idempotencyKey: `cert-learning-${randomUUID()}`,
      entityType: 'listing',
      entityPk: 'listing:5001',
      initialStepName: 'compute_learning_step',
      initialQueueName: 'forensic.cert.learning'
    });

    expect(run.run_id).toBeTruthy();
    expect(initialStep.step_name).toBe('compute_learning_step');
  });
});
