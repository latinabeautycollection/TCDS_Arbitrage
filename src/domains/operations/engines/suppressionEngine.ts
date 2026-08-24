import { createHash } from "node:crypto";
import type { PersistedOperationalEvent } from "../models/eventTypes";
import type { SuppressionEvaluation } from "../models/decisionTypes";
import {
  getMatchingSuppressionRules,hasRecentMatchingDecision,type SuppressionRuleRow
} from "../repositories/suppressionRepository";

function valueAtPath(obj:Record<string,unknown>,path:string):unknown{
  return path.split(".").reduce<unknown>((v,key)=>{
    if(v && typeof v==="object" && !Array.isArray(v)) return (v as Record<string,unknown>)[key];
    return undefined;
  },obj);
}

function groupingMaterial(rule:SuppressionRuleRow,event:PersistedOperationalEvent):string{
  switch(rule.groupingStrategy){
    case "EVENT_ONLY": return event.eventType;
    case "EVENT_SUBJECT": return `${event.eventType}|${event.subjectType??""}|${event.subjectId??""}`;
    case "CORRELATION": return `${event.eventType}|${event.correlationId}`;
    case "DECLARATIVE_FIELDS":
      return `${event.eventType}|`+rule.groupingFields
        .map(p=>`${p}=${JSON.stringify(valueAtPath(event.payload,p))}`).join("|");
  }
}

export interface SuppressionRuleEvaluation extends SuppressionEvaluation {
  channel?: "EMAIL"|"SMS";
}

export async function evaluateSuppression(
  event:PersistedOperationalEvent
):Promise<SuppressionRuleEvaluation[]>{
  const rules=await getMatchingSuppressionRules(event);
  if(!rules.length) return [{suppressed:false,reason:"NO_SUPPRESSION_RULE"}];

  const evaluations:SuppressionRuleEvaluation[]=[];
  for(const rule of rules){
    const groupingKey=createHash("sha256").update(groupingMaterial(rule,event)).digest("hex");
    const recent=rule.windowSeconds>0 && await hasRecentMatchingDecision({
      ruleId:rule.ruleId,groupingKey,decisionBasisAt:event.decisionBasisAt,windowSeconds:rule.windowSeconds
    });
    evaluations.push({
      suppressed:recent,ruleId:rule.ruleId,ruleKey:rule.ruleKey,groupingKey,
      ...(rule.channel?{channel:rule.channel}:{}),
      reason:recent
        ? `Suppressed by ${rule.ruleKey} within ${rule.windowSeconds}s decision-basis window`
        : `No prior unsuppressed match for ${rule.ruleKey}`
    });
  }
  return evaluations;
}
