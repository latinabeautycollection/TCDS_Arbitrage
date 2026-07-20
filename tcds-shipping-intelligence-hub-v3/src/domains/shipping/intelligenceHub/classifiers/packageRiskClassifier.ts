import type { PackageInput } from "../models/intelligenceContext";

export interface PackageRiskResult {
  score: number;
  reasonCodes: string[];
}

export function classifyPackageRisk(packages: PackageInput[]): PackageRiskResult {
  let score = 0;
  const reasons: string[] = [];

  for (const pkg of packages) {
    if (!pkg.dimensionsVerified) {
      score += 20;
      reasons.push("DIMENSIONS_UNVERIFIED");
    }
    if (!pkg.weightVerified) {
      score += 20;
      reasons.push("WEIGHT_UNVERIFIED");
    }
    if (pkg.fragile) {
      score += 10;
      reasons.push("FRAGILE");
    }
    if (pkg.hazardous) {
      score += 40;
      reasons.push("HAZARDOUS_REVIEW");
    }
    const cubic = pkg.lengthIn * pkg.widthIn * pkg.heightIn;
    if (cubic > 5184) {
      score += 20;
      reasons.push("OVERSIZE_EXPOSURE");
    }
  }
  return { score: Math.min(score, 100), reasonCodes: [...new Set(reasons)] };
}
