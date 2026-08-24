export type IncidentStatus="OPEN"|"ACKNOWLEDGED"|"INVESTIGATING"|"MITIGATED"|"RESOLVED"|"CLOSED"|"CANCELLED";
export type IncidentCommand="ACK"|"OWN"|"DECLINE";
export type IncidentCommandSource="SMS"|"APPLICATION";

export interface ActivationClaim{activationId:string;notificationId:string;attemptCount:number;}
export interface ActivationResult{incidentId:string;incidentKey:string;created:boolean;escalationState:"NONE"|"ACTIVE"|"BLOCKED_CONFIGURATION";}

export interface IncidentCommandInput{
  commandId:string;
  source:IncidentCommandSource;
  incidentKey:string;
  recipientId:string;
  command:IncidentCommand;
  occurredAt:string;
  correlationId:string;
  evidenceHash:string;
}

export interface IncidentCommandResult{
  commandId:string;
  incidentId:string;
  outcome:"APPLIED"|"NOOP"|"REJECTED";
  reason:string;
}

export interface IncidentTransitionInput{
  incidentId:string;
  actorRecipientId:string;
  targetStatus:"INVESTIGATING"|"MITIGATED"|"RESOLVED"|"CLOSED"|"CANCELLED";
  correlationId:string;
  reason:string;
  resolutionCode?:string;
}

export interface EscalationClaim{runtimeId:string;incidentId:string;escalationId:string;stepNumber:number;repeatNumber:number;}

export interface PreparedEscalationEmission{
  emissionId:string;
  runtimeId:string;
  incidentId:string;
  incidentKey:string;
  sourceEventId:string;
  eventType:string;
  schemaVersion:number;
  severity:"INFORMATIONAL"|"NOTICE"|"WARNING"|"HIGH"|"CRITICAL"|"EMERGENCY";
  classification:"PUBLIC"|"INTERNAL"|"CONFIDENTIAL"|"RESTRICTED";
  correlationId:string;
  rootEventId:string;
  sourceNotificationId:string;
  escalationPolicyKey:string;
  stepNumber:number;
  repeatNumber:number;
  targetAudienceKey:string;
  reason:string;
}

export interface EscalationEventEnvelope{
  sourceKey:"DOMAIN_10_OPERATIONS";
  sourceEventId:string;
  eventType:string;
  occurredAt:string;
  severity:PreparedEscalationEmission["severity"];
  classification:PreparedEscalationEmission["classification"];
  subjectType:"INCIDENT";
  subjectId:string;
  correlationId:string;
  schemaVersion:number;
  producer:"DOMAIN10_10D";
  payload:{
    incident_id:string;
    incident_key:string;
    root_event_id:string;
    source_notification_id:string;
    escalation_policy_key:string;
    escalation_step:number;
    repeat_number:number;
    target_audience_key:string;
    reason:string;
  };
}
