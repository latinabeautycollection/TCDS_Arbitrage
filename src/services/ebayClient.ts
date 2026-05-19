
import crypto from 'node:crypto';
import { MemoryTtlCache, type Cache } from './cache';
import { createLogger, type Logger } from './logger';
import { RateLimiter } from './rateLimiter';
import { withRetry } from './retry';
import type { EbayEnvironment } from '../config/ebay';
import { getEbayConfig } from '../config/ebay';
import { refreshAccessToken } from './ebayOAuth';
import {
  getLatestActiveToken,
  setTokenError,
  updateTokenById,
  type StoredEbayToken,
} from './tokenStore';
import { ensureScopesPresent } from './ebayScopes';

type BrowseSearchMode = 'sold' | 'active';
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
export type AnalysisProng = 'PRONG1' | 'PRONG2';

export interface EbayClientConfig {
  environment: EbayEnvironment;
  marketplaceId: string;
  requestTimeoutMs: number;
  maxRetries: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
  minRequestIntervalMs: number;
  maxConcurrentRequests: number;
  defaultCacheTtlMs: number;
  tokenCacheTtlSafetyMs: number;
  userAgent: string;
  browseSearchLimitDefault: number;
  browseSearchLimitMax: number;
  taxonomyCategoryTreeId: string;
  detailFieldgroups: string[];
}

export interface NormalizedBrowseCategory {
  categoryId?: string;
  categoryName?: string;
}

export interface NormalizedBrowseSeller {
  username?: string;
  feedbackPercentage?: string;
  feedbackScore?: number;
}

export interface NormalizedLocalizedAspect {
  name: string;
  values: string[];
}

export interface NormalizedImage {
  imageUrl?: string;
  height?: number;
  width?: number;
}

export interface NormalizedBrowseItem {
  itemId: string;
  legacyItemId?: string;
  title: string;
  subtitle?: string;
  shortDescription?: string;
  priceValue: number | null;
  priceCurrency: string | null;
  itemWebUrl?: string;
  itemLocationCountry?: string;
  itemLocationState?: string;
  condition?: string;
  conditionId?: string;
  conditionText?: string;
  buyingOptions: string[];
  categories: NormalizedBrowseCategory[];
  categoryId?: string;
  categoryPath?: string;
  seller?: NormalizedBrowseSeller;
  imageUrl?: string;
  additionalImages?: string[];
  itemCreationDate?: string;
  itemEndDate?: string;
  bidCount?: number;
  shippingCostValue?: number | null;
  shippingCostCurrency?: string | null;
  totalPriceValue?: number | null;
  brand?: string;
  mpn?: string;
  gtin?: string;
  localizedAspects?: NormalizedLocalizedAspect[];
  epid?: string;
  raw: unknown;
}

export interface BrowseSearchParams {
  query?: string;
  gtin?: string;
  epid?: string;
  limit?: number;
  offset?: number;
  categoryIds?: string[];
  fieldgroups?: string[];
  compatibilityFilter?: string;
  aspectFilter?: string;
  additionalFilters?: string[];
  signalKey?: string;
  cacheTtlMs?: number;
  correlationId?: string;
  requiredScopes?: string[];
  marketplaceId?: string;
  analysisProng?: AnalysisProng;
}

export interface BrowseSearchResult {
  mode: BrowseSearchMode;
  total: number;
  itemSummaries: NormalizedBrowseItem[];
  href?: string;
  next?: string;
  limit: number;
  offset: number;
  cacheHit: boolean;
  requestId: string;
  fetchedAt: string;
}

export interface EbayRequestParams {
  method?: HttpMethod;
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  body?: unknown;
  requiredScopes?: string[];
  correlationId?: string;
  marketplaceId?: string;
}

export interface TokenState {
  tokenId: string;
  accessToken: string;
  tokenType: string | null;
  expiresAtEpochMs: number;
  scope?: string | null;
  refreshToken?: string | null;
}

export interface DetailedEbayItem {
  itemId: string;
  legacyItemId?: string;
  title: string;
  subtitle?: string;
  shortDescription?: string;
  description?: string;
  brand?: string;
  mpn?: string;
  gtins: string[];
  epid?: string;
  categoryId?: string;
  categoryPath?: string;
  categoryTreeId?: string;
  condition?: string;
  conditionId?: string;
  buyingOptions: string[];
  itemWebUrl?: string;
  priceValue: number | null;
  priceCurrency: string | null;
  shippingValue: number | null;
  shippingCurrency: string | null;
  totalPriceValue: number | null;
  sellerUsername?: string;
  sellerFeedbackScore?: number;
  sellerFeedbackPercentage?: string;
  imageUrl?: string;
  additionalImages: string[];
  itemCreationDate?: string;
  itemEndDate?: string;
  itemLocationCountry?: string;
  itemLocationState?: string;
  localizedAspects: NormalizedLocalizedAspect[];
  product?: CatalogProductDetail;
  raw: unknown;
}

export interface CatalogProductSummary {
  epid: string;
  title?: string;
  brand?: string;
  mpns: string[];
  gtins: string[];
  productHref?: string;
  imageUrls: string[];
  aspects: NormalizedLocalizedAspect[];
  raw: unknown;
}

export interface CatalogProductDetail {
  epid: string;
  title?: string;
  description?: string;
  brand?: string;
  mpns: string[];
  gtins: string[];
  primaryCategoryId?: string;
  categoryIds: string[];
  imageUrls: string[];
  aspects: NormalizedLocalizedAspect[];
  raw: unknown;
}

export interface TaxonomyAspectValue {
  value: string;
  localizedValue?: string;
}

export interface TaxonomyAspectMetadata {
  localizedAspectName: string;
  aspectRequired: boolean;
  aspectUsage?: string;
  itemToAspectCardinality?: string;
  aspectMode?: string;
  values: TaxonomyAspectValue[];
}

