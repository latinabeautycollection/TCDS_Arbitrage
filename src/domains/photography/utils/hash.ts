import crypto from 'crypto';
export function sha256(input: Buffer | string): string { return crypto.createHash('sha256').update(input).digest('hex'); }
export function stableJsonHash(value: unknown): string { return sha256(JSON.stringify(value, Object.keys(value as any).sort())); }
export function hammingDistance(a: string, b: string): number {
  const len = Math.min(a.length, b.length); let d = Math.abs(a.length-b.length);
  for (let i=0;i<len;i++) if (a[i]!==b[i]) d++;
  return d;
}
export function makeEventHash(payload: unknown, prevHash = ''): string { return sha256(`${prevHash}:${JSON.stringify(payload)}`); }
