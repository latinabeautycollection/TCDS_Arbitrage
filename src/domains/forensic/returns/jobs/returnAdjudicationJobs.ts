export const RETURN_ADJUDICATION_QUEUE='domain7-return-adjudication';
export type ReturnAdjudicationJob={type:'ASSESS'|'EVALUATE';linkId:string;tenantKey:string;correlationId:string};
