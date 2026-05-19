import { Logger, serializeError } from './logger';

export type RetryClassification =
  | 'RETRYABLE'
  | 'NON_RETRYABLE'
  | 'THROTTLED'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'AUTH'
  | 'SERVER'
  | 'CLIENT'
  | 'UNKNOWN';

export interface RetryableError extends Error {
  retryable?: boolean;
  classification?: RetryClassification;
  status?: number;
  retryAfterMs?: number;
  requestId?: string;
}

export interface RetryContext {
  operation: string;
  requestId?: string;
  correlationId?: string;
  attempt: number;
  maxRetries: number;
  classification: RetryClassification;
}

export interface RetryOptions {
  operation: string;
  logger?: Logger;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  onRetry?: (error: unknown, context: RetryContext, delayMs: number) => Promise<void> | void;
  shouldRetry?: (error: unknown, context: RetryContext) => boolean;
  requestId?: string;
  correlationId?: string;
}

export async function withRetry<T>(
  work: (attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const logger = options.logger;
  const maxRetries = normalizePositiveInt(options.maxRetries, 4);
  const baseDelayMs = normalizePositiveInt(options.baseDelayMs, 400);
  const maxDelayMs = normalizePositiveInt(options.maxDelayMs, 10_000);
  const jitterRatio = normalizeJitterRatio(options.jitterRatio, 0.25);
  const startedAt = Date.now();

  let attempt = 0;
  let lastError: unknown;

  while (attempt <= maxRetries) {
    throwIfAborted(options.signal, options.operation);

    const executionPromise = work(attempt);
    const guardedPromise =
      options.timeoutMs && options.timeoutMs > 0
        ? raceWithTimeout(executionPromise, options.timeoutMs, options.operation)
        : executionPromise;

    try {
      return await guardedPromise;
    } catch (error) {
      lastError = error;

      const classification = classifyError(error);
      const context: RetryContext = {
        operation: options.operation,
        requestId: options.requestId,
        correlationId: options.correlationId,
        attempt,
        maxRetries,
        classification,
      };

      const retryable = options.shouldRetry
        ? options.shouldRetry(error, context)
        : isRetryableError(error);

      if (!retryable || attempt >= maxRetries) {
        logger?.error('retry operation failed permanently', {
          component: 'retry',
          operation: options.operation,
          requestId: options.requestId,
          correlationId: options.correlationId,
          attempt,
          maxRetries,
          classification,
          retryable,
          elapsedMs: Date.now() - startedAt,
          error: serializeError(error),
        });

        throw error;
      }

      const delayMs = computeBackoffDelay({
        attempt,
        baseDelayMs,
        maxDelayMs,
        jitterRatio,
        error,
      });

      logger?.warn('retry operation scheduled', {
        component: 'retry',
        operation: options.operation,
        requestId: options.requestId,
        correlationId: options.correlationId,
        attempt,
        maxRetries,
        classification,
        delayMs,
        elapsedMs: Date.now() - startedAt,
        error: serializeError(error),
      });

      if (options.onRetry) {
        await options.onRetry(error, context, delayMs);
      }

      await sleep(delayMs, options.signal, options.operation);
      attempt += 1;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Retry loop ended unexpectedly');
}

export function isRetryableError(error: unknown): boolean {
  const classification = classifyError(error);

  switch (classification) {
    case 'THROTTLED':
    case 'TIMEOUT':
    case 'NETWORK':
    case 'SERVER':
    case 'RETRYABLE':
      return true;
    case 'AUTH':
    case 'CLIENT':
    case 'NON_RETRYABLE':
      return false;
    case 'UNKNOWN':
    default:
      if (error instanceof Error) {
        const message = error.message.toLowerCase();
        return (
          message.includes('timeout') ||
          message.includes('network') ||
          message.includes('fetch failed') ||
          message.includes('econnreset') ||
          message.includes('econnrefused') ||
          message.includes('socket hang up') ||
          message.includes('temporarily unavailable') ||
          message.includes('connection terminated')
        );
      }
      return false;
  }
}

export function classifyError(error: unknown): RetryClassification {
  if (error && typeof error === 'object') {
    const candidate = error as RetryableError;

    if (candidate.classification) {
      return candidate.classification;
    }

    if (candidate.retryable === true) {
      return 'RETRYABLE';
    }

    if (candidate.retryable === false) {
      return 'NON_RETRYABLE';
    }

    if (typeof candidate.status === 'number') {
      if (candidate.status === 429) return 'THROTTLED';
      if (candidate.status === 401 || candidate.status === 403) return 'AUTH';
      if (candidate.status >= 500) return 'SERVER';
      if (candidate.status >= 400) return 'CLIENT';
    }
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    if (message.includes('429') || message.includes('throttle')) return 'THROTTLED';
    if (message.includes('timeout') || message.includes('aborterror')) return 'TIMEOUT';

    if (
      message.includes('network') ||
      message.includes('fetch failed') ||
      message.includes('econnreset') ||
      message.includes('econnrefused') ||
      message.includes('socket') ||
      message.includes('connection terminated')
    ) {
      return 'NETWORK';
    }

    if (
      message.includes('401') ||
      message.includes('403') ||
      message.includes('auth') ||
      message.includes('token') ||
      message.includes('scope')
    ) {
      return 'AUTH';
    }
  }

  return 'UNKNOWN';
}

export function computeBackoffDelay(input: {
  attempt: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterRatio: number;
  error?: unknown;
}): number {
  const retryAfterMs = extractRetryAfterMs(input.error);

  if (retryAfterMs && retryAfterMs > 0) {
    const throttledDelay = Math.min(input.maxDelayMs, retryAfterMs);
    return addJitter(throttledDelay, input.jitterRatio, input.maxDelayMs);
  }

  const expDelay = Math.min(
    input.maxDelayMs,
    input.baseDelayMs * 2 ** Math.max(0, input.attempt),
  );

  return addJitter(expDelay, input.jitterRatio, input.maxDelayMs);
}

function extractRetryAfterMs(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  const candidate = error as RetryableError;
  if (
    typeof candidate.retryAfterMs === 'number' &&
    Number.isFinite(candidate.retryAfterMs) &&
    candidate.retryAfterMs > 0
  ) {
    return candidate.retryAfterMs;
  }

  return undefined;
}

function addJitter(baseDelayMs: number, jitterRatio: number, maxDelayMs: number): number {
  const jitterMax = Math.max(50, Math.floor(baseDelayMs * jitterRatio));
  const jitter = Math.floor(Math.random() * jitterMax);
  return Math.min(maxDelayMs, baseDelayMs + jitter);
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isFinite(value) || value < 0) {
    return fallback;
  }

  return Math.floor(value);
}

function normalizeJitterRatio(value: number | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isFinite(value) || value < 0) {
    return fallback;
  }

  return Math.min(value, 1);
}

async function raceWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      const error = new Error(`Retry-wrapped operation timed out after ${timeoutMs}ms: ${operation}`) as RetryableError;
      error.classification = 'TIMEOUT';
      error.retryable = true;
      reject(error);
    }, timeoutMs);

    void promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function throwIfAborted(signal: AbortSignal | undefined, operation: string): void {
  if (signal?.aborted) {
    const error = new Error(`Retry operation aborted: ${operation}`) as RetryableError;
    error.classification = 'NON_RETRYABLE';
    error.retryable = false;
    throw error;
  }
}

function sleep(ms: number, signal?: AbortSignal, operation = 'retry'): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return rejectAbort(operation, reject);
    }

    const timeout = setTimeout(() => {
      if (signal && onAbort) {
        signal.removeEventListener('abort', onAbort);
      }
      resolve();
    }, ms);

    const onAbort = signal
      ? () => {
          clearTimeout(timeout);
          signal.removeEventListener('abort', onAbort!);
          rejectAbort(operation, reject);
        }
      : undefined;

    if (signal && onAbort) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

function rejectAbort(
  operation: string,
  reject: (reason?: unknown) => void,
): void {
  const error = new Error(`Retry sleep aborted: ${operation}`) as RetryableError;
  error.classification = 'NON_RETRYABLE';
  error.retryable = false;
  reject(error);
}
