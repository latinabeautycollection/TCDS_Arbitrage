export class IncidentOperationsError extends Error{
  constructor(message:string,public readonly code:
    |"ACTIVATION_FAILED"|"COMMAND_REJECTED"|"INCIDENT_NOT_FOUND"|"ACTOR_NOT_AUTHORIZED"
    |"INVALID_TRANSITION"|"ESCALATION_BINDING_INVALID"|"ESCALATION_EMISSION_FAILED"
    |"LEASE_LOST"|"DATABASE_CONTRACT",public readonly retryable:boolean=false,
    options?:{cause?:unknown}){
    super(message,options);this.name="IncidentOperationsError";
  }
}
