import type { HealthLogger } from "../observability/healthLogger";

export interface TcdsLoggerLike {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export function adaptTcdsLogger(logger: TcdsLoggerLike): HealthLogger {
  return {
    info: (event: string, fields?: Readonly<Record<string, unknown>>) => logger.info(event, { component: "domain11b", ...(fields ?? {}) }),
    warn: (event: string, fields?: Readonly<Record<string, unknown>>) => logger.warn(event, { component: "domain11b", ...(fields ?? {}) }),
    error: (event: string, fields?: Readonly<Record<string, unknown>>) => logger.error(event, { component: "domain11b", ...(fields ?? {}) }),
  };
}
