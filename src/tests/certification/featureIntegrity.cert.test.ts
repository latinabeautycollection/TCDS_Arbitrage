import { CertificationService } from '../../services/certificationService';

describe('feature integrity certification', () => {
  it('passes feature integrity for a certified entity', async () => {
    const svc = new CertificationService();
    const result = await svc.checkFeatureIntegrity(
      process.env.TEST_CERT_ENTITY_TYPE as string,
      process.env.TEST_CERT_ENTITY_PK as string
    );
    expect(result.ok).toBe(true);
  });
});
