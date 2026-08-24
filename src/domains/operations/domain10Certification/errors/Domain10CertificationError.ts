export class Domain10CertificationError extends Error{
  constructor(
    message:string,
    public readonly code:
      | "INVALID_REQUEST"
      | "PROFILE_NOT_FROZEN"
      | "CERTIFICATION_WINDOW_INVALID"
      | "CERTIFICATION_STATE_INVALID"
      | "ATTESTATION_INVALID"
      | "DATABASE_CONTRACT"
  ){
    super(message);
    this.name="Domain10CertificationError";
  }
}
