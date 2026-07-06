import { laplacianSharpnessScore } from '../utils/imageStats';
export class SharpnessScoringEngine { async score(buffer: Buffer): Promise<number> { return laplacianSharpnessScore(buffer); } }
