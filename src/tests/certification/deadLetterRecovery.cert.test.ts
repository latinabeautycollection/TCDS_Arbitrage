import { withTx } from '../../db/tx';
import { DeadLetterRepository } from '../../repositories/deadLetterRepository';
import { CertificationService } from '../../services/certificationService';

describe('dead-letter recovery certification', () => {
  it('records dead-letter rows and reports them', async () => {
    const runId = process.env.TEST_CERT_RUN_ID as string;

    await withTx(async (client) => {
      const repo = new DeadLetterRepository(client);
      await repo.insert({
        processRunId: runId,
        queueName: 'forensic.candidate.opportunity',
        entityType: 'candidate',
        entityPk: '123',
        errorCode: 'CERT_DLQ',
        errorMessage: 'certification dead-letter',
        payloadJson: { candidateId: 123 }
      });
    });

    const svc = new CertificationService();
    const result = await svc.checkDeadLetterRecovery(runId);

    expect(result.ok).toBe(true);
    expect((result.meta?.deadLetterCount as number) >= 1).toBe(true);
  });
});
