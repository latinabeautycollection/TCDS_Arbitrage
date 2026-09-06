export type ControlState='GREEN'|'GUARDED'|'DEGRADED'|'PAUSED'|'BLOCKED'|'RECOVERY';
export type TriggerAuthority='11C'|'11D'|'11F'|'11I';
export interface ControlPrincipal{
 reference:string;authSessionId:string;permissions:string[];
}
export interface EvaluateControlRequest{
 ruleCode:string;triggerReference:string;requestId:string;correlationId:string;
 causationId?:string;idempotencyKey:string;
}
export interface RecoveryRequest{
 restrictedControlDecisionId:string;recoveryTriggerReference:string;
 requestId:string;correlationId:string;idempotencyKey:string;
}
export interface RecoveryApprovalRequest{
 recoveryAttemptId:string;decision:'APPROVE'|'REJECT';justification:string;
 requestId:string;correlationId:string;
}
export interface RecoveryFinalizeRequest{
 recoveryAttemptId:string;requestId:string;correlationId:string;idempotencyKey:string;
}
export interface TriggerCandidate{
 authority:TriggerAuthority;reference:string;correlationId:string|null;
}
export interface ActiveRuleRef{ruleCode:string;triggerAuthority:TriggerAuthority}
export interface ControlLogger{
 info(message:string,fields?:Record<string,unknown>):void;
 warn(message:string,fields?:Record<string,unknown>):void;
 error(message:string,fields?:Record<string,unknown>):void;
}