export interface TaxonomyAspectResponse {
  categoryTreeId: string;
  categoryId: string;
  aspects: TaxonomyAspectMetadata[];
  raw: unknown;
}

export interface ItemDetailParams {
  correlationId?: string;
  requiredScopes?: string[];
  marketplaceId?: string;
  includeProduct?: boolean;
  analysisProng?: AnalysisProng;
}

export interface CatalogSearchParams {
  q?: string;
  gtin?: string;
  mpn?: string;
  brand?: string;
  categoryIds?: string[];
  limit?: number;
  offset?: number;
  correlationId?: string;
  marketplaceId?: string;
  requiredScopes?: string[];
}

export class EbayClientError extends Error {
  public readonly status?: number;
  public readonly retryable: boolean;
  public readonly classification:
    | 'THROTTLED'
    | 'AUTH'
    | 'TIMEOUT'
    | 'NETWORK'
    | 'SERVER'
    | 'CLIENT'
    | 'ITEM_GROUP'
    | 'INVALID_RESPONSE'
    | 'SCOPE'
    | 'TOKEN'
    | 'UNKNOWN';
  public readonly requestId?: string;
  public readonly bodySnippet?: string;
  public readonly retryAfterMs?: number;

  constructor(input: {
    message: string;
    status?: number;
    retryable: boolean;
    classification:
      | 'THROTTLED'
      | 'AUTH'
      | 'TIMEOUT'
      | 'NETWORK'
      | 'SERVER'
      | 'CLIENT'
      | 'ITEM_GROUP'
      | 'INVALID_RESPONSE'
      | 'SCOPE'
      | 'TOKEN'
      | 'UNKNOWN';
    requestId?: string;
    bodySnippet?: string;
    retryAfterMs?: number;
    cause?: unknown;
  }) {
    super(input.message);
    this.name = 'EbayClientError';
    this.status = input.status;
    this.retryable = input.retryable;
    this.classification = input.classification;
    this.requestId = input.requestId;
    this.bodySnippet = input.bodySnippet;
    this.retryAfterMs = input.retryAfterMs;
    if (input.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = input.cause;
    }
  }
}

interface BrowseSearchApiResponse {
  href?: string;
  next?: string;
  total?: number;
  limit?: number;
  offset?: number;
  itemSummaries?: unknown[];
}

interface CreateEbayClientInput {
  config?: Partial<EbayClientConfig>;
  logger?: Logger;
  cache?: Cache;
}

const refreshInFlight = new Map<string, Promise<StoredEbayToken>>();

export class EbayClient {
  private readonly config: EbayClientConfig;
  private readonly logger: Logger;
  private readonly cache: Cache;
  private readonly limiter: RateLimiter;

  constructor(input: CreateEbayClientInput = {}) {
    const configuredEnvironment = getEnumEnv<EbayEnvironment>(
      'EBAY_ENVIRONMENT',
      ['production', 'sandbox'],
      'production',
    );

    this.config = {
      environment: configuredEnvironment,
      marketplaceId: getEnv('EBAY_MARKETPLACE_ID', 'EBAY_US'),
      requestTimeoutMs: getIntEnv('EBAY_REQUEST_TIMEOUT_MS', 15_000),
      maxRetries: getIntEnv('EBAY_HTTP_MAX_RETRIES', 4),
      baseBackoffMs: getIntEnv('EBAY_HTTP_BASE_BACKOFF_MS', 400),
      maxBackoffMs: getIntEnv('EBAY_HTTP_MAX_BACKOFF_MS', 6_000),
      minRequestIntervalMs: getIntEnv('EBAY_MIN_REQUEST_INTERVAL_MS', 250),
      maxConcurrentRequests: getIntEnv('EBAY_MAX_CONCURRENT_REQUESTS', 2),
      defaultCacheTtlMs: getIntEnv('EBAY_DEFAULT_CACHE_TTL_MS', 10 * 60 * 1000),
      tokenCacheTtlSafetyMs: getIntEnv('EBAY_TOKEN_CACHE_TTL_SAFETY_MS', 15 * 60 * 1000),
      userAgent: getEnv('EBAY_USER_AGENT', 'tcds-arb-system/1.0'),
      browseSearchLimitDefault: getIntEnv('EBAY_BROWSE_LIMIT_DEFAULT', 50),
      browseSearchLimitMax: getIntEnv('EBAY_BROWSE_LIMIT_MAX', 200),
      taxonomyCategoryTreeId: getEnv('EBAY_TAXONOMY_CATEGORY_TREE_ID', '0'),
      detailFieldgroups: getCsvEnv('EBAY_ITEM_DETAIL_FIELDGROUPS', ['PRODUCT']),
      ...input.config,
    };

    this.logger =
      input.logger ??
      createLogger({
        serviceName: 'arb-system-api',
        staticBindings: {
          component: 'ebayClient',
          environment: this.config.environment,
        },
      });

    this.cache =
      input.cache ??
      new MemoryTtlCache({
        logger: this.logger,
        name: `ebay-client-cache:${this.config.environment}`,
        maxEntries: 10_000,
        sweepIntervalMs: 60_000,
      });

    this.limiter = new RateLimiter({
      name: `ebay-http-limiter:${this.config.environment}`,
      maxConcurrent: this.config.maxConcurrentRequests,
      minTimeMs: this.config.minRequestIntervalMs,
      maxQueueSize: 2_000,
      logger: this.logger,
    });
  }

  async searchSoldItems(params: BrowseSearchParams): Promise<BrowseSearchResult> {
    return this.searchBrowseItems('sold', params);
  }

  async searchActiveItems(params: BrowseSearchParams): Promise<BrowseSearchResult> {
    return this.searchBrowseItems('active', params);
  }

