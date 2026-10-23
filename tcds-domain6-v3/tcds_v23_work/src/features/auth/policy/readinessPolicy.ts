export type ReadinessState = 'HEALTHY' | 'DEGRADED' | 'UNKNOWN';

export function readinessState(value: boolean | null | undefined): ReadinessState {
  if (value === true) return 'HEALTHY';
  if (value === false) return 'DEGRADED';
  return 'UNKNOWN';
}
