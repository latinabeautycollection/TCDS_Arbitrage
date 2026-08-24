import { deliveryEnv } from "../config/deliveryEnv";
import { DeliveryProviderError } from "../errors/DeliveryOrchestrationError";
import { deliveryProviderRegistry } from "../ports/deliveryProviderRegistry";
import {
  acquireChannelPermit,
  beginDeliveryAttempt,
  recordProviderAcceptance,
  recordProviderFailure,
  releaseClaimWithoutAttempt
} from "../repositories/deliveryExecutionRepository";
import type {
  ClaimedDelivery,
  ExecutionResult,
  ProviderFailure
} from "../models/deliveryTypes";
import { domain10Runtime } from "../../infrastructure/operationsRuntime";

function nextDelayMs(attemptNumber:number,retryAfterMs?:number):number{
  const env=deliveryEnv();
  if(retryAfterMs!==undefined){
    return Math.min(Math.max(retryAfterMs,1000),env.DOMAIN10_DELIVERY_RETRY_MAX_MS);
  }
  const exponential=Math.min(
    env.DOMAIN10_DELIVERY_RETRY_BASE_MS*2**Math.max(0,attemptNumber-1),
    env.DOMAIN10_DELIVERY_RETRY_MAX_MS
  );
  return Math.floor(exponential*(0.8+Math.random()*0.4));
}

function emailImportance(severity:string):"low"|"normal"|"high"{
  return ["HIGH","CRITICAL","EMERGENCY"].includes(severity)?"high":"normal";
}

function normalizeFailure(error:unknown,provider:ClaimedDelivery["provider"]):ProviderFailure{
  const max=deliveryEnv().DOMAIN10_PROVIDER_ERROR_MAX_CHARS;
  if(error instanceof DeliveryProviderError){
    return {
      provider:error.provider,
      failureClass:error.failureClass,
      message:error.message.slice(0,max),
      retryable:error.retryable,
      ambiguousOutcome:error.ambiguousOutcome,
      ...(error.httpStatus!==undefined?{httpStatus:error.httpStatus}:{}),
      ...(error.providerCode!==undefined?{providerCode:error.providerCode}:{}),
      ...(error.retryAfterMs!==undefined?{retryAfterMs:error.retryAfterMs}:{})
    };
  }
  return {
    provider,
    failureClass:"UNKNOWN",
    message:(error instanceof Error?error.message:"Unknown delivery provider failure").slice(0,max),
    retryable:false,
    ambiguousOutcome:true
  };
}

