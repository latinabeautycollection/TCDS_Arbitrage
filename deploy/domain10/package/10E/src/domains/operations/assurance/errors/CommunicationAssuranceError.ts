export class CommunicationAssuranceError extends Error{
  constructor(
    message:string,
    public readonly code:
      | "ASSURANCE_LEASE_LOST"
      | "ASSURANCE_POLICY_INVALID"
      | "ASSURANCE_METRIC_INVALID"
      | "ASSURANCE_EVENT_EMISSION_FAILED"
      | "DATABASE_CONTRACT"
  ){
    super(message);
    this.name="CommunicationAssuranceError";
  }
}
