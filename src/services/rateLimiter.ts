import { Logger } from './logger';

export interface RateLimiterStats {
  queued: number;
  active: number;
  executed: number;
  rejected: number;
  delayed: number;
  cooledDown: number;
  timedOut: number;
  cancelled: number;
  maxObservedQueueDepth: number;
  lastRunAt: number | null;
  cooldownUntil: number | null;
}

export interface RateLimiterOptions {
  name?: string;
  maxConcurrent: number;
  minTimeMs: number;
  maxQueueSize?: number;
  defaultTaskTimeoutMs?: number;
  jitterMs?: number;
  logger?: Logger;
}

export interface ScheduleOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  label?: string;
}

export class RateLimiterOverflowError extends Error {
  public readonly limiterName: string;

  constructor(limiterName: string) {
    super(`RateLimiter queue overflow for ${limiterName}`);
    this.name = 'RateLimiterOverflowError';
    this.limiterName = limiterName;
  }
}

export class RateLimiterTimeoutError extends Error {
  public readonly limiterName: string;
  public readonly timeoutMs: number;

  constructor(limiterName: string, timeoutMs: number) {
    super(`RateLimiter task timed out after ${timeoutMs}ms for ${limiterName}`);
    this.name = 'RateLimiterTimeoutError';
    this.limiterName = limiterName;
    this.timeoutMs = timeoutMs;
  }
}

interface QueuedTask<T> {
  id: number;
  createdAt: number;
  label?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  settled: boolean;
}

export class RateLimiter {
  private readonly name: string;
  private readonly maxConcurrent: number;
  private readonly minTimeMs: number;
  private readonly maxQueueSize: number;
  private readonly defaultTaskTimeoutMs?: number;
  private readonly jitterMs: number;
  private readonly logger?: Logger;

  private activeCount = 0;
  private lastRunAt = 0;
  private cooldownUntil = 0;
  private pumpScheduled = false;
  private nextTaskId = 1;

  private readonly queue: Array<QueuedTask<unknown>> = [];

  private stats: RateLimiterStats = {
    queued: 0,
    active: 0,
    executed: 0,
    rejected: 0,
    delayed: 0,
    cooledDown: 0,
    timedOut: 0,
    cancelled: 0,
    maxObservedQueueDepth: 0,
    lastRunAt: null,
    cooldownUntil: null,
  };

  constructor(options: RateLimiterOptions) {
    if (!Number.isFinite(options.maxConcurrent) || options.maxConcurrent < 1) {
      throw new Error('RateLimiter maxConcurrent must be >= 1');
    }

    if (!Number.isFinite(options.minTimeMs) || options.minTimeMs < 0) {
      throw new Error('RateLimiter minTimeMs must be >= 0');
    }

    if (
      options.maxQueueSize !== undefined &&
      (!Number.isFinite(options.maxQueueSize) || options.maxQueueSize < 1)
    ) {
      throw new Error('RateLimiter maxQueueSize must be >= 1');
    }

    if (
      options.defaultTaskTimeoutMs !== undefined &&
      (!Number.isFinite(options.defaultTaskTimeoutMs) || options.defaultTaskTimeoutMs < 1)
    ) {
      throw new Error('RateLimiter defaultTaskTimeoutMs must be >= 1');
    }

    if (
      options.jitterMs !== undefined &&
      (!Number.isFinite(options.jitterMs) || options.jitterMs < 0)
    ) {
      throw new Error('RateLimiter jitterMs must be >= 0');
    }

    this.name = options.name ?? 'rate-limiter';
    this.maxConcurrent = options.maxConcurrent;
    this.minTimeMs = options.minTimeMs;
    this.maxQueueSize = options.maxQueueSize ?? 1000;
    this.defaultTaskTimeoutMs = options.defaultTaskTimeoutMs;
    this.jitterMs = options.jitterMs ?? 0;
    this.logger = options.logger;
  }

  async schedule<T>(
    task: () => Promise<T>,
    options: ScheduleOptions = {},
  ): Promise<T> {
    if (this.queue.length >= this.maxQueueSize) {
      this.stats.rejected += 1;
      this.syncStats();
      throw new RateLimiterOverflowError(this.name);
    }

    return new Promise<T>((resolve, reject) => {
      const queuedTask: QueuedTask<T> = {
        id: this.nextTaskId++,
        createdAt: Date.now(),
        label: options.label,
        timeoutMs: options.timeoutMs ?? this.defaultTaskTimeoutMs,
        signal: options.signal,
        run: task,
        resolve,
        reject,
        settled: false,
      };

      if (queuedTask.signal?.aborted) {
        queuedTask.settled = true;
        this.stats.cancelled += 1;
        reject(new Error(`RateLimiter task cancelled before queueing for ${this.name}`));
        return;
      }

      this.queue.push(queuedTask as QueuedTask<unknown>);
      this.syncStats();

      if (this.queue.length > this.stats.maxObservedQueueDepth) {
        this.stats.maxObservedQueueDepth = this.queue.length;
      }

      if (queuedTask.signal) {
        const onAbort = (): void => {
          if (queuedTask.settled) return;
          const removed = this.removeFromQueue(queuedTask.id);
          if (!removed) return;

          queuedTask.settled = true;
          this.stats.cancelled += 1;
          this.syncStats();

          reject(new Error(`RateLimiter task cancelled while queued for ${this.name}`));
        };

        queuedTask.signal.addEventListener('abort', onAbort, { once: true });
      }

      this.schedulePump(0);
    });
  }

