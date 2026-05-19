
import crypto from 'node:crypto';
import type { EbayEnvironment } from '../config/ebay';
import {
  createEbayClient,
  EbayClientError,
  type EbayRequestParams,
  type EbayClient,
} from './ebayClient';
import { createLogger, type Logger, serializeError } from './logger';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

export class EbayApiError extends Error {
  public readonly status: number;
  public readonly body: string;
  public readonly requestId: string;
  public readonly isRetryable: boolean;
  public readonly classification:
    | 'THROTTLED'
    | 'AUTH'
    | 'TIMEOUT'
    | 'ITEM_GROUP'
    | 'NETWORK'
    | 'SERVER'
    | 'CLIENT'
    | 'INVALID_RESPONSE'
    | 'SCOPE'
    | 'TOKEN'
    | 'UNKNOWN';

  constructor(
    message: string,
    opts: {
      status: number;
      body: string;
      requestId: string;
      isRetryable: boolean;
      classification:
        | 'THROTTLED'
        | 'AUTH'
        | 'TIMEOUT'
        | 'ITEM_GROUP'
        | 'NETWORK'
        | 'SERVER'
        | 'CLIENT'
        | 'INVALID_RESPONSE'
        | 'SCOPE'
        | 'TOKEN'
        | 'UNKNOWN';
      cause?: unknown;
    },
  ) {
    super(message);
    this.name = 'EbayApiError';
    this.status = opts.status;
    this.body = opts.body;
    this.requestId = opts.requestId;
    this.isRetryable = opts.isRetryable;
    this.classification = opts.classification;
    if (opts.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = opts.cause;
    }
  }
}

export type EbayRequestOptions = {
  environment: EbayEnvironment;
  method?: HttpMethod;
  path: string;
  requiredScopes?: string[];
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  body?: unknown;
  marketplaceId?: string;
  correlationId?: string;
};

interface ClientCacheEntry {
  client: EbayClient;
  createdAt: number;
}

const logger: Logger = createLogger({
  serviceName: 'arb-system-api',
  staticBindings: { component: 'ebayRequestLayer' },
});

const clientCache = new Map<EbayEnvironment, ClientCacheEntry>();

function getClient(environment: EbayEnvironment): EbayClient {
  const existing = clientCache.get(environment);
  if (existing) return existing.client;

  const client = createEbayClient({
    config: { environment },
    logger: logger.child({ environment, subcomponent: 'client' }),
  });

  clientCache.set(environment, { client, createdAt: Date.now() });
  return client;
}

export async function ebayRequest<T = unknown>(options: EbayRequestOptions): Promise<T> {
  const normalized = normalizeRequestOptions(options);
  try {
    const client = getClient(normalized.environment);
    const request: EbayRequestParams = {
      method: normalized.method,
      path: normalized.path,
      query: normalized.query,
      headers: normalized.headers,
      body: normalized.body,
      requiredScopes: normalized.requiredScopes,
      marketplaceId: normalized.marketplaceId,
      correlationId: normalized.correlationId,
    };

    logger.debug('dispatching ebay request', {
      operation: 'ebayRequest',
      environment: normalized.environment,
      method: normalized.method,
      path: normalized.path,
      correlationId: normalized.correlationId,
      requiredScopes: normalized.requiredScopes,
    });

    return await client.request<T>(request);
  } catch (error) {
    const mapped = mapToLegacyError(error);
    logger.warn('ebay request failed', {
      operation: 'ebayRequest',
      environment: normalized.environment,
      method: normalized.method,
      path: normalized.path,
      correlationId: normalized.correlationId,
      error: serializeError(mapped),
    });
    throw mapped;
  }
}

export async function ebayGet<T = unknown>(
  environment: EbayEnvironment,
  path: string,
  requiredScopes: string[] = [],
  query?: Record<string, string | number | boolean | undefined>,
  headers?: Record<string, string>,
  marketplaceId?: string,
  correlationId?: string,
): Promise<T> {
  return ebayRequest<T>({
    environment,
    method: 'GET',
    path,
    requiredScopes,
    query,
    headers,
    marketplaceId,
    correlationId,
  });
}

