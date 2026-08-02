import type {
  AuthenticatedForensicPrincipal,
  ForensicActorType,
} from '../auth/forensicPrincipal';

export type { AuthenticatedForensicPrincipal, ForensicActorType };

export interface ForensicRequestContext {
  readonly principal: AuthenticatedForensicPrincipal;
  readonly correlationId: string;
}

export interface ForensicLogger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export interface ManifestBuildJob {
  manifestRequestId: string;
  tenantKey: string;
  correlationId: string;
}

export interface OutboxManifestPayload {
  chainId: string;
  manifestType: string;
  tenantKey: string;
}
