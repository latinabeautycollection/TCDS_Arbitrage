import type { ActiveCheckSnapshot, ComponentHealthAggregate } from "../models/healthTypes";

const SUCCESS = new Set(["PROCESS_ALIVE", "DEPENDENCY_REACHABLE", "DEPENDENCY_HEALTHY", "FUNCTIONAL"]);
const EXPIRY_RECHECK_MS = 30_000;

export class ComponentHealthAggregationEngine {
  aggregate(componentId: string, checks: readonly ActiveCheckSnapshot[], now = new Date()): ComponentHealthAggregate {
    const required = checks.filter((c) => c.definition.requiredForComponentHealth);
    const considered = checks.filter((c) => c.definition.requiredForComponentHealth || c.definition.degradesComponentHealth);
    const isExpired = (c: ActiveCheckSnapshot): boolean => !c.expiresAt || c.expiresAt.getTime() <= now.getTime();

    const evidenceChecks = considered.map((c) => ({
      checkCode: c.definition.checkCode,
      required: c.definition.requiredForComponentHealth,
      degrades: c.definition.degradesComponentHealth,
      state: c.latestState ?? "UNKNOWN",
      expired: isExpired(c),
    }));

    let healthState: ComponentHealthAggregate["healthState"] = "FUNCTIONAL";
    if (!required.length) healthState = "UNKNOWN";
    else if (required.some((c) => !c.latestState)) healthState = "UNKNOWN";
    else if (required.some(isExpired)) healthState = "UNAVAILABLE";
    else if (required.some((c) => c.latestState === "UNAVAILABLE")) healthState = "UNAVAILABLE";
    else if (required.some((c) => c.latestState === "UNKNOWN")) healthState = "UNKNOWN";
    else if (required.some((c) => c.latestState === "DEGRADED")) healthState = "DEGRADED";
    else if (considered.some((c) => !c.definition.requiredForComponentHealth && c.definition.degradesComponentHealth && isExpired(c))) healthState = "DEGRADED";
    else if (considered.some((c) => c.definition.degradesComponentHealth && (c.latestState === "DEGRADED" || c.latestState === "UNAVAILABLE" || c.latestState === "UNKNOWN"))) healthState = "DEGRADED";
    else if (!required.every((c) => c.latestState && SUCCESS.has(c.latestState))) healthState = "UNKNOWN";

    const relevantExpirations = considered
      .filter((c) => c.definition.requiredForComponentHealth || c.definition.degradesComponentHealth)
      .map((c) => c.expiresAt?.getTime())
      .filter((v): v is number => typeof v === "number" && v > now.getTime());
    const hasExpiredRelevant = considered.some(isExpired);
    const expiresAt = hasExpiredRelevant
      ? new Date(now.getTime() + EXPIRY_RECHECK_MS)
      : relevantExpirations.length
        ? new Date(Math.min(...relevantExpirations))
        : new Date(now.getTime() + EXPIRY_RECHECK_MS);

    return {
      componentId,
      healthState,
      observedAt: now,
      expiresAt,
      evidence: { algorithm: "11B_COMPONENT_HEALTH_V2", checks: evidenceChecks },
    };
  }
}
