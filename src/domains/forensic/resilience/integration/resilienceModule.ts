import type { Pool } from 'pg';
import { parseResilienceEnv } from '../config/resilienceEnv';
import type { KeyManagementProvider } from '../providers/keyManagementProvider';
import { PostgresBackupProvider } from '../providers/postgresBackupProvider';
import { R2BackupProvider } from '../providers/r2BackupProvider';
import { ArbExecutionAdapter } from '../adapters/arbExecutionAdapter';
import { ResilienceRepository } from '../repositories/resilienceRepository';
import { BackupService } from '../services/backupService';
import { RestoreService } from '../services/restoreService';
import { createResilienceRoutes } from '../routes/resilienceRoutes';

export function createResilienceModule(pool:Pool,kms:KeyManagementProvider,envSource:NodeJS.ProcessEnv) {
  const env=parseResilienceEnv(envSource);
  const repository=new ResilienceRepository(pool);
  const execution=new ArbExecutionAdapter(pool);
  const backup=new BackupService(env,new PostgresBackupProvider(env,kms),new R2BackupProvider(env),execution,repository);
  const restore=new RestoreService(execution,repository);
  return {backup,restore,router:createResilienceRoutes(backup,restore)};
}