  async getItemByLegacyId(
    legacyItemId: string,
    params: ItemDetailParams = {},
  ): Promise<DetailedEbayItem> {
    if (!legacyItemId?.trim()) {
      throw new EbayClientError({
        message: 'legacyItemId is required',
        retryable: false,
        classification: 'CLIENT',
      });
    }

    const fieldgroups = params.includeProduct ? this.config.detailFieldgroups : [];
    const response = await this.request<Record<string, unknown>>({
      method: 'GET',
      path: '/buy/browse/v1/item/get_item_by_legacy_id',
      query: {
        legacy_item_id: legacyItemId.trim(),
        ...(fieldgroups.length > 0 ? { fieldgroups: fieldgroups.join(',') } : {}),
      },
      correlationId: params.correlationId,
      requiredScopes: params.requiredScopes ?? [],
      marketplaceId: params.marketplaceId ?? this.config.marketplaceId,
    });

    return normalizeDetailedItem(response);
  }

  async getItemsByItemGroup(
    itemGroupId: string,
    params: ItemDetailParams = {},
  ): Promise<DetailedEbayItem[]> {
    if (!itemGroupId?.trim()) {
      throw new EbayClientError({
        message: 'itemGroupId is required',
        retryable: false,
        classification: 'CLIENT',
      });
    }

    const response = await this.request<{ items?: Array<Record<string, unknown>> }>({
      method: 'GET',
      path: '/buy/browse/v1/item/get_items_by_item_group',
      query: { item_group_id: itemGroupId.trim() },
      correlationId: params.correlationId,
      requiredScopes: params.requiredScopes ?? [],
      marketplaceId: params.marketplaceId ?? this.config.marketplaceId,
    });

    const items = Array.isArray(response.items) ? response.items : [];
    return items.map((raw) => normalizeDetailedItem(raw));
  }

  async getItem(
    itemId: string,
    params: ItemDetailParams = {},
  ): Promise<DetailedEbayItem> {
    if (!itemId?.trim()) {
      throw new EbayClientError({
        message: 'itemId is required',
        retryable: false,
        classification: 'CLIENT',
      });
    }

    const fieldgroups = params.includeProduct ? this.config.detailFieldgroups : [];
    const response = await this.request<Record<string, unknown>>({
      method: 'GET',
      path: `/buy/browse/v1/item/${encodeURIComponent(itemId.trim())}`,
      query: fieldgroups.length > 0 ? { fieldgroups: fieldgroups.join(',') } : undefined,
      correlationId: params.correlationId,
      requiredScopes: params.requiredScopes ?? [],
      marketplaceId: params.marketplaceId ?? this.config.marketplaceId,
    });

    return normalizeDetailedItem(response);
  }

  async searchCatalogProducts(params: CatalogSearchParams): Promise<CatalogProductSummary[]> {
    const query: Record<string, string | number | boolean | undefined> = {
      q: params.q ? (normalizeWhitespace(params.q) || undefined) : undefined,
      gtin: params.gtin?.trim(),
      mpn: params.mpn?.trim(),
      category_ids: params.categoryIds?.length ? params.categoryIds.join(',') : undefined,
      limit: clamp(params.limit ?? 10, 1, 200),
      offset: Math.max(0, params.offset ?? 0),
    };

    if (!query.q && !query.gtin) return [];

    if (params.brand?.trim()) {
      query.filter = `brand:{${params.brand.trim()}}`;
    }

    let response: Record<string, unknown>;
    try {
      response = await this.request<Record<string, unknown>>({
        method: 'GET',
        path: '/commerce/catalog/v1_beta/product_summary/search',
        query,
        correlationId: params.correlationId,
        requiredScopes: params.requiredScopes ?? [],
        marketplaceId: params.marketplaceId ?? this.config.marketplaceId,
      });
    } catch (err: any) {
      if (err?.name === 'EbayClientError' && err?.status === 400) return [];
      throw err;
    }

    const summaries = Array.isArray((response as any).productSummaries)
      ? (response as any).productSummaries
      : [];

    return summaries
      .map((value: unknown) => normalizeCatalogProductSummary(value))
      .filter((value: CatalogProductSummary | null): value is CatalogProductSummary => value !== null);
  }
  async getCatalogProduct(
    epid: string,
    params: { correlationId?: string; requiredScopes?: string[]; marketplaceId?: string } = {},
  ): Promise<CatalogProductDetail> {
    if (!epid?.trim()) {
      throw new EbayClientError({
        message: 'epid is required',
        retryable: false,
        classification: 'CLIENT',
      });
    }

    const response = await this.request<Record<string, unknown>>({
      method: 'GET',
      path: `/commerce/catalog/v1_beta/product/${encodeURIComponent(epid.trim())}`,
      correlationId: params.correlationId,
      requiredScopes: params.requiredScopes ?? [],
      marketplaceId: params.marketplaceId ?? this.config.marketplaceId,
    });

    return normalizeCatalogProductDetail(response);
  }

  async getItemAspectsForCategory(
    categoryId: string,
    params: { categoryTreeId?: string; correlationId?: string; requiredScopes?: string[]; marketplaceId?: string } = {},
  ): Promise<TaxonomyAspectResponse> {
    if (!categoryId?.trim()) {
      throw new EbayClientError({
        message: 'categoryId is required',
        retryable: false,
        classification: 'CLIENT',
      });
    }

    const categoryTreeId = params.categoryTreeId ?? this.config.taxonomyCategoryTreeId;
    const response = await this.request<Record<string, unknown>>({
      method: 'GET',
      path: `/commerce/taxonomy/v1/category_tree/${encodeURIComponent(categoryTreeId)}/get_item_aspects_for_category`,
      query: { category_id: categoryId.trim() },
      correlationId: params.correlationId,
      requiredScopes: params.requiredScopes ?? [],
      marketplaceId: params.marketplaceId ?? this.config.marketplaceId,
    });

    return normalizeTaxonomyAspectResponse(response, categoryTreeId, categoryId.trim());
  }