export async function executeClaimedDelivery(
  delivery:ClaimedDelivery,
  workerId:string
):Promise<ExecutionResult>{
  const env=deliveryEnv();
  const runtime=domain10Runtime();

  // Process switches are executor safety gates only; 10A DB controls remain
  // authoritative for channel enablement.
  if(!env.DOMAIN10_DELIVERY_ENABLED){
    await releaseClaimWithoutAttempt(delivery.deliveryId,workerId,5000,"DELIVERY_EXECUTOR_DISABLED");
    return {deliveryId:delivery.deliveryId,channel:delivery.channel,disposition:"CANCELLED"};
  }
  if(delivery.channel==="EMAIL"&&!env.DOMAIN10_DELIVERY_EMAIL_ENABLED){
    await releaseClaimWithoutAttempt(delivery.deliveryId,workerId,5000,"EMAIL_EXECUTOR_DISABLED");
    return {deliveryId:delivery.deliveryId,channel:delivery.channel,disposition:"CANCELLED"};
  }
  if(delivery.channel==="SMS"&&!env.DOMAIN10_DELIVERY_SMS_ENABLED){
    await releaseClaimWithoutAttempt(delivery.deliveryId,workerId,5000,"SMS_EXECUTOR_DISABLED");
    return {deliveryId:delivery.deliveryId,channel:delivery.channel,disposition:"CANCELLED"};
  }

  const permit=await acquireChannelPermit(delivery.channel,1);
  if(!permit){
    await releaseClaimWithoutAttempt(delivery.deliveryId,workerId,5000,"CHANNEL_CONTROL_OR_RATE_LIMIT");
    runtime.metrics.increment("domain10_delivery_local_throttle_total",{channel:delivery.channel});
    return {deliveryId:delivery.deliveryId,channel:delivery.channel,disposition:"RETRY_SCHEDULED"};
  }

  const begin=await beginDeliveryAttempt(delivery.deliveryId,workerId);
  if(begin.status==="SUPPRESSED"){
    runtime.metrics.increment("domain10_delivery_suppressed_total",{channel:delivery.channel});
    return {deliveryId:delivery.deliveryId,channel:delivery.channel,disposition:"SUPPRESSED"};
  }
  if(begin.status==="RELEASED"){
    runtime.metrics.increment("domain10_delivery_released_total",{channel:delivery.channel});
    return {deliveryId:delivery.deliveryId,channel:delivery.channel,disposition:"RETRY_SCHEDULED"};
  }

  const started=Date.now();
  const providers=deliveryProviderRegistry();

  try{
    let acceptance;

    if(delivery.channel==="EMAIL"){
      if(delivery.provider!=="MICROSOFT_GRAPH"){
        throw new DeliveryProviderError("MICROSOFT_GRAPH","PROTOCOL","EMAIL provider mismatch",false,false);
      }
      if(!delivery.emailAddress||!delivery.renderedSubject){
        throw new DeliveryProviderError("MICROSOFT_GRAPH","INVALID_REQUEST","EMAIL recipient/subject missing",false,false);
      }

      acceptance=await providers.email.sendOnce({
        to:delivery.emailAddress,
        subject:delivery.renderedSubject,
        textBody:delivery.renderedTextBody,
        ...(delivery.renderedHtmlBody?{htmlBody:delivery.renderedHtmlBody}:{}),
        eventId:delivery.eventId,
        notificationId:delivery.notificationId,
        deliveryId:delivery.deliveryId,
        attemptId:begin.attemptId,
        correlationId:delivery.correlationId,
        ...(delivery.traceId?{traceId:delivery.traceId}:{}),
        importance:emailImportance(delivery.severity)
      });

      if(acceptance.provider!=="MICROSOFT_GRAPH"||acceptance.httpStatus!==202){
        throw new DeliveryProviderError(
          "MICROSOFT_GRAPH","PROTOCOL",
          "Microsoft Graph acceptance requires HTTP 202",false,false,acceptance.httpStatus
        );
      }
    }else{
      if(delivery.provider!=="TELNYX"){
        throw new DeliveryProviderError("TELNYX","PROTOCOL","SMS provider mismatch",false,false);
      }
      if(!delivery.mobileE164){
        throw new DeliveryProviderError("TELNYX","INVALID_REQUEST","SMS mobile recipient missing",false,false);
      }

      acceptance=await providers.sms.sendOnce({
        to:delivery.mobileE164,
        text:delivery.renderedTextBody,
        eventId:delivery.eventId,
        notificationId:delivery.notificationId,
        deliveryId:delivery.deliveryId,
        attemptId:begin.attemptId,
        correlationId:delivery.correlationId
      });

      if(
        acceptance.provider!=="TELNYX"||
        acceptance.httpStatus<200||
        acceptance.httpStatus>=300||
        !acceptance.providerMessageId
      ){
        throw new DeliveryProviderError(
          "TELNYX","PROTOCOL",
          "Telnyx acceptance requires HTTP 2xx and provider message ID",
          false,false,acceptance.httpStatus
        );
      }
    }

    await recordProviderAcceptance(
      delivery.deliveryId,begin.attemptId,workerId,acceptance
    );

    runtime.metrics.increment("domain10_delivery_provider_accepted_total",{
      channel:delivery.channel,provider:delivery.provider
    });
    runtime.metrics.observe(
      "domain10_delivery_provider_latency_seconds",
      (Date.now()-started)/1000,
      {channel:delivery.channel,provider:delivery.provider}
    );

    return {
      deliveryId:delivery.deliveryId,
      channel:delivery.channel,
      disposition:"ACCEPTED",
      attemptId:begin.attemptId,
      attemptNumber:begin.attemptNumber
    };
  }catch(error){
    const failure=normalizeFailure(error,delivery.provider);
    const next=new Date(Date.now()+nextDelayMs(begin.attemptNumber,failure.retryAfterMs));

    const disposition=await recordProviderFailure({
      deliveryId:delivery.deliveryId,
      attemptId:begin.attemptId,
      workerId,
      failure,
      nextAttemptAt:next
    });

    runtime.metrics.increment("domain10_delivery_provider_failure_total",{
      channel:delivery.channel,
      provider:delivery.provider,
      failure:failure.failureClass,
      disposition
    });

    return {
      deliveryId:delivery.deliveryId,
      channel:delivery.channel,
      disposition:
        disposition==="RETRY"?"RETRY_SCHEDULED":
        disposition==="UNKNOWN"?"UNKNOWN_QUARANTINED":
        "DEAD_LETTERED",
      attemptId:begin.attemptId,
      attemptNumber:begin.attemptNumber
    };
  }
}
