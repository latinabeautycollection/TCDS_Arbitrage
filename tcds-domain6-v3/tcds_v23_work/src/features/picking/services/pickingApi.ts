import type { CompletionResult, ExceptionType, PickTask, ScanResult } from '../types/pickingTypes';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const APP_VERSION = import.meta.env.VITE_APP_VERSION || '3.9.0';

function requestHeaders(idempotencyKey?: string, rowVersion?: number): HeadersInit {
  const requestId = crypto.randomUUID();
  return {
    'Content-Type': 'application/json',
    'X-Request-ID': requestId,
    'X-Correlation-ID': crypto.randomUUID(),
    'X-TCDS-App-Version': APP_VERSION,
    ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    ...(rowVersion !== undefined ? { 'If-Match': String(rowVersion) } : {}),
  };
}

async function api<T>(path: string, init: RequestInit = {}, timeoutMs = 15000): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (response.status === 401) throw new Error('SESSION_EXPIRED');
    if (response.status === 409) throw new Error('CONFLICT');
    if (response.status === 412) throw new Error('STALE_VERSION');
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body?.code || `PICK_API_${response.status}`);
    }
    return response.json() as Promise<T>;
  } finally {
    window.clearTimeout(timeout);
  }
}

export const pickingApi = {
  getTask(taskId: string) {
    return api<PickTask>(`/api/v1/picks/tasks/${encodeURIComponent(taskId)}`, { headers: requestHeaders() });
  },
  claim(taskId: string) {
    return api<PickTask>(`/api/v1/picks/tasks/${encodeURIComponent(taskId)}/claim`, { method: 'POST', headers: requestHeaders(crypto.randomUUID()), body: '{}' });
  },
  renewClaim(task: PickTask) {
    return api<PickTask>(`/api/v1/picks/tasks/${encodeURIComponent(task.taskId)}/claim/renew`, { method: 'POST', headers: requestHeaders(crypto.randomUUID(), task.rowVersion), body: JSON.stringify({ claimToken: task.claimToken }) });
  },
  scanLocation(task: PickTask, barcode: string) {
    return api<ScanResult>(`/api/v1/picks/tasks/${encodeURIComponent(task.taskId)}/scan-location`, { method: 'POST', headers: requestHeaders(crypto.randomUUID(), task.rowVersion), body: JSON.stringify({ barcode, claimToken: task.claimToken }) });
  },
  scanItem(task: PickTask, barcode: string) {
    return api<ScanResult>(`/api/v1/picks/tasks/${encodeURIComponent(task.taskId)}/scan-item`, { method: 'POST', headers: requestHeaders(crypto.randomUUID(), task.rowVersion), body: JSON.stringify({ barcode, claimToken: task.claimToken, lineId: task.current.lineId }) });
  },
  confirmCondition(task: PickTask, result: 'UNCHANGED' | 'DAMAGE_FOUND' | 'PACKAGING_ISSUE' | 'IDENTITY_CONCERN') {
    return api<PickTask>(`/api/v1/picks/tasks/${encodeURIComponent(task.taskId)}/confirm-condition`, { method: 'POST', headers: requestHeaders(crypto.randomUUID(), task.rowVersion), body: JSON.stringify({ result, claimToken: task.claimToken, lineId: task.current.lineId }) });
  },
  scanDestination(task: PickTask, barcode: string) {
    return api<ScanResult>(`/api/v1/picks/tasks/${encodeURIComponent(task.taskId)}/scan-destination`, { method: 'POST', headers: requestHeaders(crypto.randomUUID(), task.rowVersion), body: JSON.stringify({ barcode, claimToken: task.claimToken }) });
  },
  createException(task: PickTask, type: ExceptionType, notes: string) {
    return api<PickTask>(`/api/v1/picks/tasks/${encodeURIComponent(task.taskId)}/exceptions`, { method: 'POST', headers: requestHeaders(crypto.randomUUID(), task.rowVersion), body: JSON.stringify({ type, notes, claimToken: task.claimToken, lineId: task.current.lineId }) });
  },
  completionCheck(task: PickTask) {
    return api<PickTask>(`/api/v1/picks/tasks/${encodeURIComponent(task.taskId)}/completion-check`, { method: 'POST', headers: requestHeaders(crypto.randomUUID(), task.rowVersion), body: JSON.stringify({ claimToken: task.claimToken }) });
  },
  complete(task: PickTask) {
    return api<CompletionResult>(`/api/v1/picks/tasks/${encodeURIComponent(task.taskId)}/complete`, { method: 'POST', headers: requestHeaders(crypto.randomUUID(), task.rowVersion), body: JSON.stringify({ claimToken: task.claimToken }) }, 30000);
  },
};
