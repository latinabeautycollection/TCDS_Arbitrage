import type { AccountabilityPrincipal, AuditEventInput, Domain11MutationInput, ExternalReferenceInput, LineageEdgeInput, EventLinkInput } from '../models/accountabilityTypes';
import { AccountabilityRepository } from '../repositories/accountabilityRepository';
import type { AccountabilityLogger, AccountabilityMetrics } from '../observability/accountabilityObservability';

export class AccountabilityService {
  constructor(
    private readonly repo:AccountabilityRepository,
    private readonly logger:AccountabilityLogger,
    private readonly metrics:AccountabilityMetrics
  ) {}

  private need(p:AccountabilityPrincipal,perm:string){
    if(!p.permissions.includes(perm)&&!p.permissions.includes('governance.lineage.admin')){
      throw Object.assign(new Error('permission_denied'),{statusCode:403});
    }
  }

  async domain11Mutation(p:AccountabilityPrincipal,x:Domain11MutationInput){
    this.need(p,'governance.mutation.write');
    const id=await this.repo.recordDomain11Mutation(p.authSessionId,x);
    this.metrics.evidenceRecorded('MUTATION');
    this.logger.info('11E Domain11 mutation recorded',{id,actor:p.reference});
    return id;
  }

  async externalReference(p:AccountabilityPrincipal,x:ExternalReferenceInput){
    this.need(p,'governance.lineage.external.report');
    const id=await this.repo.recordExternal(p.authSessionId,x);
    this.metrics.evidenceRecorded('EXTERNAL_REFERENCE');
    return id;
  }

  async audit(p:AccountabilityPrincipal,x:AuditEventInput){
    this.need(p,'governance.audit.write');
    const id=await this.repo.recordAudit(p.authSessionId,x);
    this.metrics.evidenceRecorded('AUDIT');
    return id;
  }

  async eventLink(p:AccountabilityPrincipal,x:EventLinkInput){
    this.need(p,'governance.lineage.write');
    return this.repo.recordEventLink(p.authSessionId,x);
  }

  async accessAudit(p:AccountabilityPrincipal,action:string,target:string,requestId:string,correlationId:string){
    await this.repo.recordAccessAudit(p.authSessionId,action,target,requestId,correlationId);
    this.metrics.evidenceRecorded('AUDIT_ACCESS');
  }

  async edge(p:AccountabilityPrincipal,x:LineageEdgeInput){
    this.need(p,'governance.lineage.write');
    const id=await this.repo.recordLineage(p.authSessionId,x);
    this.metrics.lineageRecorded(x.relationshipType);
    return id;
  }

  async revokeSourceAuthority(p:AccountabilityPrincipal,bindingId:string,reason:string){
    this.need(p,'governance.lineage.admin');
    const id=await this.repo.revokeSourceAuthority(p.authSessionId,bindingId,reason);
    this.logger.warn('11E source authority revoked',{bindingId,eventId:id,actor:p.reference});
    return id;
  }
}
