import { CertificationService } from '../../services/certificationService';

describe('replay certification', () => {
  it('passes replay safety for a known forensic run', async () => {
    const svc = new CertificationService();
    const result = await svc.checkReplay(process.env.TEST_CERT_RUN_ID as string);
    expect(result.ok).toBe(true);
  });
});
