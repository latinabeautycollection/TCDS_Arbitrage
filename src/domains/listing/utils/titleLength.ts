export function fitEbayTitle(title: string, max = 80): string {
  const cleaned = title.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= max) return cleaned;
  const remove = ['Authentic','Original','Genuine','Excellent','Amazing','Rare','Deal'];
  let out = cleaned;
  for (const word of remove) out = out.replace(new RegExp(`\\b${word}\\b`, 'gi'), '').replace(/\s+/g, ' ').trim();
  return out.length <= max ? out : out.slice(0, max).replace(/\s+\S*$/, '').trim();
}
