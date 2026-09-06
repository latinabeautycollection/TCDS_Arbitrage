import type { CapitalSafetyPrincipal,CapitalSafetyRequest } from '../models/capitalSafetyTypes';
import { evaluateCapitalSafety } from '../engines/capitalSafetyDecisionEngine';
import { CapitalSafetyRepository } from '../repositories/capitalSafetyRepository';
import type { CapitalStateProvider } from '../providers/domain2CapitalStateProvider';
import type { CapitalSafetyLogger,CapitalSafetyMetrics } from '../observability/capitalSafetyObservability';

export class CapitalSafetyService{
  constructor(
    private readonly repo:CapitalSafetyRepository,
    private readonly financialProvider:CapitalStateProvider,
    private readonly logger:CapitalSafetyLogger,
    private readonly metrics:CapitalSafetyMetrics
  ){}

  private need(p:CapitalSafetyPrincipal,permission:string){
    if(!p.permissions.includes(permission)&&!p.permissions.includes('governance.capital-safety.admin')){
      throw Object.assign(new Error('CAPITAL_SAFETY_PERMISSION_DENIED'),{statusCode:403});
    }
  }

  async assess(p:CapitalSafetyPrincipal,request:CapitalSafetyRequest){
    this.need(p,'governance.capital-safety.assess');
    const started=process.hrtime.bigint();
    try{return await this.repo.withTransaction(async client=>{
      const proposal=await this.repo.loadProposal(client,request.capitalAllocationRunId,request.sourceRecordId);
      await this.repo.lockEnvelope(client,proposal.currencyCode);
      const policy=await this.repo.loadPolicy(client);
      const readinessComponentId=policy?String(policy.configuration.capitalExecutionComponentId??''):'';
      const readiness=readinessComponentId?await this.repo.loadReadiness(client,readinessComponentId):null;
      const financial=await this.financialProvider.load(client,proposal.capitalAllocationRunId,proposal.currencyCode);
      const exposure=await this.repo.loadExposure(client,proposal,financial);
      const decision=evaluateCapitalSafety({proposal,financial,readiness,policy,exposure,now:new Date()});

      if(!policy||!readiness){
        const failClosedReasons=[...new Set([...decision.reasonCodes,!policy?'ACTIVE_CERTIFIED_POLICY_MISSING':'',!readiness?'EFFECTIVE_READINESS_MISSING':''].filter(Boolean))];
        const assessmentId=await this.repo.persistFailClosed(client,{
          proposal,financial,reasonCodes:failClosedReasons,validUntil:decision.validUntil,
          correlationId:request.correlationId,idempotencyKey:request.idempotencyKey,requestedBy:p.reference
        });
        this.metrics.assessment('UNKNOWN');
        this.logger.warn('Domain11F capital safety failed closed',{assessmentId,externalDecisionId:proposal.externalDecisionId,reasons:failClosedReasons,correlationId:request.correlationId});
        return {
          assessmentId,evaluationState:'UNKNOWN' as const,assessmentState:'HOLD' as const,
          assessmentAllowsExecutionSubjectToRevalidation:false,executionRevalidationRequired:true,reasonCodes:failClosedReasons,
          validUntil:decision.validUntil,persisted:true,
          note:'Required certified policy/readiness evidence unavailable; immutable HOLD evidence persisted.'
        };
      }

      const assessmentId=await this.repo.persist(client,{
        proposal,financial,decision,policy,readiness,correlationId:request.correlationId,
        idempotencyKey:request.idempotencyKey,requestedBy:p.reference
      });
      this.metrics.assessment(decision.evaluationState);
      this.logger.info('Domain11F capital safety assessed',{
        assessmentId,externalDecisionId:proposal.externalDecisionId,evaluationState:decision.evaluationState,
        assessmentState:decision.assessmentState,requestedAmount:proposal.requestedAmount,currency:proposal.currencyCode,
        requestedBy:p.reference,correlationId:request.correlationId
      });
      return {
        assessmentId,evaluationState:decision.evaluationState,assessmentState:decision.assessmentState,
        assessmentAllowsExecutionSubjectToRevalidation:decision.assessmentState==='ALLOW'||decision.assessmentState==='ALLOW_WITH_GUARD',executionRevalidationRequired:true,
        reasonCodes:decision.reasonCodes,validUntil:decision.validUntil,persisted:true
      };
    });}catch(error){
      const reason=error instanceof Error?error.message:'UNKNOWN_ERROR';
      this.metrics.rejection(reason.slice(0,120));
      this.logger.error('Domain11F capital safety assessment failed',{reason,correlationId:request.correlationId,requestedBy:p.reference});
      throw error;
    }finally{
      this.metrics.duration(Number(process.hrtime.bigint()-started)/1_000_000_000,'completed');
    }
  }

  async current(p:CapitalSafetyPrincipal,id:string){this.need(p,'governance.capital-safety.read');return this.repo.getCurrent(id);}
  async revalidate(p:CapitalSafetyPrincipal,id:string){this.need(p,'governance.capital-safety.read');return this.repo.revalidate(id);}
  async recent(p:CapitalSafetyPrincipal,limit:number){this.need(p,'governance.capital-safety.read');return this.repo.listRecent(limit);}
}
