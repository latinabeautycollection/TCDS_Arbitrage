import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchDashboard } from '../services/dashboardApi';
import type { DashboardResponse } from '../types/dashboardTypes';
export function useDashboard() {
  const [data, setData] = useState<DashboardResponse | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null); const controller = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => { controller.current?.abort(); controller.current = new AbortController(); setError(null); if (!data) setLoading(true); try { setData(await fetchDashboard(controller.current.signal)); } catch (e) { if ((e as Error).name !== 'AbortError') setError((e as Error).message); } finally { setLoading(false); } }, [data]);
  useEffect(() => { void refresh(); const id = window.setInterval(() => void refresh(), 60000); const onVisible = () => document.visibilityState === 'visible' && void refresh(); const onOnline = () => void refresh(); document.addEventListener('visibilitychange', onVisible); window.addEventListener('online', onOnline); return () => { controller.current?.abort(); clearInterval(id); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('online', onOnline); }; }, [refresh]);
  return { data, loading, error, refresh };
}
