import os from "node:os";
import { deliveryEnv } from "../config/deliveryEnv";
import { claimDeliveries } from "../repositories/deliveryExecutionRepository";
import { executeClaimedDelivery } from "../services/deliveryOrchestrationService";
import { domain10Runtime } from "../../infrastructure/operationsRuntime";
import type { DeliveryChannel } from "../models/deliveryTypes";

const workerId=`${os.hostname()}:${process.pid}:10C-delivery`;

export async function runDeliveryOrchestrationBatch(channel:DeliveryChannel):Promise<number>{
  const env=deliveryEnv();
  const runtime=domain10Runtime();

  if(!env.DOMAIN10_DELIVERY_ENABLED) return 0;
  if(channel==="EMAIL"&&!env.DOMAIN10_DELIVERY_EMAIL_ENABLED) return 0;
  if(channel==="SMS"&&!env.DOMAIN10_DELIVERY_SMS_ENABLED) return 0;

  const claimed=await claimDeliveries(
    channel,workerId,env.DOMAIN10_DELIVERY_BATCH_SIZE,env.DOMAIN10_DELIVERY_LEASE_SECONDS
  );

  let processed=0;
  for(const delivery of claimed){
    const span=runtime.tracer.startSpan("domain10.delivery.execute");
    span.setAttribute("domain10.delivery_id",delivery.deliveryId);
    span.setAttribute("domain10.channel",delivery.channel);
    span.setAttribute("domain10.provider",delivery.provider);

    try{
      const result=await executeClaimedDelivery(delivery,workerId);
      runtime.logger.info("Domain 10 delivery execution completed",{
        deliveryId:result.deliveryId,
        channel:result.channel,
        disposition:result.disposition,
        attemptNumber:result.attemptNumber
      });
    }catch(error){
      // The delivery service persists every provider attempt outcome before
      // returning. A database/control-plane failure is logged and the remaining
      // claimed batch continues; lease recovery handles the affected row.
      runtime.logger.error("Domain 10 delivery execution failed unexpectedly",{
        deliveryId:delivery.deliveryId,
        channel:delivery.channel,
        errorName:error instanceof Error?error.name:"UnknownError"
      });
    }finally{
      span.end();
      processed++;
    }
  }
  return processed;
}
