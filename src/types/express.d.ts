import type { AuthenticatedForensicPrincipal } from
  '../domains/forensic/auth/forensicPrincipal';

declare global {
  namespace Express {
    interface Request {
      forensicPrincipal?: AuthenticatedForensicPrincipal;
      correlationId?: string;
    }

    interface Locals {
      authSessionId?: string;
    }
  }
}

export {};
