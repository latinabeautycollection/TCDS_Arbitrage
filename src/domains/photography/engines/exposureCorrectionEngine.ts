import sharp from 'sharp';
import { luminanceStats } from '../utils/imageStats';
export class ExposureCorrectionEngine {
  async score(buffer: Buffer): Promise<number> {
    const s = await luminanceStats(buffer); const meanPenalty = Math.abs(s.mean - 138) * 0.55; const clipPenalty = (s.darkRatio + s.lightRatio) * 45;
    return Math.max(0, Math.min(100, 100 - meanPenalty - clipPenalty));
  }
  async correct(buffer: Buffer): Promise<{buffer: Buffer; changed: boolean; scoreBefore: number; scoreAfter: number; operation?: string}> {
    const before = await this.score(buffer);
    if (before >= 75) return { buffer, changed: false, scoreBefore: before, scoreAfter: before };
    const out = await sharp(buffer).normalize().modulate({ brightness: 1.05, saturation: 1.03 }).jpeg({ quality: 90 }).toBuffer();
    return { buffer: out, changed: true, scoreBefore: before, scoreAfter: await this.score(out), operation: 'normalize+modulate' };
  }
}
