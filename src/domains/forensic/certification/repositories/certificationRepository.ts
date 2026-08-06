import type { Pool } from 'pg';
import type {
  ForensicPrincipal, StartCertificationInput, InstallationCertificateInput,
} from '../models/certificationTypes';

export class CertificationRepository {
  constructor(private readonly pool: Pool) {}

  async start(p: ForensicPrincipal, i: StartCertificationInput, requestHash: string) {
    const { rows } = await this.pool.query(
      `SELECT * FROM forensic.d7j1_start_certification_r5(
        $1,$2,$3,$4,$5,$6,$7::uuid,$8::uuid,$9)`,
      [p.tenantKey, i.releaseCode, i.sourceCommit, i.environment, i.buildArtifactSha256,
       requestHash, p.userId, p.authSessionId, i.idempotencyKey],
    );
    return rows[0];
  }

  async runChecks(runId: string, p: ForensicPrincipal, processRunId: string) {
    const { rows } = await this.pool.query(
      `SELECT * FROM forensic.d7j1_execute_registered_checks_r5(
        $1::uuid,$2::uuid,$3::uuid,$4::uuid)`,
      [runId, p.userId, p.authSessionId, processRunId],
    );
    return rows;
  }

  async createInstallationCertificate(
    runId: string, p: ForensicPrincipal, i: InstallationCertificateInput,
  ) {
    const { rows } = await this.pool.query(
      `SELECT * FROM forensic.d7j1_generate_installation_certificate_r5(
        $1::uuid,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,
        $10,$11::uuid,$12::uuid)`,
      [runId, i.databaseName, i.serverVersion, JSON.stringify(i.migrationManifest),
       JSON.stringify(i.buildReport), JSON.stringify(i.smokeReport),
       JSON.stringify(i.routeReport), JSON.stringify(i.workerReport),
       JSON.stringify(i.queueReport), i.cloneFingerprint, p.userId, p.authSessionId],
    );
    return rows[0];
  }

  async seal(runId: string, p: ForensicPrincipal) {
    const { rows } = await this.pool.query(
      `SELECT * FROM forensic.d7j1_seal_certification_r5($1::uuid,$2::uuid,$3::uuid)`,
      [runId, p.userId, p.authSessionId],
    );
    return rows[0];
  }

  async decide(runId: string, decision: 'APPROVE' | 'REJECT', reason: string, p: ForensicPrincipal) {
    const { rows } = await this.pool.query(
      `SELECT * FROM forensic.d7j1_decide_release_r5($1::uuid,$2,$3,$4::uuid,$5::uuid)`,
      [runId, decision, reason, p.userId, p.authSessionId],
    );
    return rows[0];
  }

  async get(runId: string, p: ForensicPrincipal) {
    const { rows } = await this.pool.query(
      `SELECT * FROM forensic.d7j1_get_certification_r5($1::uuid,$2,$3::uuid,$4::uuid)`,
      [runId, p.tenantKey, p.userId, p.authSessionId],
    );
    return rows[0];
  }

  async attempts(runId: string, p: ForensicPrincipal) {
    const { rows } = await this.pool.query(
      `SELECT * FROM forensic.d7j1_list_attempts_r5($1::uuid,$2,$3::uuid,$4::uuid)`,
      [runId, p.tenantKey, p.userId, p.authSessionId],
    );
    return rows;
  }
}
