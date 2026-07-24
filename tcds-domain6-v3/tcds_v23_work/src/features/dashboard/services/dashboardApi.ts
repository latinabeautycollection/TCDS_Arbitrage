import type { DashboardResponse } from '../types/dashboardTypes';
const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
export async function fetchDashboard(signal?: AbortSignal): Promise<DashboardResponse> {
  const requestId = crypto.randomUUID();
  const response = await fetch(`${API_BASE}/api/v1/dashboard`, { credentials: 'include', cache: 'no-store', signal, headers: { Accept: 'application/json', 'X-Request-ID': requestId, 'X-Correlation-ID': crypto.randomUUID(), 'X-App-Version': import.meta.env.VITE_APP_VERSION || '3.4.0' } });
  if (response.status === 401) throw new Error('SESSION_EXPIRED');
  if (!response.ok) throw new Error(`DASHBOARD_${response.status}`);
  return response.json() as Promise<DashboardResponse>;
}
