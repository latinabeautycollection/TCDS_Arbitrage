import { createHash, randomUUID } from 'crypto';

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function uuid(): string {
  return randomUUID();
}

export function buildHashChain(prevHash: string | null, payload: unknown, happenedAt: string): string {
  const normalizedPrev = prevHash ?? '';
  return sha256(`${normalizedPrev}|${JSON.stringify(payload)}|${happenedAt}`);
}
