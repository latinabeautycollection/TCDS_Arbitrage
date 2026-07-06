export function dedupeKeywords(keywords: string[], limit = 25): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of keywords) {
    const clean = k.toLowerCase().replace(/[^a-z0-9 +#.-]/g, '').replace(/\s+/g, ' ').trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
    if (out.length >= limit) break;
  }
  return out;
}
