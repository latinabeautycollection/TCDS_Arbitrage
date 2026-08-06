import type { Pool } from 'pg';
import { CertificationRepository } from '../repositories/certificationRepository';
import { CertificationService } from '../services/certificationService';
import { createCertificationRoutes } from '../routes/certificationRoutes';

export function createCertificationModule(pool: Pool) {
  const repository = new CertificationRepository(pool);
  const service = new CertificationService(repository);
  return { repository, service, router: createCertificationRoutes(service) };
}
