import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { transaction } from "../infrastructure/operationsRuntime";
import type {
  ChannelSelection, PolicyCandidate, PlanningResult, SuppressionEvaluation
} from "../models/decisionTypes";
import type { PersistedOperationalEvent } from "../models/eventTypes";
import { renderBoundTemplate } from "../services/templateRenderingService";

type SuppressionWithChannel = SuppressionEvaluation & {channel?:"EMAIL"|"SMS"};
const sha256=(v:string)=>createHash("sha256").update(v).digest("hex");

export async function commitNoActionDecision(args:{
  event:PersistedOperationalEvent;planningAttemptId:string;workerId:string;
  outcome:"SUPPRESSED"|"NO_POLICY"|"NO_RECIPIENTS";candidates:PolicyCandidate[];
  winner?:PolicyCandidate;suppression?:SuppressionWithChannel;
  suppressionEvaluations?:SuppressionWithChannel[];reason:string;
}):Promise<PlanningResult>{
  return transaction(async c=>{
    const decisionId=randomUUID();
    await insertDecision(c,{
      decisionId,event:args.event,outcome:args.outcome,candidates:args.candidates,
      winner:args.winner,suppressionEvaluations:args.suppressionEvaluations??(args.suppression?[args.suppression]:[]),
      reason:args.reason
    });
    await persistSuppressionEvaluations(c,args.event.eventId,undefined,args.event.correlationId,args.suppressionEvaluations??(args.suppression?[args.suppression]:[]));
    await completePlanning(c,args.event.eventId,args.planningAttemptId,args.workerId,
      args.outcome==="SUPPRESSED"?"SUPPRESSED":"PLANNED",args.reason);
    await insertAudit(c,"OPERATIONAL_EVENT",args.event.eventId,"NOTIFICATION_DECISION","SYSTEM",
      {decisionId,outcome:args.outcome,reason:args.reason},args.event);
    return {
      eventId:args.event.eventId,eventType:args.event.eventType,decisionId,outcome:args.outcome,
      recipientCount:0,emailDeliveryCount:0,smsDeliveryCount:0,
      ...(args.winner?{policyId:args.winner.policyId,policyVersion:args.winner.policyVersion}:{})
    };
  });
}