  async request<T = unknown>(params: EbayRequestParams): Promise<T> {
    const requestId = crypto.randomUUID();
    const correlationId = params.correlationId ?? crypto.randomUUID();

    const token = await this.getUsableToken({
      requestId,
      correlationId,
      requiredScopes: params.requiredScopes ?? [],
    });

    const config = getEbayConfig(this.config.environment);
    const url = buildUrl(config.baseUrl, params.path, params.query);
    const method = params.method ?? 'GET';

    return withRetry(
      async (attempt) => {
        return this.limiter.schedule(async () => {
          this.logger.debug('ebay request starting', {
            requestId,
            correlationId,
            operation: 'request',
            method,
            path: params.path,
            attempt,
            environment: this.config.environment,
          });

          return this.fetchJson<T>(url, {
            method,
            headers: {
              Authorization: `Bearer ${token.accessToken}`,
              Accept: 'application/json',
              'Content-Type': 'application/json',
              'User-Agent': this.config.userAgent,
              ...(params.marketplaceId || this.config.marketplaceId
                ? {
                    'X-EBAY-C-MARKETPLACE-ID':
                      params.marketplaceId ?? this.config.marketplaceId,
                  }
                : {}),
              ...(params.headers ?? {}),
            },
            body: params.body !== undefined ? JSON.stringify(params.body) : undefined,
            timeoutMs: this.config.requestTimeoutMs,
            requestId,
            correlationId,
            operation: `request:${method}:${params.path}`,
          });
        });
      },
      {
        operation: `request:${method}:${params.path}`,
        logger: this.logger,
        maxRetries: this.config.maxRetries,
        baseDelayMs: this.config.baseBackoffMs,
        maxDelayMs: this.config.maxBackoffMs,
        requestId,
        correlationId,
        shouldRetry: (error) => this.shouldRetry(error),
      },
    );
  }

  async invalidateBrowseCache(signalKey: string): Promise<void> {
    await this.cache.delete(`ebay:browse:${signalKey}`);
  }

  async getHealthSnapshot(): Promise<Record<string, unknown>> {
    return {
      environment: this.config.environment,
      marketplaceId: this.config.marketplaceId,
      rateLimiter: this.limiter.getStats(),
      cache: this.cache.getStats(),
    };
  }

  private async searchBrowseItems(
    mode: BrowseSearchMode,
    params: BrowseSearchParams,
  ): Promise<BrowseSearchResult> {
    const requestId = crypto.randomUUID();
    const correlationId = params.correlationId ?? crypto.randomUUID();
    const limit = clamp(
      params.limit ?? this.config.browseSearchLimitDefault,
      1,
      this.config.browseSearchLimitMax,
    );
    const offset = Math.max(0, params.offset ?? 0);

    const cacheKey = buildBrowseCacheKey(mode, {
      ...params,
      limit,
      offset,
    });
    const cacheTtlMs = params.cacheTtlMs ?? this.config.defaultCacheTtlMs;

    const cached = await this.cache.get<BrowseSearchResult>(cacheKey);
    if (cached) {
      return {
        ...cached,
        requestId,
        cacheHit: true,
      };
    }

    const filters = [...(params.additionalFilters ?? [])];
    if (mode === 'sold') {
      filters.unshift('soldItemsOnly:true');
    } else {
      filters.unshift('buyingOptions:{FIXED_PRICE}');
    }

    const query: Record<string, string | number | boolean | undefined> = {
      limit,
      offset,
      q: params.query ? normalizeWhitespace(params.query) : undefined,
      gtin: params.gtin?.trim(),
      epid: params.epid?.trim(),
      category_ids: params.categoryIds?.length ? params.categoryIds.join(',') : undefined,
      fieldgroups: params.fieldgroups?.length ? params.fieldgroups.join(',') : undefined,
      compatibility_filter: params.compatibilityFilter,
      aspect_filter: params.aspectFilter,
      filter: filters.length ? filters.join(',') : undefined,
    };

    if (!query.q && !query.gtin && !query.epid) {
      throw new EbayClientError({
        message: 'Browse search requires q, gtin, or epid',
        retryable: false,
        classification: 'CLIENT',
      });
    }

    const response = await this.request<BrowseSearchApiResponse>({
      method: 'GET',
      path: '/buy/browse/v1/item_summary/search',
      query,
      correlationId,
      requiredScopes: params.requiredScopes ?? [],
      marketplaceId: params.marketplaceId ?? this.config.marketplaceId,
    });

    const normalized = normalizeBrowseSearchResult(mode, response, requestId);
    await this.cache.set(cacheKey, normalized, cacheTtlMs);

    return normalized;
  }

  private async getUsableToken(input: {
    requestId: string;
    correlationId: string;
    requiredScopes: string[];
  }): Promise<TokenState> {
    const tokenCacheKey = `ebay:user-token:${this.config.environment}`;
    const safetyMs = this.config.tokenCacheTtlSafetyMs;
    const now = Date.now();

    const cached = await this.cache.get<TokenState>(tokenCacheKey);
    if (cached && now < cached.expiresAtEpochMs - safetyMs) {
      if (input.requiredScopes.length > 0) {
        ensureScopesPresent(cached.scope ?? '', input.requiredScopes);
      }
      return cached;
    }

    const latest = await getLatestActiveToken(this.config.environment);
    if (!latest) {
      throw new EbayClientError({
        message: `No active eBay token found for ${this.config.environment}`,
        retryable: false,
        classification: 'TOKEN',
        requestId: input.requestId,
      });
    }

    if (input.requiredScopes.length > 0) {
      try {
        ensureScopesPresent(latest.scope ?? '', input.requiredScopes);
      } catch (error) {
        throw new EbayClientError({
          message: error instanceof Error ? error.message : 'Required eBay scopes missing',
          retryable: false,
          classification: 'SCOPE',
          requestId: input.requestId,
          cause: error,
        });
      }
    }

    try {
      const usable = await this.refreshTokenIfNeeded(latest, input);
      const tokenState = toTokenState(usable);
      const ttlMs = Math.max(1_000, tokenState.expiresAtEpochMs - Date.now() - safetyMs);
      await this.cache.set(tokenCacheKey, tokenState, ttlMs);
      return tokenState;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await setTokenError(latest.id, message);
      if (error instanceof EbayClientError) throw error;

      throw new EbayClientError({
        message,
        retryable: false,
        classification: 'TOKEN',
        requestId: input.requestId,
        cause: error,
      });
    }
  }

