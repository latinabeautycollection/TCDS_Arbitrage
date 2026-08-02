import type { AuthenticatedForensicPrincipal } from
  '../../auth/forensicPrincipal';

export type DeliveryPrincipal = AuthenticatedForensicPrincipal;

export interface Defensibility {
  result: 'STRONG' | 'DEFENSIBLE_WITH_GAPS' | 'WEAK' | 'BLOCKED';
  score: number;
  blockers: unknown[];
}