export async function commitNotificationPlan(args:{
  event:PersistedOperationalEvent;planningAttemptId:string;workerId:string;
  candidates:PolicyCandidate[];winner:PolicyCandidate;channels:ChannelSelection[];
  suppressionEvaluations:SuppressionWithChannel[];
}):Promise<PlanningResult>{
  return transaction(async c=>{
    // PostgreSQL independently verifies the selected policy is still the unique
    // authoritative winner for the frozen decision_basis_at.
    await verifyPolicyWinner(c,args.event,args.winner);

    const decisionId=randomUUID();
    const notificationId=randomUUID();
    if(args.winner.acknowledgementRequired && !args.winner.acknowledgementTimeoutSeconds){
      throw new Error("Acknowledgement-required policy has no timeout");
    }
    const ackDue=args.winner.acknowledgementRequired
      ? new Date(new Date(args.event.decisionBasisAt).getTime()+args.winner.acknowledgementTimeoutSeconds!*1000).toISOString()
      : null;

    const policySnapshot={
      policyId:args.winner.policyId,policyKey:args.winner.policyKey,version:args.winner.policyVersion,
      definitionHash:args.winner.definitionHash,decisionPriority:args.winner.decisionPriority,
      eventTypePattern:args.winner.eventTypePattern,minimumSeverity:args.winner.minimumSeverity,
      maximumClassification:args.winner.maximumClassification,audienceId:args.winner.audienceId,
      audienceKey:args.winner.audienceKey,emailEnabled:args.winner.emailEnabled,smsEnabled:args.winner.smsEnabled,
      acknowledgementRequired:args.winner.acknowledgementRequired,
      acknowledgementTimeoutSeconds:args.winner.acknowledgementTimeoutSeconds??null,
      incidentRequired:args.winner.incidentRequired,suppressionWindowSeconds:args.winner.suppressionWindowSeconds,
      maxDeliveryAttempts:args.winner.maxDeliveryAttempts,escalationPolicyId:args.winner.escalationPolicyId??null,
      decisionBasisAt:args.event.decisionBasisAt,
      templateBindings:args.winner.templates.map(t=>({
        channel:t.channel,templateId:t.templateId,templateVersion:t.templateVersion,
        templateKey:t.templateKey,contentHash:t.contentHash,
        allowedVariablePaths:t.allowedVariablePaths,requiredVariablePaths:t.requiredVariablePaths
      }))
    };

    await c.query(`
      INSERT INTO operations.notification_requests(
        notification_id,event_id,policy_id,policy_version,policy_snapshot,severity,classification,
        acknowledgement_required,acknowledgement_due_at,incident_required,status,idempotency_key,
        correlation_id,trace_id,request_id,created_by
      ) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,'PLANNED',$11,$12,$13,$14,$15)
    `,[notificationId,args.event.eventId,args.winner.policyId,args.winner.policyVersion,
       JSON.stringify(policySnapshot),args.event.severity,args.event.classification,
       args.winner.acknowledgementRequired,ackDue,args.winner.incidentRequired,
       sha256(`${args.event.eventId}|${args.winner.policyId}|${args.winner.policyVersion}|${args.event.decisionBasisAt}`),
       args.event.correlationId,args.event.traceId??null,args.event.requestId??null,"DOMAIN10_10B"]);

    let emailCount=0,smsCount=0;
    for(const selection of args.channels){
      const r=selection.recipient;
      await c.query(`
        INSERT INTO operations.notification_recipients(
          notification_id,recipient_id,email_snapshot,mobile_snapshot,display_name_snapshot,
          audience_key_snapshot,authorization_snapshot,email_selected,sms_selected
        ) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
      `,[notificationId,r.recipientId,r.emailAddress??null,r.mobileE164??null,r.displayName,r.audienceKey,
         JSON.stringify({...r.authorizationSnapshot,channelSelectionReasons:selection.reasons,
           smsSubscriptionStatus:r.smsSubscriptionStatus??null,decisionBasisAt:args.event.decisionBasisAt}),
         selection.emailSelected,selection.smsSelected]);

      for(const channel of ["EMAIL","SMS"] as const){
        const selected=channel==="EMAIL"?selection.emailSelected:selection.smsSelected;
        if(!selected) continue;
        const binding=args.winner.templates.find(t=>t.channel===channel);
        if(!binding) throw new Error(`Frozen policy missing ${channel} template binding`);

        // DB re-check recipient/channel authorization and, for SMS, subscription.
        await verifyRecipientChannel(c,args.event,args.winner,r.recipientId,channel);

        const rendered=renderBoundTemplate(binding,args.event,r);
        const deliveryId=randomUUID();
        const provider=channel==="EMAIL"?"MICROSOFT_GRAPH":"TELNYX";
        const idem=sha256(`${notificationId}|${r.recipientId}|${channel}`);

        await c.query(`
          INSERT INTO operations.notification_deliveries(
            delivery_id,notification_id,recipient_id,channel,provider,state,idempotency_key,
            template_id,template_version,template_snapshot,rendered_subject,rendered_text_body,
            rendered_html_body,rendered_subject_hash,rendered_body_hash,max_attempts,next_attempt_at
          ) VALUES($1,$2,$3,$4,$5,'PENDING',$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,clock_timestamp())
        `,[deliveryId,notificationId,r.recipientId,channel,provider,idem,binding.templateId,binding.templateVersion,
           JSON.stringify({templateKey:binding.templateKey,contentHash:binding.contentHash,
             allowedVariablePaths:binding.allowedVariablePaths,requiredVariablePaths:binding.requiredVariablePaths}),
           rendered.subject??null,rendered.textBody,rendered.htmlBody??null,
           rendered.subject?sha256(rendered.subject):null,
           sha256(`${rendered.textBody}\n${rendered.htmlBody??""}`),args.winner.maxDeliveryAttempts]);

        await c.query(`INSERT INTO operations.notification_outbox(delivery_id,available_at) VALUES($1,clock_timestamp())`,[deliveryId]);
        if(channel==="EMAIL") emailCount++; else smsCount++;
      }
    }

    await c.query(`UPDATE operations.notification_requests SET status='QUEUED' WHERE notification_id=$1`,[notificationId]);

    await insertDecision(c,{
      decisionId,event:args.event,outcome:"NOTIFY",candidates:args.candidates,winner:args.winner,
      suppressionEvaluations:args.suppressionEvaluations,reason:"Authoritative policy selected"
    },notificationId);

    await persistSuppressionEvaluations(c,args.event.eventId,notificationId,args.event.correlationId,args.suppressionEvaluations);
    await completePlanning(c,args.event.eventId,args.planningAttemptId,args.workerId,"PLANNED","NOTIFY");
    await insertAudit(c,"NOTIFICATION",notificationId,"NOTIFICATION_PLAN_COMMITTED","SYSTEM",
      {decisionId,emailCount,smsCount,recipientCount:args.channels.length,decisionBasisAt:args.event.decisionBasisAt},args.event);

    return {
      eventId:args.event.eventId,eventType:args.event.eventType,decisionId,outcome:"NOTIFY",notificationId,
      policyId:args.winner.policyId,policyVersion:args.winner.policyVersion,
      recipientCount:args.channels.length,emailDeliveryCount:emailCount,smsDeliveryCount:smsCount
    };
  });
}

