import { CertificationService } from '../../services/certificationService';

describe('evidence lineage certification', () => {
  it('passes lineage validation for a certified run', async () => {
    const svc = new CertificationService();
    const result = await svc.checkEvidenceLineage(process.env.TEST_CERT_RUN_ID as string);
    expect(result.ok).toBe(true);
  });
});
