import { createHash } from 'node:crypto';
import type {
  ForensicPrincipal, StartCertificationInput, InstallationCertificateInput,
} from '../models/certificationTypes';
import { CertificationRepository } from '../repositories/certificationRepository';

export class CertificationService {
  constructor(private readonly repo: CertificationRepository) {}

  private require(p: ForensicPrincipal, permission: string): void {
    if (p.assuranceLevel !== 'AAL2' || !p.permissions.includes(permission)) {
      throw new Error('Forbidden');
    }
  }

  async startAndRun(p: ForensicPrincipal, input: StartCertificationInput) {
    this.require(p, 'forensic.certification.execute');
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const run = await this.repo.start(p, input, hash);
    await this.repo.runChecks(run.certification_run_id, p, input.processRunId);
    return this.repo.get(run.certification_run_id, p);
  }

  certificate(p: ForensicPrincipal, runId: string, input: InstallationCertificateInput) {
    this.require(p, 'forensic.certification.execute');
    return this.repo.createInstallationCertificate(runId, p, input);
  }

  seal(p: ForensicPrincipal, runId: string) {
    this.require(p, 'forensic.certification.execute');
    return this.repo.seal(runId, p);
  }

  decide(p: ForensicPrincipal, runId: string, decision: 'APPROVE' | 'REJECT', reason: string) {
    this.require(p, 'forensic.certification.approve');
    return this.repo.decide(runId, decision, reason, p);
  }

  get(p: ForensicPrincipal, runId: string) {
    this.require(p, 'forensic.certification.view');
    return this.repo.get(runId, p);
  }

  attempts(p: ForensicPrincipal, runId: string) {
    this.require(p, 'forensic.certification.view');
    return this.repo.attempts(runId, p);
  }
}
