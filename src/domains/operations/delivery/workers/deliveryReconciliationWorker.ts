import os from "node:os";
import { deliveryEnv } from "../config/deliveryEnv";
import { surfaceReconciliationBatch } from "../services/deliveryReconciliationService";

const workerId=`${os.hostname()}:${process.pid}:10C-reconciliation`;

export async function runDeliveryReconciliationBatch():Promise<number>{
  const env=deliveryEnv();
  if(!env.DOMAIN10_DELIVERY_ENABLED) return 0;
  return surfaceReconciliationBatch(
    workerId,
    env.DOMAIN10_RECONCILIATION_BATCH_SIZE,
    env.DOMAIN10_RECONCILIATION_LEASE_SECONDS
  );
}
