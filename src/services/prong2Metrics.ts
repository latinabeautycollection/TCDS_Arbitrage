type CounterKey =
  | 'market_strategies_processed'
  | 'market_runs_failed'
  | 'families_scored'
  | 'families_promoted'
  | 'families_rejected'
  | 'candidates_seeded'
  | 'candidates_matched'
  | 'candidates_no_match'
  | 'opportunities_queued'
  | 'opportunities_queued_without_watchlist'
  | 'worker_failures';

type GaugeKey =
  | 'active_watchlist_count'
  | 'latest_market_family_count'
  | 'latest_match_count'
  | 'latest_watchlist_promotions';

const counters = new Map<CounterKey, number>();
const gauges = new Map<GaugeKey, number>();

export function incCounter(key: CounterKey, by = 1): void {
  counters.set(key, (counters.get(key) ?? 0) + by);
}

export function setGauge(key: GaugeKey, value: number): void {
  gauges.set(key, value);
}

export function renderProng2Metrics(): string {
  const lines: string[] = [];

  for (const [key, value] of counters.entries()) {
    lines.push(`# TYPE prong2_${key} counter`);
    lines.push(`prong2_${key} ${value}`);
  }

  for (const [key, value] of gauges.entries()) {
    lines.push(`# TYPE prong2_${key} gauge`);
    lines.push(`prong2_${key} ${value}`);
  }

  return `${lines.join('\n')}\n`;
}
