import type { PlanningResult } from "../models/decisionTypes";
import { getOperationalEvent } from "../repositories/planningRepository";
import { resolveAuthoritativePolicy } from "./notificationPolicyEngine";
import { evaluateSuppression } from "./suppressionEngine";
import { resolveRecipients } from "./recipientResolutionEngine";
import { selectChannels } from "./channelSelectionEngine";
import { commitNoActionDecision,commitNotificationPlan } from "../repositories/decisionCommitRepository";

export async function planNotificationForEvent(args:{
  eventId:string;planningAttemptId:string;workerId:string;
}):Promise<PlanningResult>{
  const event=await getOperationalEvent(args.eventId);
  const {candidates,winner}=await resolveAuthoritativePolicy(event);

  if(!winner){
    return commitNoActionDecision({
      event,planningAttemptId:args.planningAttemptId,workerId:args.workerId,
      outcome:"NO_POLICY",candidates,reason:"No governed policy matched at decision_basis_at"
    });
  }

  const suppressionEvaluations=await evaluateSuppression(event);
  const globalSuppression=suppressionEvaluations.find(x=>x.suppressed && !x.channel);
  if(globalSuppression){
    return commitNoActionDecision({
      event,planningAttemptId:args.planningAttemptId,workerId:args.workerId,
      outcome:"SUPPRESSED",candidates,winner,suppression:globalSuppression,
      suppressionEvaluations,reason:globalSuppression.reason
    });
  }

  const recipients=await resolveRecipients(event,winner);
  let channels=selectChannels(winner,recipients);

  const emailSuppressed=suppressionEvaluations.some(x=>x.suppressed && x.channel==="EMAIL");
  const smsSuppressed=suppressionEvaluations.some(x=>x.suppressed && x.channel==="SMS");
  channels=channels.map(c=>({
    ...c,
    emailSelected:c.emailSelected && !emailSuppressed,
    smsSelected:c.smsSelected && !smsSuppressed,
    reasons:[
      ...c.reasons,
      ...(emailSuppressed && c.emailSelected?["EMAIL_SUPPRESSED_BY_RULE"]:[]),
      ...(smsSuppressed && c.smsSelected?["SMS_SUPPRESSED_BY_RULE"]:[])
    ]
  })).filter(c=>c.emailSelected||c.smsSelected);

  if(!channels.length){
    return commitNoActionDecision({
      event,planningAttemptId:args.planningAttemptId,workerId:args.workerId,
      outcome:"NO_RECIPIENTS",candidates,winner,
      suppressionEvaluations,
      reason:"No authorized recipient had an eligible unsuppressed channel"
    });
  }

  return commitNotificationPlan({
    event,planningAttemptId:args.planningAttemptId,workerId:args.workerId,
    candidates,winner,channels,suppressionEvaluations
  });
}