  private async refreshTokenIfNeeded(
    token: StoredEbayToken,
    input: { requestId: string; correlationId: string },
  ): Promise<StoredEbayToken> {
    const expiresAt = new Date(token.access_expires_at).getTime();
    const needsRefresh = expiresAt - Date.now() < this.config.tokenCacheTtlSafetyMs;
    if (!needsRefresh) return token;

    const lockKey = `${this.config.environment}:${token.id}`;
    const existing = refreshInFlight.get(lockKey);
    if (existing) return existing;

    const refreshPromise = withRetry(
      async () => {
        return this.limiter.schedule(async () => {
          if (!token.refresh_token) {
            throw new EbayClientError({
              message: `No refresh token available for ${this.config.environment}`,
              retryable: false,
              classification: 'TOKEN',
              requestId: input.requestId,
            });
          }

          const refreshed = await refreshAccessToken(this.config.environment, token.refresh_token);

          await updateTokenById(token.id, {
            accessToken: refreshed.access_token,
            refreshToken: refreshed.refresh_token,
            scope: refreshed.scope,
            accessExpiresIn: refreshed.expires_in,
            refreshExpiresIn: refreshed.refresh_token_expires_in,
          });

          const updated = await getLatestActiveToken(this.config.environment);
          if (!updated) {
            throw new EbayClientError({
              message: `Unable to reload refreshed token for ${this.config.environment}`,
              retryable: false,
              classification: 'TOKEN',
              requestId: input.requestId,
            });
          }

          return updated;
        });
      },
      {
        operation: 'refresh-user-token',
        logger: this.logger,
        maxRetries: this.config.maxRetries,
        baseDelayMs: this.config.baseBackoffMs,
        maxDelayMs: this.config.maxBackoffMs,
        requestId: input.requestId,
        correlationId: input.correlationId,
        shouldRetry: (error) => this.shouldRetry(error),
      },
    );

    refreshInFlight.set(lockKey, refreshPromise);
    try {
      return await refreshPromise;
    } finally {
      refreshInFlight.delete(lockKey);
    }
  }