async function verifyPolicyWinner(c:PoolClient,event:PersistedOperationalEvent,winner:PolicyCandidate):Promise<void>{
  const r=await c.query<{policy_id:string;policy_version:number}>(`
    SELECT policy_id,policy_version
    FROM operations.resolve_authoritative_notification_policy($1)
  `,[event.eventId]);
  const row=r.rows[0];
  if(!row || row.policy_id!==winner.policyId || row.policy_version!==winner.policyVersion){
    throw new Error("Database rejected TypeScript policy winner");
  }
}

async function verifyRecipientChannel(
  c:PoolClient,event:PersistedOperationalEvent,policy:PolicyCandidate,recipientId:string,channel:"EMAIL"|"SMS"
):Promise<void>{
  const r=await c.query<{allowed:boolean}>(`
    SELECT operations.is_recipient_channel_authorized($1,$2,$3,$4,$5,$6) AS allowed
  `,[recipientId,policy.audienceId,event.eventType,event.classification,event.decisionBasisAt,channel]);
  if(!r.rows[0]?.allowed) throw new Error(`Database rejected ${channel} for recipient ${recipientId}`);
}

async function insertDecision(
  c:PoolClient,args:{
    decisionId:string;event:PersistedOperationalEvent;outcome:string;candidates:PolicyCandidate[];
    winner?:PolicyCandidate;suppressionEvaluations:SuppressionWithChannel[];reason:string;
  },notificationId?:string
):Promise<void>{
  const candidateMaterial=args.candidates
    .map(p=>`${p.policyId}:${p.policyVersion}:${p.definitionHash}:${p.decisionPriority}:${p.patternSpecificity}`)
    .sort().join("|");
  const candidateSetHash=sha256(candidateMaterial);

  await c.query(`
    SELECT operations.begin_notification_decision(
      $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,'10B-2.0.0',$12
    )
  `,[args.decisionId,args.event.eventId,args.outcome,notificationId??null,
     args.winner?.policyId??null,args.winner?.policyVersion??null,args.winner?.definitionHash??null,
     args.reason,JSON.stringify({eventType:args.event.eventType,severity:args.event.severity,
       classification:args.event.classification,decisionBasisAt:args.event.decisionBasisAt,
       suppressionEvaluations:args.suppressionEvaluations}),
     args.event.correlationId,args.event.traceId??null,candidateSetHash]);

  for(const p of args.candidates){
    await c.query(`
      INSERT INTO operations.notification_decision_candidates(
        decision_id,policy_id,policy_version,policy_key,decision_priority,
        pattern_specificity,definition_hash,selected
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
    `,[args.decisionId,p.policyId,p.policyVersion,p.policyKey,p.decisionPriority,p.patternSpecificity,
       p.definitionHash,args.winner?.policyId===p.policyId&&args.winner?.policyVersion===p.policyVersion]);
  }

  await c.query(`SELECT operations.seal_notification_decision($1)`,[args.decisionId]);
}

async function persistSuppressionEvaluations(
  c:PoolClient,eventId:string,notificationId:string|undefined,correlationId:string,
  evaluations:SuppressionWithChannel[]
):Promise<void>{
  for(const e of evaluations){
    if(!e.ruleId||!e.groupingKey) continue;
    await c.query(`
      INSERT INTO operations.suppression_decisions(
        event_id,notification_id,suppression_rule_id,grouping_key,channel,suppressed,reason,correlation_id
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
    `,[eventId,notificationId??null,e.ruleId,e.groupingKey,e.channel??null,e.suppressed,e.reason,correlationId]);
  }
}

async function completePlanning(
  c:PoolClient,eventId:string,planningAttemptId:string,workerId:string,
  state:"PLANNED"|"SUPPRESSED",reason:string
):Promise<void>{
  await c.query(`SELECT operations.complete_event_planning($1,$2,$3,$4,$5)`,
    [eventId,planningAttemptId,workerId,state,reason]);
}

async function insertAudit(
  c:PoolClient,entityType:string,entityId:string,action:string,actorType:string,
  details:Record<string,unknown>,event:PersistedOperationalEvent
):Promise<void>{
  await c.query(`
    INSERT INTO operations.audit_ledger(
      entity_type,entity_id,action,actor_type,actor_id,request_id,correlation_id,trace_id,details,record_hash
    ) VALUES($1,$2,$3,$4,'DOMAIN10_10B',$5,$6,$7,$8::jsonb,'DB_TRIGGER_REPLACES')
  `,[entityType,entityId,action,actorType,event.requestId??null,event.correlationId,
     event.traceId??null,JSON.stringify(details)]);
}
