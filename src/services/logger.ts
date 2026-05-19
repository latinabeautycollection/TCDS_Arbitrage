import crypto from 'node:crypto';
import os from 'node:os';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  requestId?: string;
  correlationId?: string;
  workerName?: string;
  workerInstanceId?: string;
  operation?: string;
  component?: string;
  [key: string]: unknown;
}

export interface Logger {
  child(bindings: LogContext): Logger;
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}

interface LoggerOptions {
  serviceName: string;
  environment: string;
  level: LogLevel;
  hostname: string;
  pid: number;
  staticBindings?: LogContext;
}

interface LogRecord {
  ts: string;
  level: LogLevel;
  levelNo: number;
  msg: string;
  eventId: string;
  service: string;
  env: string;
  hostname: string;
  pid: number;
  [key: string]: unknown;
}

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const REDACT_KEY_PATTERNS = [
  /authorization/i,
  /access[_-]?token/i,
  /refresh[_-]?token/i,
  /client[_-]?secret/i,
  /^secret$/i,
  /password/i,
  /api[_-]?key/i,
  /cookie/i,
  /set-cookie/i,
  /session/i,
  /bearer/i,
  /private[_-]?key/i,
];

const MAX_STRING_LENGTH = 5_000;
const MAX_ARRAY_ITEMS = 100;
const MAX_OBJECT_KEYS = 200;
const MAX_DEPTH = 8;

class JsonLogger implements Logger {
  constructor(private readonly options: LoggerOptions) {}

  child(bindings: LogContext): Logger {
    return new JsonLogger({
      ...this.options,
      staticBindings: mergeBindings(this.options.staticBindings, bindings),
    });
  }

  debug(message: string, context?: LogContext): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: LogContext): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.log('warn', message, context);
  }

  error(message: string, context?: LogContext): void {
    this.log('error', message, context);
  }

  private log(level: LogLevel, message: string, context?: LogContext): void {
    if (LOG_LEVEL_ORDER[level] < LOG_LEVEL_ORDER[this.options.level]) {
      return;
    }

    const mergedContext = mergeBindings(
      this.options.staticBindings,
      context,
    );

    const record: LogRecord = {
      ts: new Date().toISOString(),
      level,
      levelNo: LOG_LEVEL_ORDER[level],
      msg: message,
      eventId: crypto.randomUUID(),
      service: this.options.serviceName,
      env: this.options.environment,
      hostname: this.options.hostname,
      pid: this.options.pid,
      ...sanitizeForLogging(mergedContext),
    };

    const serialized = safeStringify(record);

    if (level === 'warn' || level === 'error') {
      process.stderr.write(`${serialized}\n`);
      return;
    }

    process.stdout.write(`${serialized}\n`);
  }
}

export interface CreateLoggerInput {
  serviceName?: string;
  environment?: string;
  level?: LogLevel;
  staticBindings?: LogContext;
}

export function createLogger(input: CreateLoggerInput = {}): Logger {
  return new JsonLogger({
    serviceName: input.serviceName ?? env('APP_SERVICE_NAME', 'arb-system-api'),
    environment: input.environment ?? env('NODE_ENV', 'development'),
    level: parseLogLevel(env('LOG_LEVEL', input.level ?? 'info')),
    hostname: os.hostname(),
    pid: process.pid,
    staticBindings: sanitizeForLogging(input.staticBindings ?? {}),
  });
}

export function createRequestId(): string {
  return crypto.randomUUID();
}

export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return sanitizeForLogging({
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: (error as Error & { cause?: unknown }).cause,
      ...(extractErrorFields(error)),
    });
  }

  if (isRecord(error)) {
    return sanitizeForLogging({
      ...error,
      valueType: 'object',
    });
  }

  return sanitizeForLogging({
    value: String(error),
    valueType: typeof error,
  });
}

function extractErrorFields(error: Error): Record<string, unknown> {
  const output: Record<string, unknown> = {};

  const candidate = error as Error & {
    status?: unknown;
    code?: unknown;
    classification?: unknown;
    retryable?: unknown;
    requestId?: unknown;
    bodySnippet?: unknown;
    retryAfterMs?: unknown;
  };

  if (candidate.status !== undefined) output.status = candidate.status;
  if (candidate.code !== undefined) output.code = candidate.code;
  if (candidate.classification !== undefined) output.classification = candidate.classification;
  if (candidate.retryable !== undefined) output.retryable = candidate.retryable;
  if (candidate.requestId !== undefined) output.requestId = candidate.requestId;
  if (candidate.bodySnippet !== undefined) output.bodySnippet = candidate.bodySnippet;
  if (candidate.retryAfterMs !== undefined) output.retryAfterMs = candidate.retryAfterMs;

  return output;
}

function parseLogLevel(value: string): LogLevel {
  const normalized = value.trim().toLowerCase();
  if (
    normalized === 'debug' ||
    normalized === 'info' ||
    normalized === 'warn' ||
    normalized === 'error'
  ) {
    return normalized;
  }
  return 'info';
}

function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value?.trim() || fallback;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({
      ts: new Date().toISOString(),
      level: 'error',
      levelNo: LOG_LEVEL_ORDER.error,
      msg: 'Failed to stringify log record',
      eventId: crypto.randomUUID(),
    });
  }
}

function mergeBindings(
  base?: LogContext,
  extra?: LogContext,
): LogContext {
  return {
    ...(base ?? {}),
    ...(extra ?? {}),
  };
}

function sanitizeForLogging<T>(input: T): T {
  return deepSanitize(input, 0, new WeakSet<object>()) as T;
}

function deepSanitize(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (depth > MAX_DEPTH) {
    return '[MaxDepthExceeded]';
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    return truncate(value, MAX_STRING_LENGTH);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'symbol') {
    return value.toString();
  }

  if (typeof value === 'function') {
    return `[Function ${value.name || 'anonymous'}]`;
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => deepSanitize(item, depth + 1, seen));
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncate(value.message, MAX_STRING_LENGTH),
      stack: truncate(value.stack ?? '', MAX_STRING_LENGTH),
      cause: deepSanitize(
        (value as Error & { cause?: unknown }).cause,
        depth + 1,
        seen,
      ),
      ...extractErrorFields(value),
    };
  }

  if (typeof value === 'object') {
    if (seen.has(value as object)) {
      return '[Circular]';
    }

    seen.add(value as object);

    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};

    let processed = 0;

    for (const [key, val] of Object.entries(input)) {
      if (processed >= MAX_OBJECT_KEYS) {
        output.__truncated__ = `[Object truncated after ${MAX_OBJECT_KEYS} keys]`;
        break;
      }

      if (shouldRedactKey(key)) {
        output[key] = '[REDACTED]';
      } else {
        output[key] = deepSanitize(val, depth + 1, seen);
      }

      processed += 1;
    }

    return output;
  }

  return String(value);
}

function shouldRedactKey(key: string): boolean {
  return REDACT_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength)}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
