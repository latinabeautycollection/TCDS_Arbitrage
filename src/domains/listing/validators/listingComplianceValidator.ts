import { prohibitedClaimFlags } from '../policies/prohibitedClaimsPolicy';
export function validateCompliance(title:string, html:string): string[] { return [...prohibitedClaimFlags(title), ...prohibitedClaimFlags(html)]; }
