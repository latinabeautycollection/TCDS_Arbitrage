import type{ControlPrincipal,EvaluateControlRequest,RecoveryRequest,RecoveryApprovalRequest,RecoveryFinalizeRequest,ControlLogger}from'../models/controlTypes';
import{ControlRepository}from'../repositories/controlRepository';import{controlMetrics,type ControlMetrics}from'../observability/controlMetrics';

export class ControlService{
 constructor(private readonly repo:ControlRepository,private readonly logger:ControlLogger,private readonly metrics:ControlMetrics=controlMetrics){}
 private need(p:ControlPrincipal,permission:string){if(!p.permissions.includes(permission))throw Object.assign(new Error('CONTROL_PERMISSION_DENIED'),{statusCode:403})}
 async evaluate(p:ControlPrincipal,x:EvaluateControlRequest,worker=false){this.need(p,'governance.control.evaluate');const started=Date.now();
  try{const id=await this.repo.evaluateRule(x,await this.repo.componentId(worker?'DOMAIN11J_CONTROL_WORKER':'DOMAIN11J_CONTROL_ENGINE'),worker);
   this.metrics.decision('CREATED','POLICY_RULE');this.logger.warn('11J control decision created',{controlDecisionId:id,ruleCode:x.ruleCode,correlationId:x.correlationId});return{controlDecisionId:id}}
  catch(e){this.metrics.failure('evaluate',this.code(e));throw e}finally{this.metrics.observe('evaluate',(Date.now()-started)/1000)}}
 async requestRecovery(p:ControlPrincipal,x:RecoveryRequest){this.need(p,'governance.control.recovery');const id=await this.repo.requestRecovery(x,await this.repo.componentId('DOMAIN11J_RECOVERY_ENGINE'));this.metrics.recovery('REQUESTED');this.logger.info('11J recovery requested',{recoveryAttemptId:id,controlDecisionId:x.restrictedControlDecisionId});return{recoveryAttemptId:id}}
 async approveRecovery(p:ControlPrincipal,x:RecoveryApprovalRequest){this.need(p,'governance.control.recovery.approve');const id=await this.repo.approveRecovery(x,p);this.metrics.recovery(x.decision);return{manualApprovalId:id}}
 async finalizeRecovery(p:ControlPrincipal,x:RecoveryFinalizeRequest){this.need(p,'governance.control.recovery');const id=await this.repo.finalizeRecovery(x,await this.repo.componentId('DOMAIN11J_RECOVERY_ENGINE'));this.metrics.recovery('COMPLETED');return{controlDecisionId:id}}
 async syncPolicy(p:ControlPrincipal,input:{requestId:string;correlationId:string;idempotencyKey:string}){this.need(p,'governance.control.admin');const n=await this.repo.syncRules(input.requestId,input.correlationId,await this.repo.componentId('DOMAIN11J_CONTROL_ENGINE'),input.idempotencyKey);this.logger.info('11J policy rules synchronized',{ruleCount:n});return{rulesCreated:n}}
 async effective(p:ControlPrincipal){this.need(p,'governance.control.read');const rows=await this.repo.effectiveControls();const states=['GREEN','GUARDED','DEGRADED','PAUSED','BLOCKED','RECOVERY'];for(const s of states)this.metrics.setActive(s,rows.filter((r:any)=>r.desired_control_state===s).length);return rows}
 async decision(p:ControlPrincipal,id:string){this.need(p,'governance.control.read');return this.repo.decision(id)}
 private code(e:unknown){return typeof e==='object'&&e!==null&&'code'in e?String((e as any).code):'UNEXPECTED'}
}