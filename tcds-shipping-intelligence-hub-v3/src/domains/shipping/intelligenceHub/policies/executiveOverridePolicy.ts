export interface ExecutiveOverride {
  overrideId: string;
  approvedBy: string;
  approvedAt: Date;
  expiresAt?: Date;
  reason: string;
  permittedDecision: "ALLOW" | "ALLOW_WITH_REQUIREMENTS";
}

export function isOverrideValid(override?: ExecutiveOverride): boolean {
  if (!override) return false;
  if (override.expiresAt && override.expiresAt.getTime() <= Date.now()) return false;
  return override.reason.trim().length >= 10 && override.approvedBy.trim().length > 0;
}
