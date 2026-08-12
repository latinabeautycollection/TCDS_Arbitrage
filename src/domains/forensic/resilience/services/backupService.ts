import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { BackupRequest, ForensicPrincipal } from '../models/resilienceTypes';
import type { ResilienceEnv } from '../config/resilienceEnv';
import { PostgresBackupProvider } from '../providers/postgresBackupProvider';
import { R2BackupProvider } from '../providers/r2BackupProvider';
import { ArbExecutionAdapter } from '../adapters/arbExecutionAdapter';
import { ResilienceRepository } from '../repositories/resilienceRepository';

export class BackupService {
  constructor(private readonly env:ResilienceEnv,private readonly pg:PostgresBackupProvider,
    private readonly r2:R2BackupProvider,private readonly execution:ArbExecutionAdapter,
    private readonly repo:ResilienceRepository) {}

  async execute(principal:ForensicPrincipal,input:BackupRequest) {
    if (principal.assuranceLevel!=='AAL2'||!principal.permissions.includes('forensic.resilience.backup.execute')) {
      throw new Error('Forbidden');
    }
    return this.execution.execute({
      processName:'D7I1_BACKUP_EXECUTE',queueName:'domain7i-backup',entityType:'BACKUP',
      entityPk:input.idempotencyKey,idempotencyKey:input.idempotencyKey,principal,payload:input,
    }, async context => {
      const requestHash=createHash('sha256').update(JSON.stringify(input)).digest('hex');
      const record=await this.repo.registerBackup(principal,{
        policyCode:input.policyCode,sourceReference:input.sourceDatabaseReference,
        primaryKey:input.primaryObjectKey,secondaryKey:input.secondaryObjectKey,requestHash,
      },context);
      const base=path.join(this.env.FORENSIC_BACKUP_STAGING_DIR,randomUUID());
      let encryptedPath:string|undefined;
      try {
        const backup=await this.pg.createEncryptedBackup(base,{
          tenantKey:principal.tenantKey,backupExecutionId:record.backup_execution_id,
        });
        encryptedPath=backup.encryptedPath;
        const metadata={
          sha256:backup.encryptedSha256,keyid:backup.keyId,keyversion:backup.keyVersion,
          encrypteddatakey:backup.encryptedDataKey,iv:backup.ivHex,authtag:backup.authTagHex,
        };
        const primary=await this.r2.upload(this.env.R2_FORENSIC_BACKUP_BUCKET,input.primaryObjectKey,encryptedPath,metadata);
        await this.r2.replicate(input.primaryObjectKey,input.secondaryObjectKey);
        const copies=await this.r2.verifyCopies({
          primaryKey:input.primaryObjectKey,secondaryKey:input.secondaryObjectKey,
          sha256:backup.encryptedSha256,bytes:backup.encryptedBytes,keyId:backup.keyId,
          keyVersion:backup.keyVersion,encryptedDataKey:backup.encryptedDataKey,
        });
        return this.repo.finalizeBackup(record.backup_execution_id,{
          encryptedSha256:backup.encryptedSha256,encryptedBytes:backup.encryptedBytes,
          keyId:backup.keyId,keyVersion:backup.keyVersion,encryptedDataKey:backup.encryptedDataKey,
          ivHex:backup.ivHex,authTagHex:backup.authTagHex,
          primaryVersionId:primary.versionId,primaryEtag:copies.primaryEtag,
          secondaryVersionId:copies.secondaryVersionId,secondaryEtag:copies.secondaryEtag,
          archiveReadable:true,secondaryVerified:true,
        },principal,context);
      } finally {
        if (encryptedPath) await fs.rm(encryptedPath,{force:true});
      }
    });
  }
}
