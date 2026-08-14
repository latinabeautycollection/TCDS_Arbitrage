
export type OverrideLevel = "SUPERVISOR" | "EXECUTIVE" | "BREAK_GLASS";

export interface RequiredControlInput {
  controlCode: string;
  mandatory: boolean;
  minimumEvidenceCount: number;
  expectedLaborMinutes: number;
  satisfactionDeadline?: Date | null;
  requirementPayload: Record<string, unknown>;
}

export interface RiskContributionInput {
  contributionCode: string;
  contributionType: "RULE"|"FEATURE"|"MODEL"|"EVIDENCE"|"OVERRIDE";
  direction: "INCREASE"|"DECREASE"|"NEUTRAL";
  scoreDelta: number;
  hardBlock: boolean;
  explanation: string;
  weight?: number;
  normalizedValue?: number | null;
  rawValue?: unknown;
}
