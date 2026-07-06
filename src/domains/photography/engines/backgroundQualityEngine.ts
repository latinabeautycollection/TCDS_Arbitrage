import { luminanceStats } from '../utils/imageStats';
export class BackgroundQualityEngine {
  async score(buffer: Buffer): Promise<number> {
    const s = await luminanceStats(buffer); const brightClean = Math.max(0, Math.min(100, (s.mean - 110) * 0.8 + (1 - s.stddev/90)*35));
    return Math.max(0, Math.min(100, brightClean));
  }
}
