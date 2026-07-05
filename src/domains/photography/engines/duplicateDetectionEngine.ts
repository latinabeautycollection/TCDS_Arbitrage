import { hammingDistance } from '../utils/hash';
export class DuplicateDetectionEngine {
  score(currentHash: string, existing: string[]): number {
    if (!existing.length) return 0;
    const min = Math.min(...existing.map(h=>hammingDistance(currentHash,h)));
    return Math.max(0, Math.min(100, (12-min)*10));
  }
}
