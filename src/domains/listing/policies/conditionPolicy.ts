export function normalizeConditionText(condition?: string | null): string {
  const c = (condition || '').trim();
  return c || 'Pre-owned condition. See photos and description for details.';
}

export function conditionRequiresHumanReview(condition?: string | null): boolean {
  const c = (condition || '').toLowerCase();
  return !c || c.includes('unknown') || c.includes('untested') || c.includes('parts') || c.includes('as-is');
}
