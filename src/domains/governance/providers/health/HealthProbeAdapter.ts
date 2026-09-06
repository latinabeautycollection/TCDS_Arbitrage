import type { HealthCheckDefinition, HealthProbeResult } from "../../models/healthTypes";

export interface HealthProbeExecutionContext {
  signal: AbortSignal;
  resolveSecret?: (secretReference: string) => Promise<Readonly<Record<string, string>>>;
}

export interface HealthProbeAdapter {
  readonly kind: HealthCheckDefinition["kind"];
  execute(definition: HealthCheckDefinition, context: HealthProbeExecutionContext): Promise<HealthProbeResult>;
}
