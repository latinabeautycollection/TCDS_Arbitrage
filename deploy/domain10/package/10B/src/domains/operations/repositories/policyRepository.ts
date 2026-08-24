import { domain10Runtime } from "../infrastructure/operationsRuntime";
import type { PersistedOperationalEvent } from "../models/eventTypes";
import type { PolicyCandidate, PolicyTemplateBinding } from "../models/decisionTypes";

export async function getPolicyCandidates(event:PersistedOperationalEvent):Promise<PolicyCandidate[]>{
  const r=await domain10Runtime().pool.query<any>(`
    SELECT p.policy_id,p.policy_key,v.version,v.definition_hash,v.decision_priority,
           length(replace(v.event_type_pattern,'*','')) AS pattern_specificity,
           v.event_type_pattern,v.minimum_severity,v.maximum_classification,
           v.audience_id,a.audience_key,a.audience_type,
           v.email_enabled,v.sms_enabled,v.acknowledgement_required,
           v.acknowledgement_timeout_seconds,v.incident_required,
           v.suppression_window_seconds,v.max_delivery_attempts,v.escalation_policy_id
    FROM operations.notification_policies p
    JOIN operations.notification_policy_versions v ON v.policy_id=p.policy_id
    JOIN operations.notification_audiences a ON a.audience_id=v.audience_id
    WHERE v.lifecycle_state IN ('FROZEN','RETIRED')
      AND operations.event_type_pattern_matches(v.event_type_pattern,$1)
      AND operations.severity_rank($2) >= operations.severity_rank(v.minimum_severity)
      AND operations.classification_rank($3) <= operations.classification_rank(v.maximum_classification)
      AND (v.effective_from IS NULL OR v.effective_from <= $4::timestamptz)
      AND (v.effective_until IS NULL OR v.effective_until > $4::timestamptz)
    ORDER BY v.decision_priority DESC,
             length(replace(v.event_type_pattern,'*','')) DESC,
             p.policy_key ASC
  `,[event.eventType,event.severity,event.classification,event.decisionBasisAt]);

  const candidates:PolicyCandidate[]=[];
  for(const x of r.rows){
    const tr=await domain10Runtime().pool.query<any>(`
      SELECT pct.channel,pct.template_id,pct.template_version,t.template_key,
             tv.subject_template,tv.text_template,tv.html_template,tv.content_hash,
             pct.allowed_variable_paths,pct.required_variable_paths
      FROM operations.policy_channel_templates pct
      JOIN operations.notification_templates t ON t.template_id=pct.template_id
      JOIN operations.notification_template_versions tv
        ON tv.template_id=pct.template_id AND tv.version=pct.template_version
      WHERE pct.policy_id=$1 AND pct.policy_version=$2
      ORDER BY pct.channel
    `,[x.policy_id,x.version]);

    const templates:PolicyTemplateBinding[]=tr.rows.map((t:any)=>({
      channel:t.channel,templateId:t.template_id,templateVersion:t.template_version,
      templateKey:t.template_key,
      ...(t.subject_template?{subjectTemplate:t.subject_template}:{}),
      textTemplate:t.text_template,
      ...(t.html_template?{htmlTemplate:t.html_template}:{}),
      contentHash:t.content_hash,
      allowedVariablePaths:t.allowed_variable_paths,
      requiredVariablePaths:t.required_variable_paths
    }));

    candidates.push({
      policyId:x.policy_id,policyKey:x.policy_key,policyVersion:x.version,
      definitionHash:x.definition_hash,decisionPriority:x.decision_priority,
      patternSpecificity:x.pattern_specificity,eventTypePattern:x.event_type_pattern,
      minimumSeverity:x.minimum_severity,maximumClassification:x.maximum_classification,
      audienceId:x.audience_id,audienceKey:x.audience_key,audienceType:x.audience_type,
      emailEnabled:x.email_enabled,smsEnabled:x.sms_enabled,
      acknowledgementRequired:x.acknowledgement_required,
      ...(x.acknowledgement_timeout_seconds?{acknowledgementTimeoutSeconds:x.acknowledgement_timeout_seconds}:{}),
      incidentRequired:x.incident_required,suppressionWindowSeconds:x.suppression_window_seconds,
      maxDeliveryAttempts:x.max_delivery_attempts,
      ...(x.escalation_policy_id?{escalationPolicyId:x.escalation_policy_id}:{}),
      templates
    });
  }
  return candidates;
}
