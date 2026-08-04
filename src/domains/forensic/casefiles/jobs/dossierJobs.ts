export const DOSSIER_QUEUE='domain7-case-dossier';
export type DossierJob={type:'ASSEMBLE'|'VERIFY';dossierId:string;sealId?:string;tenantKey:string;correlationId:string};
