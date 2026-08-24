import {
  claimReconciliationTasks,
  markReconciliationManualReview
} from "../repositories/deliveryReconciliationRepository";
import { domain10Runtime } from "../../infrastructure/operationsRuntime";

/**
 * UNKNOWN_PROVIDER_OUTCOME and unconfirmed/conflicting terminal evidence are
 * never replayed automatically. This service surfaces them to the governed
 * manual/provider-specific reconciliation path.
 */
export async function surfaceReconciliationBatch(
  workerId:string,batchSize:number,leaseSeconds:number
):Promise<number>{
  const runtime=domain10Runtime();
  const tasks=await claimReconciliationTasks(workerId,batchSize,leaseSeconds);

  for(const task of tasks){
    await markReconciliationManualReview(task.taskId,workerId,{
      deliveryId:task.deliveryId,
      provider:task.provider,
      reason:task.reason,
      guidance:"Establish authoritative provider outcome before any replay decision."
    });

    runtime.logger.warn("Domain 10 delivery requires provider-outcome reconciliation",{
      deliveryId:task.deliveryId,
      provider:task.provider,
      reason:task.reason
    });
  }
  return tasks.length;
}
