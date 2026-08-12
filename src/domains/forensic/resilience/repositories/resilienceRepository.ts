import type { Pool } from 'pg';
import type { ExecutionContext, ForensicPrincipal, RestorePlanInput } from '../models/resilienceTypes';

export class ResilienceRepository {
  constructor(private readonly pool: Pool) {}

  async registerBackup(p: ForensicPrincipal, input: {
    policyCode:string; sourceReference:string; primaryKey:string; secondaryKey:string; requestHash:string;
  }, c: ExecutionContext) {
    const { rows } = await this.pool.query(`SELECT * FROM forensic.d7i1_register_backup_r3(
      $1,$2,$3,$4,$5,$6,$7::uuid,$8::uuid,$9)`,
      [p.tenantKey,input.policyCode,input.sourceReference,input.primaryKey,input.secondaryKey,
       input.requestHash,c.processRunId,c.correlationId,c.idempotencyKey]);
    return rows[0];
  }

  async finalizeBackup(id:string,result:unknown,p:ForensicPrincipal,c:ExecutionContext) {
    const { rows } = await this.pool.query(`SELECT * FROM forensic.d7i1_finalize_backup_r3(
      $1::uuid,$2::jsonb,$3::uuid,$4::uuid,$5::uuid,$6::uuid)`,
      [id,JSON.stringify(result),p.userId,p.authSessionId,c.processRunId,c.correlationId]);
    return rows[0];
  }

  async requestRestore(p:ForensicPrincipal,input:RestorePlanInput,requestHash:string,c:ExecutionContext) {
    const { rows } = await this.pool.query(`SELECT * FROM forensic.d7i1_request_restore_r3(
      $1,$2::uuid,$3,$4,$5,$6,$7::uuid,$8::uuid,$9::uuid,$10::uuid,$11)`,
      [p.tenantKey,input.backupExecutionId,input.recoveryNamespace,input.recoveryDatabaseUrl,
       input.reason,requestHash,p.userId,p.authSessionId,c.processRunId,c.correlationId,input.idempotencyKey]);
    return rows[0];
  }

  async approveRestore(planId:string,p:ForensicPrincipal,c:ExecutionContext) {
    const { rows } = await this.pool.query(`SELECT * FROM forensic.d7i1_approve_restore_r3(
      $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid)`,
      [planId,p.userId,p.authSessionId,c.processRunId,c.correlationId]);
    return rows[0];
  }

  async buildExpectedSnapshot(planId:string,p:ForensicPrincipal,c:ExecutionContext) {
    const { rows } = await this.pool.query(`SELECT * FROM forensic.d7i1_build_expected_snapshot_r3(
      $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid)`,
      [planId,p.userId,p.authSessionId,c.processRunId,c.correlationId]);
    return rows[0];
  }

  async recordObservedSnapshot(planId:string,input:{chainManifest:unknown;artifactManifest:unknown;legalHoldManifest:unknown},
    p:ForensicPrincipal,c:ExecutionContext) {
    const { rows } = await this.pool.query(`SELECT * FROM forensic.d7i1_record_observed_snapshot_r3(
      $1::uuid,$2::jsonb,$3::jsonb,$4::jsonb,$5::uuid,$6::uuid,$7::uuid,$8::uuid)`,
      [planId,JSON.stringify(input.chainManifest),JSON.stringify(input.artifactManifest),
       JSON.stringify(input.legalHoldManifest),p.userId,p.authSessionId,c.processRunId,c.correlationId]);
    return rows[0];
  }

  async reconcile(planId:string,p:ForensicPrincipal,c:ExecutionContext) {
    const { rows } = await this.pool.query(`SELECT * FROM forensic.d7i1_reconcile_restore_r3(
      $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid)`,
      [planId,p.userId,p.authSessionId,c.processRunId,c.correlationId]);
    return rows[0];
  }

  async certify(planId:string,decision:'CERTIFY'|'REJECT',reason:string,p:ForensicPrincipal,c:ExecutionContext) {
    const { rows } = await this.pool.query(`SELECT * FROM forensic.d7i1_certify_restore_r3(
      $1::uuid,$2,$3,$4::uuid,$5::uuid,$6::uuid,$7::uuid)`,
      [planId,decision,reason,p.userId,p.authSessionId,c.processRunId,c.correlationId]);
    return rows[0];
  }
}
