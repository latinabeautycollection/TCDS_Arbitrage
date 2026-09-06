export type HealthState =
  | "PROCESS_ALIVE"
  | "DEPENDENCY_REACHABLE"
  | "DEPENDENCY_HEALTHY"
  | "FUNCTIONAL"
  | "DEGRADED"
  | "UNAVAILABLE"
  | "UNKNOWN";

export type HealthCheckMode = "PULL" | "PUSH" | "SYNTHETIC";
export type HealthCheckKind =
  | "PROCESS" | "HTTP" | "DATABASE" | "QUEUE" | "WORKER_HEARTBEAT"
  | "DEPENDENCY" | "PROVIDER_API" | "WEBHOOK" | "CUSTOM";
export type HealthOutcome = "SUCCESS" | "FAILURE" | "UNKNOWN";

export interface HealthCheckDefinition {
  id: string;
  componentId: string;
  checkCode: string;
  version: number;
  mode: HealthCheckMode;
  kind: HealthCheckKind;
  successState: Exclude<HealthState, "DEGRADED" | "UNAVAILABLE" | "UNKNOWN">;
  requiredForComponentHealth: boolean;
  degradesComponentHealth: boolean;
  intervalSeconds?: number;
  timeoutMs?: number;
  observationTtlSeconds: number;
  failureThreshold: number;
  recoveryThreshold: number;
  jitterSeconds: number;
  configuration: Readonly<Record<string, unknown>>;
  secretReference?: string;
}

export interface HealthCheckRuntime {
  definitionId: string;
  componentId: string;
  consecutiveSuccesses: number;
  consecutiveFailures: number;
  lastOutcome?: HealthOutcome;
  lastHealthState?: HealthState;
  lastAcceptedObservedAt?: Date;
  lastAcceptedSourceEventId?: string;
}

export interface HealthProbeResult {
  outcome: HealthOutcome;
  latencyMs?: number;
  evidence: Readonly<Record<string, unknown>>;
  errorCode?: string;
}

export interface ClassifiedHealthResult extends HealthProbeResult {
  healthState: HealthState;
  consecutiveSuccesses: number;
  consecutiveFailures: number;
  observedAt: Date;
  expiresAt: Date;
}

export interface ActiveCheckSnapshot {
  definition: HealthCheckDefinition;
  latestState?: HealthState;
  observedAt?: Date;
  expiresAt?: Date;
}

export interface ComponentHealthAggregate {
  componentId: string;
  healthState: "FUNCTIONAL" | "DEGRADED" | "UNAVAILABLE" | "UNKNOWN";
  observedAt: Date;
  expiresAt: Date;
  evidence: Readonly<Record<string, unknown>>;
}

export interface PushHealthSignal {
  definitionId: string;
  componentId: string;
  sourceEventId: string;
  outcome: HealthOutcome;
  observedAt: Date;
  latencyMs?: number;
  evidence: Readonly<Record<string, unknown>>;
}

export interface AuthenticatedHealthPrincipal {
  principalId: string;
  producerComponentId?: string;
}

export interface PushAuthorityMatch {
  authorityId: string;
  producerComponentId?: string;
}

export interface ComponentRegistrationInput {
  domainCode: `DOMAIN_${number}`;
  componentCode: string;
  componentName: string;
  componentType: "API" | "SERVICE" | "WORKER" | "QUEUE" | "DATABASE" | "EXTERNAL_API" | "SCHEDULED_JOB" | "WEBHOOK" | "PROVIDER" | "UI" | "OTHER";
  authoritativeSystem: string;
  criticality: "LOW" | "STANDARD" | "HIGH" | "CRITICAL";
  mutationAuthority?: boolean;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface DependencyRegistrationInput {
  consumerComponentId: string;
  providerComponentId?: string;
  externalDependencyCode?: string;
  dependencyKind: "HARD" | "SOFT" | "OBSERVABILITY" | "CONTROL" | "DATA_FRESHNESS";
  requiredForReadiness: boolean;
  requiredForMutation: boolean;
  requiredForExternalSideEffect: boolean;
  maxStalenessSeconds?: number;
  metadata?: Readonly<Record<string, unknown>>;
}
