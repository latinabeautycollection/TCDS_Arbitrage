import { ProcessRunService } from '../../services/processRunService';
import { buildIdempotencyKey } from '../../queues/idempotentQueue';
import { randomUUID } from 'crypto';

describe('replay/idempotency integration', () => {
  it('builds deterministic idempotency keys', () => {
    const key = buildIdempotencyKey(['run', '123', 'step', 'capture']);
    expect(key).toBe('run:123:step:capture');
  });

  it('does not duplicate process runs for same idempotency scope', async () => {
    const svc = new ProcessRunService();
    const idempotencyKey = `cert-replay-${randomUUID()}`;

    const baseInput = {
      processName: 'forensic.market_intel',
      processStage: 'INTEGRATION_TEST',
      actorType: 'system' as const,
      actorId: 'jest',
      actorName: 'jest',
      idempotencyKey,
      entityType: 'listing',
      entityPk: 'listing:7001',
      initialQueueName: 'forensic.cert.replay'
    };

    const a = await svc.startForensicRun({ ...baseInput, initialStepName: 'replay_step_a' });
    const b = await svc.startForensicRun({ ...baseInput, initialStepName: 'replay_step_b' });
    const c = await svc.startForensicRun({ ...baseInput, initialStepName: 'replay_step_c' });

    expect(a.run.run_id).toBe(b.run.run_id);
    expect(b.run.run_id).toBe(c.run.run_id);
  });
});
