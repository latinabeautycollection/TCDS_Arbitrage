export const PRONG2_WORKER_STATUSES = [
  'starting',
  'running',
  'processing',
  'degraded',
  'stopped',
] as const;

export type Prong2WorkerStatus = (typeof PRONG2_WORKER_STATUSES)[number];

export interface WorkerHeartbeatWriteInput<TDetails extends Record<string, unknown>> {
  workerName: string;
  workerInstanceId: string;
  status: Prong2WorkerStatus;
  details: TDetails;
}

export interface MarketIntelHeartbeatDetails extends Record<string, unknown> {
  phase: 'boot' | 'polling_strategies' | 'market_pull' | 'error' | 'shutdown';
  strategyId?: number;
  categoryKey?: string;
  query?: string;
  runId?: number;
  correlationId?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface WatchlistHeartbeatDetails extends Record<string, unknown> {
  phase: 'boot' | 'claiming_snapshot_products' | 'watchlist_evaluation' | 'error' | 'shutdown';
  snapshotProductId?: number;
  familyKey?: string;
  claimToken?: string;
  rejectionReasonCode?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface OpportunityQueueHeartbeatDetails extends Record<string, unknown> {
  phase: 'boot' | 'claiming_candidates' | 'candidate_matching' | 'error' | 'shutdown';
  candidateId?: number;
  listingId?: number;
  familyKey?: string;
  watchlistId?: number;
  claimToken?: string;
  errorCode?: string;
  errorMessage?: string;
}
