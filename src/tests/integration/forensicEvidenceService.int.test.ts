import { ForensicEvidenceService } from '../../services/forensicEvidenceService';
import { ProcessRunService } from '../../services/processRunService';
import { randomUUID } from 'crypto';

describe('ForensicEvidenceService integration', () => {
  it('records a forensic event', async () => {
    const runService = new ProcessRunService();
    const idempotencyKey = `cert-evidence-${randomUUID()}`;

    const { run } = await runService.startForensicRun({
      processName: 'forensic.candidate_opportunity',
      processStage: 'INTEGRATION_TEST',
      actorType: 'system',
      actorId: 'jest',
      actorName: 'jest',
      idempotencyKey,
      entityType: 'candidate',
      entityPk: '1',
      initialStepName: 'evidence_test_step',
      initialQueueName: 'forensic.cert.evidence'
    });

    const service = new ForensicEvidenceService();

    const event = await service.record({
      processRunId: run.run_id,
      entityType: 'candidate',
      entityPk: '1',
      eventType: 'test_event',
      actionType: 'INSERT',
      sourceTable: 'arb.test_table',
      sourcePk: '1',
      actorType: 'system',
      actorId: 'jest',
      actorName: 'jest',
      beforeJson: {},
      afterJson: { ok: true }
    });

    expect(event.id).toBeTruthy();
    expect(event.event_type).toBe('test_event');
  });
});
