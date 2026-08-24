import { planNotificationForEvent } from "../engines/notificationDecisionEngine";
import { beginPlanningAttempt,failPlanningAttempt } from "../repositories/planningRepository";
import { OperationsDecisionError } from "../errors/OperationsDecisionError";
import { operationsEnv } from "../config/operationsEnv";
import { domain10Runtime } from "../infrastructure/operationsRuntime";

function retryDelay(attempt:number):number{
  const env=operationsEnv();
  const raw=Math.min(env.DOMAIN10_PLANNER_RETRY_BASE_MS*2**Math.max(0,attempt-1),env.DOMAIN10_PLANNER_RETRY_MAX_MS);
  return Math.floor(raw*(0.8+Math.random()*0.4));
}

export async function processClaimedEvent(args:{eventId:string;workerId:string}):Promise<void>{
  const runtime=domain10Runtime();
  const span=runtime.tracer.startSpan("domain10.plan-notification");
  span.setAttribute("domain10.event_id",args.eventId);
  const started=performance.now();
  const attempt=await beginPlanningAttempt(args.eventId,args.workerId);

  try{
    const result=await planNotificationForEvent({
      eventId:args.eventId,planningAttemptId:attempt.planningAttemptId,workerId:args.workerId
    });
    runtime.metrics.increment("domain10_notification_decisions_total",{
      outcome:result.outcome,event_type:result.eventType
    });
    runtime.logger.info("Domain 10 notification plan committed",{
      eventId:result.eventId,eventType:result.eventType,decisionId:result.decisionId,
      outcome:result.outcome,notificationId:result.notificationId,
      recipientCount:result.recipientCount,emailDeliveryCount:result.emailDeliveryCount,
      smsDeliveryCount:result.smsDeliveryCount
    });
  }catch(error){
    const typed=error instanceof OperationsDecisionError
      ? error
      : new OperationsDecisionError("Unexpected planning failure","INTERNAL",true,{cause:error});

    runtime.metrics.increment("domain10_planning_failures_total",{code:typed.code});
    const retryable=typed.retryable && attempt.attemptNumber<operationsEnv().DOMAIN10_PLANNER_MAX_ATTEMPTS;
    await failPlanningAttempt({
      eventId:args.eventId,planningAttemptId:attempt.planningAttemptId,workerId:args.workerId,
      errorCode:typed.code,errorMessage:typed.message,retryable,
      nextAttemptAt:new Date(Date.now()+retryDelay(attempt.attemptNumber)),
      maxAttempts:operationsEnv().DOMAIN10_PLANNER_MAX_ATTEMPTS
    });
    runtime.logger.error("Domain 10 notification planning failed",{
      eventId:args.eventId,attemptNumber:attempt.attemptNumber,code:typed.code,retryable
    });
    throw typed;
  }finally{
    runtime.metrics.observe("domain10_planning_latency_seconds",(performance.now()-started)/1000);
    span.end();
  }
}
