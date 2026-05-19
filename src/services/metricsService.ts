import os from 'node:os';
import type { Logger } from './logger';
import { JobStore } from './jobStore';

export interface MetricsConfig {
  staleProcessingMinutes: number;
}

export class MetricsService {
  constructor(
    private readonly jobStore: JobStore,
    private readonly logger: Logger,
    private readonly config: MetricsConfig,
  ) {}

  async buildPrometheusText(): Promise<string> {
    const [dbLatencyMs, workers, backlog, deadLetterCount, staleProcessingCount] = await Promise.all([
      this.jobStore.ping(),
      this.jobStore.getWorkerHeartbeats(),
      this.jobStore.getBacklogCounts(),
      this.jobStore.getDeadLetterCount(),
      this.jobStore.getStaleProcessingCount(this.config.staleProcessingMinutes),
    ]);

    const uptimeSeconds = process.uptime();
    const mem = process.memoryUsage();
    const now = Date.now();

    const comp = workers.find((w) => w.workerName === 'comp-analysis-worker');
    const retry = workers.find((w) => w.workerName === 'retry-worker');

    const compAgeSeconds = comp ? Math.floor((now - new Date(comp.lastSeenAt).getTime()) / 1000) : -1;
    const retryAgeSeconds = retry ? Math.floor((now - new Date(retry.lastSeenAt).getTime()) / 1000) : -1;

    const lines = [
      '# HELP arb_process_uptime_seconds Node process uptime in seconds',
      '# TYPE arb_process_uptime_seconds gauge',
      `arb_process_uptime_seconds ${uptimeSeconds}`,

      '# HELP arb_process_resident_memory_bytes Resident memory size in bytes',
      '# TYPE arb_process_resident_memory_bytes gauge',
      `arb_process_resident_memory_bytes ${mem.rss}`,

      '# HELP arb_process_heap_used_bytes Heap used in bytes',
      '# TYPE arb_process_heap_used_bytes gauge',
      `arb_process_heap_used_bytes ${mem.heapUsed}`,

      '# HELP arb_db_ping_latency_ms Database ping latency in milliseconds',
      '# TYPE arb_db_ping_latency_ms gauge',
      `arb_db_ping_latency_ms ${dbLatencyMs}`,

      '# HELP arb_backlog_pending_count Pending listing count',
      '# TYPE arb_backlog_pending_count gauge',
      `arb_backlog_pending_count ${backlog.pending}`,

      '# HELP arb_backlog_retry_count Retry listing count',
      '# TYPE arb_backlog_retry_count gauge',
      `arb_backlog_retry_count ${backlog.retry}`,

      '# HELP arb_backlog_processing_count Processing listing count',
      '# TYPE arb_backlog_processing_count gauge',
      `arb_backlog_processing_count ${backlog.processing}`,

      '# HELP arb_dead_letter_count Dead-letter listing count',
      '# TYPE arb_dead_letter_count gauge',
      `arb_dead_letter_count ${deadLetterCount}`,

      '# HELP arb_stale_processing_count Stale processing listing count',
      '# TYPE arb_stale_processing_count gauge',
      `arb_stale_processing_count ${staleProcessingCount}`,

      '# HELP arb_worker_last_seen_age_seconds Age in seconds since last worker heartbeat',
      '# TYPE arb_worker_last_seen_age_seconds gauge',
      `arb_worker_last_seen_age_seconds{worker="comp-analysis-worker"} ${compAgeSeconds}`,
      `arb_worker_last_seen_age_seconds{worker="retry-worker"} ${retryAgeSeconds}`,

      '# HELP arb_host_info Static host info',
      '# TYPE arb_host_info gauge',
      `arb_host_info{hostname="${escapeLabel(os.hostname())}",node_env="${escapeLabel(process.env.NODE_ENV ?? 'development')}"} 1`,
    ];

    this.logger.debug('metrics snapshot built', {
      component: 'metricsService',
      operation: 'buildPrometheusText',
    });

    return `${lines.join('\n')}\n`;
  }
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
