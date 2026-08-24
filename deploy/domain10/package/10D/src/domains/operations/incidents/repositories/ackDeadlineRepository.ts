import { domain10Runtime } from "../../infrastructure/operationsRuntime";
export interface AckDeadlineClaim{deadlineId:string;incidentId:string;}
export async function claimAckDeadlines(workerId:string,batchSize:number,leaseSeconds:number):Promise<AckDeadlineClaim[]>{
  const r=await domain10Runtime().pool.query<any>(`
    SELECT deadline_id,incident_id FROM operations.claim_ack_deadlines_10d($1,$2,$3)
  `,[workerId,batchSize,leaseSeconds]);
  return r.rows.map((x:any)=>({deadlineId:x.deadline_id,incidentId:x.incident_id}));
}
export async function recordAckDeadlineBreach(deadlineId:string,workerId:string):Promise<void>{
  await domain10Runtime().pool.query(`SELECT operations.record_ack_deadline_breach_10d($1,$2)`,[deadlineId,workerId]);
}
