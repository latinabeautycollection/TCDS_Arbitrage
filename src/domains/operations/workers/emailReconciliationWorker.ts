import { listAmbiguousDeliveries } from "../services/emailReconciliationService";
import { emailLogger } from "../observability/emailLogger";
export async function runEmailReconciliationWorker(){
  const rows=await listAmbiguousDeliveries();
  if(rows.length) emailLogger.warn({count:rows.length,deliveryIds:rows.map((r:any)=>r.delivery_id)},"Ambiguous email outcomes require reconciliation");
  return rows.length;
}
