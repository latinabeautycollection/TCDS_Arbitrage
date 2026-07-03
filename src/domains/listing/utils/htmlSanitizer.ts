const ALLOWED_TAGS = new Set(['p','br','ul','ol','li','strong','b','em','i','h2','h3','table','tbody','tr','td']);

export function sanitizeEbayHtml(html: string): string {
  let out = html || '';
  out = out.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');
  out = out.replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '');
  out = out.replace(/\son\w+="[^"]*"/gi, '');
  out = out.replace(/\sstyle="[^"]*"/gi, '');
  out = out.replace(/javascript:/gi, '');
  out = out.replace(/<\/?([a-z0-9]+)(\s[^>]*)?>/gi, (m, tag) => ALLOWED_TAGS.has(String(tag).toLowerCase()) ? m : '');
  return out.trim();
}
