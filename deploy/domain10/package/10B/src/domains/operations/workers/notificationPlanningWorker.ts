import os from "node:os";
import { operationsEnv } from "../config/operationsEnv";
import { claimPlanningItems } from "../repositories/planningRepository";
import { processClaimedEvent } from "../services/notificationPlanningService";
import { domain10Runtime } from "../infrastructure/operationsRuntime";

const workerId=`${os.hostname()}:${process.pid}:10B`;

export async function runNotificationPlanningBatch():Promise<number>{
  const env=operationsEnv();
  const runtime=domain10Runtime();
  if(!env.DOMAIN10_PLANNER_ENABLED){
    runtime.logger.warn("Domain 10 planning worker is disabled");
    return 0;
  }

  const items=await claimPlanningItems(workerId,env.DOMAIN10_PLANNER_BATCH_SIZE,env.DOMAIN10_PLANNER_LEASE_SECONDS);
  let processed=0;
  for(const item of items){
    try{
      await processClaimedEvent({eventId:item.eventId,workerId});
    }catch(error){
      // Per-item failure is already durably recorded. Never abandon the rest
      // of the claimed batch because one event is malformed or misconfigured.
      runtime.logger.error("Domain 10 planning item failed; continuing batch",{
        eventId:item.eventId,errorName:error instanceof Error?error.name:"UnknownError"
      });
    }
    processed++;
  }
  return processed;
}
