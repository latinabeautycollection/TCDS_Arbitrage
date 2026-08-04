export const RECOVERY_QUEUE='domain7-recovery';export type RecoveryJob={type:'BUILD_PACKAGE'|'RECONCILE';entityId:string;tenantKey:string;correlationId:string};
