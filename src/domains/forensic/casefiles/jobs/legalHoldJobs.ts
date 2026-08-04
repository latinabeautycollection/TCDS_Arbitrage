export const LEGAL_HOLD_QUEUE='domain7-legal-hold';
export type LegalHoldJob={type:'MATERIALIZE_SCOPE'|'VERIFY_HOLD';entityId:string;tenantKey:string;correlationId:string};
