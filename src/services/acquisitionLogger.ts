import {
  createLogger,
  serializeError,
  type Logger,
} from './logger';

export type AcquisitionLogger = Logger;

export function createAcquisitionLogger(bindings: Record<string, unknown>): AcquisitionLogger {
  return createLogger({
    serviceName: process.env.APP_SERVICE_NAME || 'arb-system-api',
    staticBindings: bindings,
  });
}

export function serializeAcquisitionError(error: unknown): ReturnType<typeof serializeError> {
  return serializeError(error);
}
