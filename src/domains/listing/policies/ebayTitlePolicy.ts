export function validateEbayTitlePolicy(title: string): string[] {
  const errors: string[] = [];
  if (!title.trim()) errors.push('TITLE_EMPTY');
  if (title.length > 80) errors.push('TITLE_TOO_LONG');
  if (/[🔥⭐✅💥]/.test(title)) errors.push('TITLE_CONTAINS_EMOJI');
  if (/\bfree shipping\b/i.test(title)) errors.push('TITLE_CONTAINS_SHIPPING_CLAIM');
  return errors;
}
