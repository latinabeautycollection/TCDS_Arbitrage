import { Logger } from './logger';

export interface CacheEntry<T> {
  value: T;
  expiresAtEpochMs: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  evictions: number;
  size: number;
}

export interface Cache {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  getStats(): CacheStats;
}

export interface MemoryCacheOptions {
  maxEntries?: number;
  sweepIntervalMs?: number;
  logger?: Logger;
  name?: string;
}

export class MemoryTtlCache implements Cache {
  private readonly store = new Map<string, CacheEntry<unknown>>();
  private readonly logger?: Logger;
  private readonly maxEntries: number;
  private readonly name: string;
  private readonly sweepTimer: NodeJS.Timeout;
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    evictions: 0,
    size: 0,
  };

  constructor(options: MemoryCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? 5000;
    this.logger = options.logger;
    this.name = options.name ?? 'memory-ttl-cache';

    const sweepIntervalMs = options.sweepIntervalMs ?? 60_000;
    this.sweepTimer = setInterval(() => {
      this.evictExpiredEntries();
    }, sweepIntervalMs);

    this.sweepTimer.unref();
  }

  async get<T>(key: string): Promise<T | undefined> {
    const hit = this.store.get(key);

    if (!hit) {
      this.stats.misses += 1;
      return undefined;
    }

    if (Date.now() >= hit.expiresAtEpochMs) {
      this.store.delete(key);
      this.stats.misses += 1;
      this.stats.evictions += 1;
      this.syncSize();
      return undefined;
    }

    this.stats.hits += 1;
    return hit.value as T;
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new Error(`Invalid cache ttlMs for key "${key}"`);
    }

    if (this.store.size >= this.maxEntries && !this.store.has(key)) {
      this.evictOneOldestEntry();
    }

    this.store.set(key, {
      value,
      expiresAtEpochMs: Date.now() + ttlMs,
    });

    this.stats.sets += 1;
    this.syncSize();
  }

  async delete(key: string): Promise<void> {
    if (this.store.delete(key)) {
      this.stats.deletes += 1;
      this.syncSize();
    }
  }

  async clear(): Promise<void> {
    this.store.clear();
    this.syncSize();
  }

  getStats(): CacheStats {
    return {
      ...this.stats,
      size: this.store.size,
    };
  }

  private evictExpiredEntries(): void {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.store.entries()) {
      if (now >= entry.expiresAtEpochMs) {
        this.store.delete(key);
        removed += 1;
      }
    }

    if (removed > 0) {
      this.stats.evictions += removed;
      this.syncSize();

      this.logger?.debug('cache sweep evicted expired entries', {
        component: 'cache',
        cacheName: this.name,
        evictedCount: removed,
        cacheSize: this.store.size,
      });
    }
  }

  private evictOneOldestEntry(): void {
    const oldestKey = this.store.keys().next().value;
    if (!oldestKey) return;

    this.store.delete(oldestKey);
    this.stats.evictions += 1;
    this.syncSize();
  }

  private syncSize(): void {
    this.stats.size = this.store.size;
  }
}
