import type { ClassifiedHealthResult, HealthCheckDefinition, HealthCheckRuntime, HealthProbeResult } from "../models/healthTypes";

export class HealthClassificationEngine {
  classify(definition: HealthCheckDefinition, runtime: HealthCheckRuntime, result: HealthProbeResult, observedAt = new Date()): ClassifiedHealthResult {
    let successes = runtime.consecutiveSuccesses;
    let failures = runtime.consecutiveFailures;
    let healthState: ClassifiedHealthResult["healthState"];

    if (result.outcome === "SUCCESS") {
      successes += 1;
      failures = 0;
      const recovering = runtime.lastHealthState === "UNAVAILABLE" || runtime.lastHealthState === "DEGRADED";
      healthState = recovering && successes < definition.recoveryThreshold ? "DEGRADED" : definition.successState;
    } else if (result.outcome === "FAILURE") {
      failures += 1;
      successes = 0;
      healthState = failures >= definition.failureThreshold ? "UNAVAILABLE" : "DEGRADED";
    } else {
      successes = 0;
      failures = 0;
      healthState = runtime.lastHealthState ? "DEGRADED" : "UNKNOWN";
    }

    return {
      ...result,
      healthState,
      consecutiveSuccesses: successes,
      consecutiveFailures: failures,
      observedAt,
      expiresAt: new Date(observedAt.getTime() + definition.observationTtlSeconds * 1000),
    };
  }
}
