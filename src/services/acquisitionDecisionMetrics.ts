const counters = new Map<string, number>();
const gauges = new Map<string, number>();
export function incAcqCounter(name: string, by = 1): void { counters.set(name, (counters.get(name) ?? 0) + by); }
export function setAcqGauge(name: string, value: number): void { gauges.set(name, value); }
export function renderAcquisitionDecisionMetrics(): string {
  const lines: string[] = [];
  for (const [k, v] of counters.entries()) { lines.push(`# TYPE ${k} counter`, `${k} ${Number.isFinite(v) ? v : 0}`); }
  for (const [k, v] of gauges.entries()) { lines.push(`# TYPE ${k} gauge`, `${k} ${Number.isFinite(v) ? v : 0}`); }
  return `${lines.join('\n')}\n`;
}
