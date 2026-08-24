import { domain10Runtime } from "../infrastructure/operationsRuntime";
import type { PersistedOperationalEvent } from "../models/eventTypes";

export interface SuppressionRuleRow {
  ruleId:string;
  ruleKey:string;
  channel?: "EMAIL"|"SMS";
  windowSeconds:number;
  groupingStrategy:"EVENT_ONLY"|"EVENT_SUBJECT"|"CORRELATION"|"DECLARATIVE_FIELDS";
  groupingFields:string[];
}

export async function getMatchingSuppressionRules(event:PersistedOperationalEvent):Promise<SuppressionRuleRow[]>{
  const r=await domain10Runtime().pool.query<any>(`
    SELECT suppression_rule_id,rule_key,channel,window_seconds,grouping_strategy,grouping_fields
    FROM operations.suppression_rules
    WHERE enabled AND operations.event_type_pattern_matches(event_type_pattern,$1)
    ORDER BY rule_key
  `,[event.eventType]);
  return r.rows.map((x:any)=>({
    ruleId:x.suppression_rule_id,ruleKey:x.rule_key,
    ...(x.channel?{channel:x.channel}:{}),windowSeconds:x.window_seconds,
    groupingStrategy:x.grouping_strategy,
    groupingFields:Array.isArray(x.grouping_fields) && x.grouping_fields.every((v:unknown)=>typeof v==="string")
      ? x.grouping_fields : []
  }));
}

export async function hasRecentMatchingDecision(args:{
  ruleId:string;groupingKey:string;decisionBasisAt:string;windowSeconds:number;
}):Promise<boolean>{
  const r=await domain10Runtime().pool.query<{exists:boolean}>(`
    SELECT EXISTS(
      SELECT 1
      FROM operations.suppression_decisions sd
      JOIN operations.operational_events e ON e.event_id=sd.event_id
      JOIN operations.event_processing ep ON ep.event_id=e.event_id
      WHERE sd.suppression_rule_id=$1
        AND sd.grouping_key=$2
        AND NOT sd.suppressed
        AND ep.decision_basis_at >= $3::timestamptz - make_interval(secs=>$4)
        AND ep.decision_basis_at <  $3::timestamptz
    ) AS exists
  `,[args.ruleId,args.groupingKey,args.decisionBasisAt,args.windowSeconds]);
  return r.rows[0]?.exists??false;
}
