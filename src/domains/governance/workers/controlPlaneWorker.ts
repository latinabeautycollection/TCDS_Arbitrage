import{randomUUID}from'node:crypto';
import type{ControlRepository}from'../repositories/controlRepository';
import type{ControlService}from'../services/controlService';
import type{ControlLogger,ControlPrincipal,TriggerCandidate}from'../models/controlTypes';

export class ControlPlaneWorker{
 constructor(private readonly repo:ControlRepository,private readonly service:ControlService,private readonly logger:ControlLogger,private readonly principal:ControlPrincipal){}
 private classify(e:unknown):'NOT_MATCHED'|'STALE'|'FAILED'{const m=String((e as any)?.message??'');if(m.includes('CONTROL_TRIGGER_STATE_DOES_NOT_MATCH_RULE'))return'NOT_MATCHED';if(m.includes('TOO_OLD')||m.includes('NOT_CURRENT')||m.includes('EXPIRED'))return'STALE';return'FAILED'}
 async processTrigger(c:TriggerCandidate){const rules=await this.repo.activeRules(c.authority);for(const rule of rules){let outcome:'MATCHED'|'NOT_MATCHED'|'STALE'|'FAILED'='FAILED';try{await this.service.evaluate(this.principal,{ruleCode:rule.ruleCode,triggerReference:c.reference,requestId:randomUUID(),correlationId:c.correlationId??randomUUID(),idempotencyKey:`11j:v2:auto:${c.authority}:${c.reference}:${rule.controlRuleId}`},true);outcome='MATCHED'}catch(e){outcome=this.classify(e);if(outcome==='FAILED'){this.logger.error('11J rule evaluation failed',{authority:c.authority,reference:c.reference,ruleCode:rule.ruleCode,error:String((e as any)?.message??e)})}}finally{if(outcome!=='FAILED')await this.repo.markRuleProcessed(c,rule,outcome)}}}
 async tick(limit=100){const workerComponent=await this.repo.componentId('DOMAIN11J_CONTROL_WORKER');
  for(const t of await this.repo.triggerCandidates(limit)){try{await this.processTrigger(t)}catch(e){this.logger.error('11J trigger processing failed',{authority:t.authority,reference:t.reference,error:String((e as any)?.message??e)})}}
  for(const a of await this.repo.approvedRecoveries(limit)){try{await this.repo.activateApprovedRecovery(String(a.recovery_attempt_id),randomUUID(),String(a.correlation_id??randomUUID()),await this.repo.componentId('DOMAIN11J_RECOVERY_ENGINE'))}catch(err){this.logger.error('11J approved recovery activation failed',{recoveryAttemptId:a.recovery_attempt_id,error:String((err as any)?.message??err)})}}
  for(const e of await this.repo.actionAckEvents(limit)){try{await this.repo.reconcileActionAck(String(e.domain_event_id),randomUUID(),workerComponent,`11j:v2:ack:${e.domain_event_id}`)}catch(err){this.logger.error('11J action acknowledgement reconciliation failed',{domainEventId:e.domain_event_id,error:String((err as any)?.message??err)})}}
  for(const x of await this.repo.expiredControls(limit)){try{await this.repo.reconcileExpiredOne(x.control_decision_id,randomUUID(),randomUUID(),workerComponent)}catch(err){this.logger.error('11J single-control expiry reconciliation failed',{controlDecisionId:x.control_decision_id,error:String((err as any)?.message??err)})}}
 }}
