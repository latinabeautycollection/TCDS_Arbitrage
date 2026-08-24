import { domain10Runtime } from "../../infrastructure/operationsRuntime";

export interface ReconciliationTask {
  taskId:string;
  deliveryId:string;
  provider:"MICROSOFT_GRAPH"|"TELNYX";
  reason:string;
  state:"PENDING"|"CLAIMED";
  attemptCount:number;
}

export async function claimReconciliationTasks(
  workerId:string,batchSize:number,leaseSeconds:number
):Promise<ReconciliationTask[]>{
  const r=await domain10Runtime().pool.query<any>(`
    SELECT task_id,delivery_id,provider,reason,state,attempt_count
    FROM operations.claim_delivery_reconciliation_10c($1,$2,$3)
  `,[workerId,batchSize,leaseSeconds]);

  return r.rows.map((x:any)=>({
    taskId:x.task_id,deliveryId:x.delivery_id,provider:x.provider,
    reason:x.reason,state:x.state,attemptCount:x.attempt_count
  }));
}

export async function markReconciliationManualReview(
  taskId:string,workerId:string,evidence:Record<string,unknown>
):Promise<void>{
  await domain10Runtime().pool.query(`
    SELECT operations.mark_delivery_reconciliation_manual_review_10c(
      $1,$2,$3::jsonb
    )
  `,[taskId,workerId,JSON.stringify(evidence)]);
}

export async function resolveReconciliationTask(
  taskId:string,
  actor:string,
  resolution:"RESOLVED"|"CANCELLED",
  evidence:Record<string,unknown>
):Promise<void>{
  await domain10Runtime().pool.query(`
    SELECT operations.resolve_delivery_reconciliation_10c(
      $1,$2,$3,$4::jsonb
    )
  `,[taskId,actor,resolution,JSON.stringify(evidence)]);
}
