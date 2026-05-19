import { ProcessRunService } from '../../services/processRunService';

describe('ProcessRunService integration', () => {
  it('starts a forensic run with an initial step', async () => {
    const service = new ProcessRunService();

    const result = await service.startForensicRun({
      processName: 'forensic.capture_listing',
      processStage: 'CAPTURE_LISTING',
      actorType: 'system',
      actorId: 'test',
      actorName: 'test',
      entityType: 'candidate',
      entityPk: '1',
      initialStepName: 'capture_listing',
      initialQueueName: 'forensic.capture.listing',
      idempotencyKey: `test:start:${Date.now()}`
    });

    expect(result.run.run_id).toBeTruthy();
    expect(result.initialStep.step_name).toBe('capture_listing');
  });
});
