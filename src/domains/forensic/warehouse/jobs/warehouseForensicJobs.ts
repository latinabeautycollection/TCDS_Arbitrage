export const WAREHOUSE_FORENSIC_QUEUE='domain7-warehouse-forensic';
export type WarehouseForensicJob =
 | { type:'EVALUATE_GATE'; sessionId:string; tenantKey:string; correlationId:string }
 | { type:'ABANDON_STALE'; sessionId:string; tenantKey:string; correlationId:string };
