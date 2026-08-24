import type { Classification, PersistedOperationalEvent, Severity } from "./eventTypes";

export type HumanChannel = "EMAIL" | "SMS";
export type DecisionOutcome =
  | "NOTIFY"
  | "SUPPRESSED"
  | "NO_POLICY"
  | "NO_RECIPIENTS"
  | "ERROR";

export interface EventContractVersion {
  eventType: string;
  schemaVersion: number;
  lifecycleState: "DRAFT" | "FROZEN" | "RETIRED";
  jsonSchema: Record<string, unknown>;
  schemaHash: string;
  requiredTopLevelFields: string[];
  topLevelTypes: Record<string, string>;
}

export interface PolicyTemplateBinding {
  channel: HumanChannel;
  templateId: string;
  templateVersion: number;
  templateKey: string;
  subjectTemplate?: string;
  textTemplate: string;
  htmlTemplate?: string;
  contentHash: string;
  allowedVariablePaths: string[];
  requiredVariablePaths: string[];
}

export interface PolicyCandidate {
  policyId: string;
  policyKey: string;
  policyVersion: number;
  definitionHash: string;
  decisionPriority: number;
  patternSpecificity: number;
  eventTypePattern: string;
  minimumSeverity: Severity;
  maximumClassification: Classification;
  audienceId: string;
  audienceKey: string;
  audienceType: "STATIC" | "DYNAMIC" | "ON_CALL";
  emailEnabled: boolean;
  smsEnabled: boolean;
  acknowledgementRequired: boolean;
  acknowledgementTimeoutSeconds?: number;
  incidentRequired: boolean;
  suppressionWindowSeconds: number;
  maxDeliveryAttempts: number;
  escalationPolicyId?: string;
  templates: PolicyTemplateBinding[];
}

export interface RecipientResolution {
  recipientId: string;
  displayName: string;
  emailAddress?: string;
  mobileE164?: string;
  audienceKey: string;
  emailAuthorized: boolean;
  smsAuthorized: boolean;
  smsSubscriptionStatus?: "NEVER_SUBSCRIBED" | "SUBSCRIBED" | "UNSUBSCRIBED" | "SUSPENDED";
  authorizationSnapshot: Record<string, unknown>;
}

export interface ChannelSelection {
  recipient: RecipientResolution;
  emailSelected: boolean;
  smsSelected: boolean;
  reasons: string[];
}

export interface SuppressionEvaluation {
  suppressed: boolean;
  ruleId?: string;
  ruleKey?: string;
  groupingKey?: string;
  reason: string;
}

export interface PlanningContext {
  event: PersistedOperationalEvent;
  candidates: PolicyCandidate[];
  winner?: PolicyCandidate;
  suppression?: SuppressionEvaluation;
  channels?: ChannelSelection[];
}

export interface PlanningResult {
  eventId: string;
  eventType: string;
  decisionId: string;
  outcome: DecisionOutcome;
  notificationId?: string;
  policyId?: string;
  policyVersion?: number;
  recipientCount: number;
  emailDeliveryCount: number;
  smsDeliveryCount: number;
}
