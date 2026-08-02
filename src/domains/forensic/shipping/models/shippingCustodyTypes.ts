import type { AuthenticatedForensicPrincipal } from
  '../../auth/forensicPrincipal';

export type ShippingPrincipal = AuthenticatedForensicPrincipal;

export interface CustodyGate {
  result: 'PASSED' | 'BLOCKED' | 'SUPERVISOR_REVIEW';
  blockers: unknown[];
  evidenceSnapshot: Record<string, unknown>;
}
