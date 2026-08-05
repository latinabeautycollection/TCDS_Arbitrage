export const ASSURANCE_QUEUE='domain7-assurance';
export type AssuranceJob={type:'EVALUATE_CONTROL'|'GENERATE_ROLLUP';controlCode?:string;subjectType?:string;
subjectReference?:string;windowStart?:string;windowEnd?:string;metricDate?:string;controlDomain?:string;
tenantKey:string;correlationId:string};