  private async fetchJson<T>(
    url: string,
    input: {
      method: HttpMethod;
      headers: Record<string, string>;
      body?: string;
      timeoutMs: number;
      requestId: string;
      correlationId: string;
      operation: string;
    },
  ): Promise<T> {
    const response = await this.fetchWithTimeout(
      url,
      {
        method: input.method,
        headers: input.headers,
        body: input.body,
      },
      input.timeoutMs,
    );

    const textBody = await safeReadText(response);
    if (!response.ok) {
      throw buildHttpError({
        status: response.status,
        bodyText: textBody,
        requestId: input.requestId,
        operation: input.operation,
        url,
        retryAfterHeader: response.headers.get('retry-after'),
      });
    }

    if (!textBody) {
      return undefined as T;
    }

    try {
      return JSON.parse(textBody) as T;
    } catch {
      return textBody as T;
    }
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (error: unknown) {
      if (isAbortError(error)) {
        throw new EbayClientError({
          message: `Request timeout after ${timeoutMs}ms`,
          retryable: true,
          classification: 'TIMEOUT',
          cause: error,
        });
      }

      throw new EbayClientError({
        message: `Network error while calling eBay: ${extractErrorMessage(error)}`,
        retryable: true,
        classification: 'NETWORK',
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private shouldRetry(error: unknown): boolean {
    return error instanceof EbayClientError ? error.retryable : false;
  }
}

export function createEbayClient(input: CreateEbayClientInput = {}): EbayClient {
  return new EbayClient(input);
}

function normalizeBrowseSearchResult(
  mode: BrowseSearchMode,
  raw: BrowseSearchApiResponse,
  requestId: string,
): BrowseSearchResult {
  const itemSummaries = (Array.isArray(raw.itemSummaries) ? raw.itemSummaries : [])
    .map((item) => normalizeBrowseItem(item))
    .filter((item): item is NormalizedBrowseItem => item !== null);

  return {
    mode,
    total: parseInteger(raw.total) ?? itemSummaries.length,
    itemSummaries,
    href: raw.href ? String(raw.href) : undefined,
    next: raw.next ? String(raw.next) : undefined,
    limit: parseInteger(raw.limit) ?? itemSummaries.length,
    offset: parseInteger(raw.offset) ?? 0,
    cacheHit: false,
    requestId,
    fetchedAt: new Date().toISOString(),
  };
}

function normalizeBrowseItem(raw: unknown): NormalizedBrowseItem | null {
  const item = asRecord(raw);
  if (!item) return null;

  const itemId = asOptionalString(item.itemId);
  const title = asOptionalString(item.title);
  if (!itemId || !title) return null;

  const price = asRecord(item.price);
  const seller = asRecord(item.seller);
  const image = asRecord(item.image);
  const itemLocation = asRecord(item.itemLocation);
  const shippingOptions = Array.isArray(item.shippingOptions) ? item.shippingOptions : [];
  const firstShippingOption = asRecord(shippingOptions[0]);
  const shippingCost = asRecord(firstShippingOption?.shippingCost);
  const categories = normalizeCategories(item.categories);
  const localizedAspects = normalizeLocalizedAspects(item.localizedAspects);
  const brand = asOptionalString(item.brand) ?? getAspectValue(localizedAspects, ['Brand']);
  const mpn = asOptionalString(item.mpn) ?? getAspectValue(localizedAspects, ['MPN', 'Model Number']);
  const gtin = asOptionalString(item.gtin);

  const priceValue = parseNullableNumber(price?.value);
  const shippingValue = parseNullableNumber(shippingCost?.value);

  return {
    itemId,
    legacyItemId: asOptionalString(item.legacyItemId),
    title,
    subtitle: asOptionalString(item.subtitle),
    shortDescription: asOptionalString(item.shortDescription),
    priceValue,
    priceCurrency: asOptionalString(price?.currency) ?? null,
    itemWebUrl: asOptionalString(item.itemWebUrl),
    itemLocationCountry: asOptionalString(itemLocation?.country),
    itemLocationState: asOptionalString(itemLocation?.stateOrProvince),
    condition: asOptionalString(item.condition),
    conditionId: asOptionalString(item.conditionId),
    conditionText:
      asOptionalString(item.condition) ??
      asOptionalString(item.conditionDisplayName) ??
      asOptionalString(item.conditionText),
    buyingOptions: Array.isArray(item.buyingOptions) ? item.buyingOptions.map(String) : [],
    categories,
    categoryId: asOptionalString(item.categoryId) ?? categories[0]?.categoryId,
    categoryPath: buildCategoryPath(categories),
    seller: seller
      ? {
          username: asOptionalString(seller.username),
          feedbackPercentage: asOptionalString(seller.feedbackPercentage),
          feedbackScore: parseInteger(seller.feedbackScore),
        }
      : undefined,
    imageUrl: asOptionalString(image?.imageUrl),
    additionalImages: normalizeAdditionalImageUrls(item.additionalImages),
    itemCreationDate: asOptionalString(item.itemCreationDate),
    itemEndDate: asOptionalString(item.itemEndDate),
    bidCount: parseInteger(item.bidCount),
    shippingCostValue: shippingValue,
    shippingCostCurrency: asOptionalString(shippingCost?.currency) ?? null,
    totalPriceValue:
      priceValue !== null || shippingValue !== null ? (priceValue ?? 0) + (shippingValue ?? 0) : null,
    brand,
    mpn,
    gtin,
    localizedAspects,
    epid: asOptionalString(item.epid),
    raw,
  };
}

function normalizeDetailedItem(raw: unknown): DetailedEbayItem {
  const item = asRecord(raw);
  if (!item) {
    throw new EbayClientError({
      message: 'Invalid eBay item detail payload',
      retryable: false,
      classification: 'INVALID_RESPONSE',
    });
  }

  const browse = normalizeBrowseItem(raw);
  if (!browse) {
    throw new EbayClientError({
      message: 'Unable to normalize eBay item detail payload',
      retryable: false,
      classification: 'INVALID_RESPONSE',
    });
  }

  const localizedAspects = normalizeLocalizedAspects(item.localizedAspects);
  const product = (() => {
    if (!item.product) return undefined;
    try { return normalizeCatalogProductDetail(item.product); } catch { return undefined; }
  })();
  const seller = asRecord(item.seller);
  const price = asRecord(item.price);
  const shippingOptions = Array.isArray(item.shippingOptions) ? item.shippingOptions : [];
  const firstShippingOption = asRecord(shippingOptions[0]);
  const shippingCost = asRecord(firstShippingOption?.shippingCost);
  const itemLocation = asRecord(item.itemLocation);

  return {
    itemId: browse.itemId,
    legacyItemId: browse.legacyItemId,
    title: browse.title,
    subtitle: browse.subtitle,
    shortDescription: browse.shortDescription,
    description: asOptionalString(item.description),
    brand: browse.brand,
    mpn: browse.mpn,
    gtins: uniqueStrings([
      ...(browse.gtin ? [browse.gtin] : []),
      ...collectStringArray(item, ['gtin', 'upc', 'ean', 'isbn']),
      ...(product?.gtins ?? []),
    ]),
    epid: browse.epid ?? product?.epid,
    categoryId: browse.categoryId,
    categoryPath: browse.categoryPath,
    categoryTreeId: asOptionalString(item.categoryTreeId),
    condition: browse.condition,
    conditionId: browse.conditionId,
    buyingOptions: browse.buyingOptions,
    itemWebUrl: browse.itemWebUrl,
    priceValue: parseNullableNumber(price?.value) ?? browse.priceValue,
    priceCurrency: asOptionalString(price?.currency) ?? browse.priceCurrency,
    shippingValue: parseNullableNumber(shippingCost?.value) ?? browse.shippingCostValue ?? null,
    shippingCurrency: asOptionalString(shippingCost?.currency) ?? browse.shippingCostCurrency ?? null,
    totalPriceValue: browse.totalPriceValue ?? null,
    sellerUsername: browse.seller?.username ?? asOptionalString(seller?.username),
    sellerFeedbackScore: browse.seller?.feedbackScore ?? parseInteger(seller?.feedbackScore),
    sellerFeedbackPercentage: browse.seller?.feedbackPercentage ?? asOptionalString(seller?.feedbackPercentage),
    imageUrl: browse.imageUrl,
    additionalImages: uniqueStrings([
      ...(browse.additionalImages ?? []),
      ...normalizeAdditionalImageUrls(item.additionalImages),
    ]),
    itemCreationDate: browse.itemCreationDate,
    itemEndDate: browse.itemEndDate,
    itemLocationCountry: browse.itemLocationCountry ?? asOptionalString(itemLocation?.country),
    itemLocationState: browse.itemLocationState ?? asOptionalString(itemLocation?.stateOrProvince),
    localizedAspects,
    product,
    raw,
  };
}

function normalizeCatalogProductSummary(raw: unknown): CatalogProductSummary | null {
  const product = asRecord(raw);
  if (!product) return null;

  const epid = asOptionalString(product.epid);
  if (!epid) return null;

  return {
    epid,
    title: asOptionalString(product.title),
    brand: asOptionalString(product.brand),
    mpns: collectStringArray(product, ['mpn']),
    gtins: uniqueStrings([
      ...collectStringArray(product, ['gtin', 'upc', 'ean', 'isbn']),
      ...collectStringArray(product, ['productIdentifier']),
    ]),
    productHref: asOptionalString(product.productHref),
    imageUrls: normalizeAdditionalImageUrls(product.image ? [product.image] : product.images),
    aspects: normalizeLocalizedAspects(product.aspects),
    raw,
  };
}

function normalizeCatalogProductDetail(raw: unknown): CatalogProductDetail {
  const product = asRecord(raw);
  if (!product) {
    throw new EbayClientError({
      message: 'Invalid eBay catalog product payload',
      retryable: false,
      classification: 'INVALID_RESPONSE',
    });
  }

  const epid = asOptionalString(product.epid);
  if (!epid) {
    throw new EbayClientError({
      message: 'Catalog product payload missing ePID',
      retryable: false,
      classification: 'INVALID_RESPONSE',
    });
  }

  return {
    epid,
    title: asOptionalString(product.title),
    description: asOptionalString(product.description),
    brand: asOptionalString(product.brand),
    mpns: collectStringArray(product, ['mpn']),
    gtins: uniqueStrings([
      ...collectStringArray(product, ['gtin', 'upc', 'ean', 'isbn']),
    ]),
    primaryCategoryId: asOptionalString(product.primaryCategoryId),
    categoryIds: uniqueStrings([
      ...(asOptionalString(product.primaryCategoryId) ? [asOptionalString(product.primaryCategoryId)!] : []),
      ...collectStringArray(product, ['otherApplicableCategoryIds']),
    ]),
    imageUrls: normalizeAdditionalImageUrls(product.additionalImages ?? product.images),
    aspects: normalizeLocalizedAspects(product.aspects ?? product.aspectGroups),
    raw,
  };
}

function normalizeTaxonomyAspectResponse(
  raw: unknown,
  categoryTreeId: string,
  categoryId: string,
): TaxonomyAspectResponse {
  const obj = asRecord(raw) ?? {};
  const aspects = Array.isArray(obj.aspects) ? obj.aspects : [];
  return {
    categoryTreeId: asOptionalString(obj.categoryTreeId) ?? categoryTreeId,
    categoryId: asOptionalString(obj.categoryId) ?? categoryId,
    aspects: aspects
      .map((aspect) => normalizeTaxonomyAspectMetadata(aspect))
      .filter((value): value is TaxonomyAspectMetadata => value !== null),
    raw,
  };
}

function normalizeTaxonomyAspectMetadata(raw: unknown): TaxonomyAspectMetadata | null {
  const aspect = asRecord(raw);
  if (!aspect) return null;

  const localizedAspectName = asOptionalString(aspect.localizedAspectName);
  if (!localizedAspectName) return null;

  const aspectValues = Array.isArray(aspect.aspectValues) ? aspect.aspectValues : [];
  return {
    localizedAspectName,
    aspectRequired: Boolean(aspect.aspectConstraint && asRecord(aspect.aspectConstraint)?.aspectRequired === true),
    aspectUsage: asOptionalString(aspect.aspectConstraint && asRecord(aspect.aspectConstraint)?.aspectUsage),
    itemToAspectCardinality: asOptionalString(aspect.aspectConstraint && asRecord(aspect.aspectConstraint)?.itemToAspectCardinality),
    aspectMode: asOptionalString(aspect.aspectMode),
    values: aspectValues
      .flatMap((value) => {
        const item = asRecord(value);
        if (!item) return [];
        const v = asOptionalString(item.localizedValue) ?? asOptionalString(item.value);
        if (!v) return [];
        return [{
          value: asOptionalString(item.value) ?? v,
          localizedValue: asOptionalString(item.localizedValue),
        }];
      }),
  };
}

function normalizeCategories(raw: unknown): NormalizedBrowseCategory[] {
  return Array.isArray(raw)
    ? raw.flatMap((category) => {
        const c = asRecord(category);
        if (!c) return [];
        return [{
          categoryId: asOptionalString(c.categoryId),
          categoryName: asOptionalString(c.categoryName),
        }];
      })
    : [];
}

function normalizeLocalizedAspects(raw: unknown): NormalizedLocalizedAspect[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((aspect) => {
      const record = asRecord(aspect);
      if (!record) return null;

      const name =
        asOptionalString(record.name) ??
        asOptionalString(record.localizedName) ??
        asOptionalString(record.localizedAspectName);
      if (!name) return null;

      const rawValues =
        Array.isArray(record.values) ? record.values :
        Array.isArray(record.value) ? record.value :
        typeof record.value === 'string' ? [record.value] :
        Array.isArray(record.aspectValues) ? record.aspectValues : [];

      const values = rawValues
        .map((entry) => {
          if (typeof entry === 'string') return entry.trim();
          const r = asRecord(entry);
          return r
            ? (asOptionalString(r.localizedValue) ?? asOptionalString(r.value) ?? '').trim()
            : '';
        })
        .filter((value) => value.length > 0);

      return {
        name,
        values: uniqueStrings(values),
      };
    })
    .filter((value): value is NormalizedLocalizedAspect => value !== null);
}

function buildCategoryPath(categories: NormalizedBrowseCategory[]): string | undefined {
  const names = categories
    .map((category) => category.categoryName?.trim())
    .filter((value): value is string => Boolean(value && value.length > 0));

  return names.length > 0 ? names.join(' > ') : undefined;
}

function getAspectValue(
  aspects: NormalizedLocalizedAspect[] | undefined,
  names: string[],
): string | undefined {
  if (!aspects?.length) return undefined;
  const lower = new Set(names.map((value) => value.toLowerCase()));
  for (const aspect of aspects) {
    if (lower.has(aspect.name.toLowerCase()) && aspect.values.length > 0) {
      return aspect.values[0];
    }
  }
  return undefined;
}

function collectStringArray(obj: Record<string, unknown>, keys: string[]): string[] {
  const values: string[] = [];
  for (const key of keys) {
    const value = obj[key];
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === 'string' && entry.trim()) values.push(entry.trim());
      }
    } else if (typeof value === 'string' && value.trim()) {
      values.push(value.trim());
    }
  }
  return uniqueStrings(values);
}

function normalizeAdditionalImageUrls(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return uniqueStrings(
    raw
      .map((item) => {
        if (typeof item === 'string') return item.trim();
        const image = asRecord(item);
        return image ? asOptionalString(image.imageUrl) ?? '' : '';
      })
      .filter((value) => value.length > 0),
  );
}

function buildBrowseCacheKey(
  mode: BrowseSearchMode,
  params: BrowseSearchParams,
): string {
  if (params.signalKey?.trim()) {
    return `ebay:browse:${params.signalKey.trim()}`;
  }

  const canonical = {
    environment: getEnv('EBAY_ENVIRONMENT', 'production'),
    mode,
    q: params.query ? normalizeWhitespace(params.query).toLowerCase() : null,
    gtin: params.gtin?.trim() ?? null,
    epid: params.epid?.trim() ?? null,
    limit: params.limit ?? null,
    offset: params.offset ?? null,
    categoryIds: [...(params.categoryIds ?? [])].sort(),
    fieldgroups: [...(params.fieldgroups ?? [])].sort(),
    compatibilityFilter: params.compatibilityFilter ?? null,
    aspectFilter: params.aspectFilter ?? null,
    additionalFilters: [...(params.additionalFilters ?? [])].sort(),
  };

  return `ebay:browse:${crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex')}`;
}

function buildUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
): string {
  const url = new URL(path, baseUrl);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

function buildHttpError(input: {
  status: number;
  bodyText: string;
  requestId: string;
  operation: string;
  url: string;
  retryAfterHeader?: string | null;
}): EbayClientError {
  const bodySnippet = truncate(input.bodyText, 1200);
  const retryAfterMs = parseRetryAfterMs(input.retryAfterHeader);

  if (input.status === 401 || input.status === 403) {
    return new EbayClientError({
      message: `eBay auth failure (${input.status}) for ${input.operation}`,
      status: input.status,
      retryable: false,
      classification: 'AUTH',
      requestId: input.requestId,
      bodySnippet,
    });
  }

  if (input.status === 429) {
    return new EbayClientError({
      message: `eBay throttled request (${input.status}) for ${input.operation}`,
      status: input.status,
      retryable: true,
      classification: 'THROTTLED',
      requestId: input.requestId,
      bodySnippet,
      retryAfterMs,
    });
  }

  if (input.status >= 500) {
    return new EbayClientError({
      message: `eBay server error (${input.status}) for ${input.operation}`,
      status: input.status,
      retryable: true,
      classification: 'SERVER',
      requestId: input.requestId,
      bodySnippet,
    });
  }

    // Detect item_group listings — eBay returns errorId 11006 on legacy_id lookup
  if (input.status === 400 && input.bodyText) {
    try {
      const parsed = JSON.parse(input.bodyText) as {
        errors?: Array<{
          errorId?: number;
          parameters?: Array<{ name?: string; value?: string }>;
        }>;
      };
      const errorId = parsed.errors?.[0]?.errorId;
      if (errorId === 11006) {
  // eBay returns the group ID inside an itemGroupHref URL parameter, not as a direct value
  const params = parsed.errors?.[0]?.parameters ?? [];
  const directId = params.find((p) => p?.name === 'item_group_id')?.value;
  const hrefValue = params.find((p) => p?.name === 'itemGroupHref')?.value;
  const hrefId = hrefValue?.match(/item_group_id=(\d+)/)?.[1];
  const itemGroupId = directId ?? hrefId;

  return new EbayClientError({
    message: `eBay item_group listing (errorId=11006${itemGroupId ? `, groupId=${itemGroupId}` : ''}) for ${input.operation}`,
          status: input.status,
          retryable: false,
          classification: 'ITEM_GROUP',
          requestId: input.requestId,
          bodySnippet,
        });
      }
    } catch {
      // fall through to default CLIENT error
    }
  }

  return new EbayClientError({
    message: `eBay client error (${input.status}) for ${input.operation}`,
    status: input.status,
    retryable: false,
    classification: 'CLIENT',
    requestId: input.requestId,
    bodySnippet,
  });
}

function parseRetryAfterMs(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const dateValue = Date.parse(value);
  if (Number.isFinite(dateValue)) {
    const diff = dateValue - Date.now();
    return diff > 0 ? diff : undefined;
  }
  return undefined;
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.message.toLowerCase().includes('abort'));
}

function toTokenState(token: StoredEbayToken): TokenState {
  return {
    tokenId: token.id,
    accessToken: token.access_token,
    tokenType: token.token_type ?? null,
    expiresAtEpochMs: new Date(token.access_expires_at).getTime(),
    scope: token.scope ?? null,
    refreshToken: token.refresh_token ?? null,
  };
}

function parseNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseInteger(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}…`;
}

function extractErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getEnv(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function getIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getCsvEnv(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (!raw?.trim()) return fallback;
  return raw.split(',').map((value) => value.trim()).filter((value) => value.length > 0);
}

function getEnumEnv<T extends string>(
  name: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const raw = process.env[name]?.trim() as T | undefined;
  if (!raw) return fallback;
  return allowed.includes(raw) ? raw : fallback;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
