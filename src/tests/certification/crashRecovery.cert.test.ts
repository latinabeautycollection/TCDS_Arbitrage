import { CertificationService } from '../../services/certificationService';

describe('crash recovery certification', () => {
  it('finds no stale RUNNING steps for a certified run', async () => {
    const svc = new CertificationService();
    const result = await svc.checkCrashRecovery(process.env.TEST_CERT_RUN_ID as string);
    expect(result.ok).toBe(true);
  });
});
