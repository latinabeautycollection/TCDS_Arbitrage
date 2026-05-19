import { CertificationService } from '../../services/certificationService';

describe('idempotent rerun certification', () => {
  it('reuses the same process run for the same idempotency key', async () => {
    const svc = new CertificationService();
    const result = await svc.checkIdempotentRerun(
      'forensic.market_intel',
      'cert:idempotent:market:777'
    );
    expect(result.ok).toBe(true);
  });
});