  getStats(): RateLimiterStats {
    return {
      ...this.stats,
      queued: this.queue.length,
      active: this.activeCount,
      lastRunAt: this.lastRunAt > 0 ? this.lastRunAt : null,
      cooldownUntil: this.cooldownUntil > Date.now() ? this.cooldownUntil : null,
    };
  }

  /**
   * Introduce a cooldown window during which no new tasks will start.
   * Useful after 429s or upstream throttling signals.
   */
  coolDown(ms: number, reason = 'external'): void {
    if (!Number.isFinite(ms) || ms <= 0) {
      return;
    }

    const target = Date.now() + ms;
    if (target > this.cooldownUntil) {
      this.cooldownUntil = target;
      this.stats.cooledDown += 1;
      this.syncStats();

      this.logger?.warn('rate limiter cooldown applied', {
        component: 'rateLimiter',
        limiterName: this.name,
        reason,
        cooldownMs: ms,
        cooldownUntil: new Date(this.cooldownUntil).toISOString(),
        queueDepth: this.queue.length,
        activeCount: this.activeCount,
      });
    }

    this.schedulePump(ms);
  }

  private schedulePump(delayMs: number): void {
    if (this.pumpScheduled) {
      return;
    }

    this.pumpScheduled = true;

    setTimeout(() => {
      this.pumpScheduled = false;
      void this.pump();
    }, Math.max(0, delayMs));
  }

  private async pump(): Promise<void> {
    while (this.queue.length > 0 && this.activeCount < this.maxConcurrent) {
      const now = Date.now();

      if (this.cooldownUntil > now) {
        const waitMs = this.cooldownUntil - now;
        this.stats.delayed += 1;
        this.syncStats();
        this.schedulePump(waitMs);
        return;
      }

      const elapsed = now - this.lastRunAt;
      const spacingWaitMs = Math.max(0, this.minTimeMs - elapsed);
      const jitterWaitMs = this.jitterMs > 0 ? randomInt(0, this.jitterMs) : 0;
      const totalWaitMs = spacingWaitMs + jitterWaitMs;

      if (totalWaitMs > 0) {
        this.stats.delayed += 1;
        this.syncStats();
        this.schedulePump(totalWaitMs);
        return;
      }

      const next = this.queue.shift();
      this.syncStats();

      if (!next || next.settled) {
        continue;
      }

      this.startQueuedTask(next);
    }
  }

  private startQueuedTask<T>(task: QueuedTask<T>): void {
    this.activeCount += 1;
    this.lastRunAt = Date.now();
    this.syncStats();

    this.logger?.debug('rate limiter starting queued task', {
      component: 'rateLimiter',
      limiterName: this.name,
      taskId: task.id,
      label: task.label,
      queueDepth: this.queue.length,
      activeCount: this.activeCount,
      ageMs: Date.now() - task.createdAt,
    });

    void this.executeTask(task).finally(() => {
      this.activeCount = Math.max(0, this.activeCount - 1);
      this.syncStats();
      this.schedulePump(0);
    });
  }

  private async executeTask<T>(task: QueuedTask<T>): Promise<void> {
    let timeoutHandle: NodeJS.Timeout | undefined;
    let abortListener: (() => void) | undefined;

    try {
      const taskPromise = task.run();

      const guardedPromise =
        task.timeoutMs && task.timeoutMs > 0
          ? new Promise<T>((resolve, reject) => {
              timeoutHandle = setTimeout(() => {
                this.stats.timedOut += 1;
                reject(new RateLimiterTimeoutError(this.name, task.timeoutMs as number));
              }, task.timeoutMs);

              if (task.signal) {
                abortListener = () => {
                  this.stats.cancelled += 1;
                  reject(new Error(`RateLimiter task cancelled during execution for ${this.name}`));
                };
                task.signal.addEventListener('abort', abortListener, { once: true });
              }

              void taskPromise.then(resolve, reject);
            })
          : taskPromise;

      const result = await guardedPromise;

      if (!task.settled) {
        task.settled = true;
        this.stats.executed += 1;
        task.resolve(result);
      }
    } catch (error) {
      if (!task.settled) {
        task.settled = true;
        task.reject(error);
      }
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }

      if (task.signal && abortListener) {
        task.signal.removeEventListener('abort', abortListener);
      }
    }
  }

  private removeFromQueue(taskId: number): boolean {
    const index = this.queue.findIndex((task) => task.id === taskId);
    if (index < 0) {
      return false;
    }

    this.queue.splice(index, 1);
    return true;
  }

  private syncStats(): void {
    this.stats.queued = this.queue.length;
    this.stats.active = this.activeCount;
    this.stats.lastRunAt = this.lastRunAt > 0 ? this.lastRunAt : null;
    this.stats.cooldownUntil = this.cooldownUntil > Date.now() ? this.cooldownUntil : null;
  }
}

function randomInt(min: number, max: number): number {
  const lower = Math.ceil(min);
  const upper = Math.floor(max);
  if (upper <= lower) {
    return lower;
  }
  return Math.floor(Math.random() * (upper - lower + 1)) + lower;
}
