import { detectUnsupportedClaims } from '../utils/claimDetector';
export function prohibitedClaimFlags(text: string): string[] { return detectUnsupportedClaims(text); }
