import os from "node:os";
import { emailEnv } from "../config/emailEnv";
import { MicrosoftGraphEmailProvider } from "../providers/microsoftGraphEmailProvider";
import { assertEmailEnabled } from "../repositories/emailControlRepository";
import { acquireSubmissionPermit } from "../repositories/emailRateLimitRepository";
import {
  beginAttempt,claimDeliveries,markAccepted,markFailure
} from "../repositories/emailDeliveryRepository";
import { EmailProviderError } from "../errors/EmailProviderError";
import {
  emailAccepted,emailDeadLetters,emailFailed,emailLatency,emailRetries,emailThrottled,emailTimeouts
} from "../observability/emailMetrics";
import { emailLogger } from "../observability/emailLogger";
import { emailTracer } from "../observability/emailTracing";

const env=emailEnv();
const workerId=`${os.hostname()}:${process.pid}`;
const provider=new MicrosoftGraphEmailProvider();

function nextDelayMs(attempt:number,retryAfter?:number){
  if(retryAfter!=null) return Math.min(retryAfter,env.DOMAIN10_EMAIL_MAX_RETRY_MS);
  const base=Math.min(
    env.DOMAIN10_EMAIL_BASE_RETRY_MS*2**Math.max(0,attempt-1),
    env.DOMAIN10_EMAIL_MAX_RETRY_MS
  );
  return Math.floor(base*(0.8+Math.random()*0.4));
}

function importance(severity:string):"low"|"normal"|"high"{
  return ["HIGH","CRITICAL","EMERGENCY"].includes(severity) ? "high" : "normal";
}

export async function runEmailDeliveryBatch():Promise<number>{
  await assertEmailEnabled();
  const claimed=await claimDeliveries(workerId,env.DOMAIN10_EMAIL_BATCH_SIZE,env.DOMAIN10_EMAIL_LEASE_SECONDS);

  for(const d of claimed){
    const permitted=await acquireSubmissionPermit(env.DOMAIN10_EMAIL_MAX_SUBMISSIONS_PER_MINUTE);
    if(!permitted){
      emailLogger.warn({deliveryId:d.deliveryId},"Local Exchange submission safety limit reached; batch will stop");
      break;
    }

    await emailTracer.startActiveSpan("domain10.email.send",async span=>{
      span.setAttributes({
        "domain10.delivery_id":d.deliveryId,
        "domain10.notification_id":d.notificationId,
        "domain10.correlation_id":d.correlationId
      });

      const attemptId=await beginAttempt(d.deliveryId,workerId);
      const end=emailLatency.startTimer();
      try{
        const useBcc=env.DOMAIN10_EMAIL_BROADCAST_MODE==="BCC" && d.recipients.length>1;
        const result=await provider.send({
          to:useBcc?[{address:env.M365_ALERT_FROM}]:d.recipients,
          ...(useBcc?{bcc:d.recipients}:{}),
          subject:d.renderedSubject,
          textBody:d.renderedTextBody,
          htmlBody:d.renderedHtmlBody,
          eventId:d.eventId,
          notificationId:d.notificationId,
          correlationId:d.correlationId,
          deliveryId:d.deliveryId,
          attemptId,
          ...(d.incidentId?{incidentId:d.incidentId}:{}),
          importance:importance(d.severity)
        });
        await markAccepted(d.deliveryId,attemptId,result.httpStatus,result.providerRequestId);
        emailAccepted.inc();
      }catch(e){
        const err=e instanceof EmailProviderError
          ? e
          : new EmailProviderError("Unknown provider error","UNKNOWN",false,false,undefined,undefined,undefined,{cause:e});
        emailFailed.inc({failure:err.failure});
        if(err.failure==="THROTTLED") emailThrottled.inc();
        if(err.failure==="TIMEOUT") emailTimeouts.inc();

        const next=new Date(Date.now()+nextDelayMs(d.attemptCount+1,err.retryAfterMs));
        const resolution=await markFailure({
          deliveryId:d.deliveryId,attemptId,failure:err.failure,message:err.message,
          httpStatus:err.httpStatus,providerCode:err.providerCode,
          retryable:err.retryable,ambiguous:err.ambiguousOutcome,
          maxAttempts:env.DOMAIN10_EMAIL_MAX_ATTEMPTS,nextAttemptAt:next
        });
        if(resolution==="RETRY") emailRetries.inc();
        if(resolution==="DEAD") emailDeadLetters.inc();

        emailLogger.warn({
          deliveryId:d.deliveryId,attemptId,resolution,failure:err.failure,httpStatus:err.httpStatus
        },"Email attempt failed");
      }finally{
        end();span.end();
      }
    });
  }
  return claimed.length;
}