export async function ebayPost<T = unknown>(
  environment: EbayEnvironment,
  path: string,
  body: unknown,
  requiredScopes: string[] = [],
  headers?: Record<string, string>,
  marketplaceId?: string,
  correlationId?: string,
): Promise<T> {
  return ebayRequest<T>({
    environment,
    method: 'POST',
    path,
    body,
    requiredScopes,
    headers,
    marketplaceId,
    correlationId,
  });
}

export async function ebayPut<T = unknown>(
  environment: EbayEnvironment,
  path: string,
  body: unknown,
  requiredScopes: string[] = [],
  headers?: Record<string, string>,
  marketplaceId?: string,
  correlationId?: string,
): Promise<T> {
  return ebayRequest<T>({
    environment,
    method: 'PUT',
    path,
    body,
    requiredScopes,
    headers,
    marketplaceId,
    correlationId,
  });
}

export async function ebayPatch<T = unknown>(
  environment: EbayEnvironment,
  path: string,
  body: unknown,
  requiredScopes: string[] = [],
  headers?: Record<string, string>,
  marketplaceId?: string,
  correlationId?: string,
): Promise<T> {
  return ebayRequest<T>({
    environment,
    method: 'PATCH',
    path,
    body,
    requiredScopes,
    headers,
    marketplaceId,
    correlationId,
  });
}

export async function ebayDelete<T = unknown>(
  environment: EbayEnvironment,
  path: string,
  requiredScopes: string[] = [],
  query?: Record<string, string | number | boolean | undefined>,
  headers?: Record<string, string>,
  marketplaceId?: string,
  correlationId?: string,
): Promise<T> {
  return ebayRequest<T>({
    environment,
    method: 'DELETE',
    path,
    requiredScopes,
    query,
    headers,
    marketplaceId,
    correlationId,
  });
}

export function clearEbayRequestLayerClientCache(): void {
  clientCache.clear();
}

function normalizeRequestOptions(options: EbayRequestOptions): Required<
  Pick<EbayRequestOptions, 'environment' | 'method' | 'path' | 'requiredScopes' | 'correlationId'>
> & Pick<EbayRequestOptions, 'query' | 'headers' | 'body' | 'marketplaceId'> {
  const method = options.method ?? 'GET';
  const path = normalizePath(options.path);
  const requiredScopes = dedupeStrings(options.requiredScopes ?? []);
  const correlationId = options.correlationId?.trim() || crypto.randomUUID();

  validateMethod(method);
  validatePath(path);

  return {
    environment: options.environment,
    method,
    path,
    requiredScopes,
    correlationId,
    query: options.query,
    headers: options.headers,
    body: options.body,
    marketplaceId: options.marketplaceId,
  };
}

function mapToLegacyError(error: unknown): Error {
  if (error instanceof EbayApiError) return error;

  if (error instanceof EbayClientError) {
    return new EbayApiError(error.message, {
      status: error.status ?? 500,
      body: error.bodySnippet ?? '',
      requestId: error.requestId ?? 'unknown',
      isRetryable: error.retryable,
      classification: error.classification,
      cause: error,
    });
  }

  if (error instanceof Error) {
    return new EbayApiError(error.message, {
      status: 500,
      body: '',
      requestId: 'unknown',
      isRetryable: false,
      classification: 'UNKNOWN',
      cause: error,
    });
  }

  return new EbayApiError(String(error), {
    status: 500,
    body: '',
    requestId: 'unknown',
    isRetryable: false,
    classification: 'UNKNOWN',
  });
}

function validateMethod(method: string): asserts method is HttpMethod {
  if (!['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
    throw new EbayApiError(`Unsupported eBay HTTP method: ${method}`, {
      status: 400,
      body: '',
      requestId: 'local_validation',
      isRetryable: false,
      classification: 'CLIENT',
    });
  }
}

function validatePath(path: string): void {
  if (!path || path.trim().length === 0) {
    throw new EbayApiError('eBay request path must not be empty', {
      status: 400,
      body: '',
      requestId: 'local_validation',
      isRetryable: false,
      classification: 'CLIENT',
    });
  }

  if (!path.startsWith('/')) {
    throw new EbayApiError(`eBay request path must start with "/": ${path}`, {
      status: 400,
      body: '',
      requestId: 'local_validation',
      isRetryable: false,
      classification: 'CLIENT',
    });
  }
}

function normalizePath(path: string): string {
  return path.trim();
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
