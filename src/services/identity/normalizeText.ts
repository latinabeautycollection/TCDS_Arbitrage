const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'new', 'used', 'tested', 'working', 'lot',
  'bundle', 'set', 'kit', 'item', 'black', 'white', 'silver', 'gray', 'grey',
]);

export function normalizeWhitespace(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/\s+/g, ' ').trim();
}

export function normalizeAlphaNumeric(value: string | null | undefined): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s\-_]/gu, ' ')
    .replace(/[_\s]+/g, ' ')
    .trim();
}

export function normalizeToken(value: string): string {
  return normalizeAlphaNumeric(value).replace(/\s+/g, '_');
}

export function tokenize(value: string): string[] {
  return normalizeAlphaNumeric(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .filter((token) => !STOP_WORDS.has(token));
}

export function safeSlug(parts: Array<string | null | undefined>): string | null {
  const clean = parts
    .map((part) => (part ? normalizeToken(part) : ''))
    .filter((part) => part.length > 0);

  if (clean.length === 0) return null;
  return clean.join('|');
}
