import { useCallback, useEffect, useRef, useState } from 'react';
import { getInventory, InventoryApiError } from '../services/inventoryApi';
import type { InventoryFilter, InventoryListResponse } from '../types/inventoryTypes';

export function useInventory(query: string, filter: InventoryFilter) {
  const [data, setData] = useState<InventoryListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  const load = useCallback(async (background = false) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    background ? setRefreshing(true) : setLoading(true);
    try {
      const result = await getInventory({ query: query.trim() || undefined, filter, signal: controller.signal });
      setData(result);
      setError(null);
    } catch (caught) {
      if (controller.signal.aborted) return;
      const message = caught instanceof InventoryApiError ? caught.message : 'Inventory could not be loaded.';
      setError(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter, query]);

  useEffect(() => {
    const timeout = window.setTimeout(() => { void load(false); }, query ? 350 : 0);
    return () => window.clearTimeout(timeout);
  }, [load, query]);

  useEffect(() => {
    const onOnline = () => { void load(true); };
    const onVisible = () => { if (document.visibilityState === 'visible') void load(true); };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  return { data, loading, refreshing, error, refresh: () => load(true) };
}
