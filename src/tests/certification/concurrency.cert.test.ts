import { CertificationService } from '../../services/certificationService';

describe('concurrency certification', () => {
  it('confirms idempotent reuse under concurrent-style certification path', async () => {
    const svc = new CertificationService();
    const result = await svc.checkConcurrency(
      'forensic.candidate_opportunity',
      'cert:concurrency:candidate:999'
    );
    expect(result.ok).toBe(true);
  });
});
