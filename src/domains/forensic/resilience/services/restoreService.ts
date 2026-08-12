import { createHash } from 'node:crypto';
import type { ForensicPrincipal, RestorePlanInput } from '../models/resilienceTypes';
import { ArbExecutionAdapter } from '../adapters/arbExecutionAdapter';
import { ResilienceRepository } from '../repositories/resilienceRepository';

export class RestoreService {
  constructor(private readonly execution:ArbExecutionAdapter,private readonly repo:ResilienceRepository) {}

  request(principal:ForensicPrincipal,input:RestorePlanInput) {
    if(principal.assuranceLevel!=='AAL2'||!principal.permissions.includes('forensic.resilience.restore.request'))throw new Error('Forbidden');
    const requestHash=createHash('sha256').update(JSON.stringify(input)).digest('hex');
    return this.execution.execute({processName:'D7I1_RESTORE_REQUEST',queueName:'domain7i-restore',
      entityType:'RESTORE_PLAN',entityPk:input.idempotencyKey,idempotencyKey:input.idempotencyKey,principal,payload:input},
      c=>this.repo.requestRestore(principal,input,requestHash,c));
  }

  approve(principal:ForensicPrincipal,planId:string,idempotencyKey:string) {
    if(principal.assuranceLevel!=='AAL2'||!principal.permissions.includes('forensic.resilience.restore.approve'))throw new Error('Forbidden');
    return this.execution.execute({processName:'D7I1_RESTORE_APPROVE',queueName:'domain7i-restore',
      entityType:'RESTORE_PLAN',entityPk:planId,idempotencyKey,principal,payload:{planId}},
      c=>this.repo.approveRestore(planId,principal,c));
  }

  reconcile(principal:ForensicPrincipal,planId:string,idempotencyKey:string) {
    if(principal.assuranceLevel!=='AAL2'||!principal.permissions.includes('forensic.resilience.restore.execute'))throw new Error('Forbidden');
    return this.execution.execute({processName:'D7I1_RESTORE_RECONCILE',queueName:'domain7i-restore',
      entityType:'RESTORE_PLAN',entityPk:planId,idempotencyKey,principal,payload:{planId}},
      c=>this.repo.reconcile(planId,principal,c));
  }

  certify(principal:ForensicPrincipal,planId:string,decision:'CERTIFY'|'REJECT',reason:string,idempotencyKey:string) {
    if(principal.assuranceLevel!=='AAL2'||!principal.permissions.includes('forensic.resilience.restore.certify'))throw new Error('Forbidden');
    return this.execution.execute({processName:'D7I1_RESTORE_CERTIFY',queueName:'domain7i-restore',
      entityType:'RESTORE_PLAN',entityPk:planId,idempotencyKey,principal,payload:{planId,decision,reason}},
      c=>this.repo.certify(planId,decision,reason,principal,c));
  }
}
