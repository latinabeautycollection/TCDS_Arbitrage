export function disclosureRiskFlags(conditionText: string, visibleDefects: string[]): string[] {
  const flags: string[] = [];
  if (/untested|as-is|parts|repair/i.test(conditionText)) flags.push('HIGH_CONDITION_UNCERTAINTY');
  if (visibleDefects.length) flags.push('VISIBLE_DEFECTS_REQUIRE_DISCLOSURE');
  return flags;
}
