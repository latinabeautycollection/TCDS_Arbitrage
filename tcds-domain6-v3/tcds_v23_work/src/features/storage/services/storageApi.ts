import type { ApiErrorPayload, OverrideLevel, PutAwayCompletion, PutAwaySession } from '../types/storageTypes';

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
const TIMEOUT_MS = 15_000;

export class StorageApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly code = 'PUTAWAY_REQUEST_FAILED', public readonly supportReference?: string, public readonly retryAfterSeconds?: number, public readonly currentRowVersion?: number) { super(message); }
}

function installationId(): string {
  const key = 'tcds.pwa.installationId';
  let value = localStorage.getItem(key);
  if (!value) { value = crypto.randomUUID(); localStorage.setItem(key, value); }
  return value;
}

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init, credentials: 'include', cache: 'no-store', signal: controller.signal,
      headers: {
        'Content-Type': 'application/json', 'X-Request-ID': crypto.randomUUID(), 'X-Correlation-ID': crypto.randomUUID(),
        'X-TCDS-Installation-ID': installationId(), 'X-TCDS-App-Version': import.meta.env.VITE_APP_VERSION ?? '3.7.1', ...(init.headers ?? {}),
      },
    });
    if (response.status === 401) window.dispatchEvent(new CustomEvent('tcds:session-expired'));
    if (!response.ok) {
      let payload: ApiErrorPayload = {};
      try { payload = await response.json() as ApiErrorPayload; } catch { /* no-op */ }
      throw new StorageApiError(payload.message ?? 'The storage assignment request could not be completed.', response.status, payload.code, payload.supportReference, payload.retryAfterSeconds, payload.currentRowVersion);
    }
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  } catch (error) {
    if (error instanceof StorageApiError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') throw new StorageApiError('The request timed out. Your work may already be committed; retry safely.', 408, 'REQUEST_TIMEOUT');
    throw new StorageApiError('Unable to reach the warehouse service. Your scan can be retained locally, but put-away completion remains blocked.', 0, 'NETWORK_UNAVAILABLE');
  } finally { window.clearTimeout(timeout); }
}

function mutation<T>(path: string, method: string, body: object, idempotencyKey: string = crypto.randomUUID()): Promise<T> {
  return request(path, { method, headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(body) });
}

export const createOrResumePutAway = (workflowToken: string) => mutation<PutAwaySession>('/api/v1/put-away/sessions', 'POST', { workflowToken }, `putaway-open-${workflowToken}`);
export const getPutAwaySession = (sessionId: string) => request<PutAwaySession>(`/api/v1/put-away/sessions/${encodeURIComponent(sessionId)}`);
export const renewClaim = (sessionId: string, rowVersion: number) => mutation<PutAwaySession>(`/api/v1/put-away/sessions/${sessionId}/claim/renew`, 'POST', { rowVersion });
export const releaseClaim = (sessionId: string, rowVersion: number) => mutation<void>(`/api/v1/put-away/sessions/${sessionId}/claim/release`, 'POST', { rowVersion });
export const requestTakeover = (sessionId: string, reason: string) => mutation<PutAwaySession>(`/api/v1/put-away/sessions/${sessionId}/takeover/request`, 'POST', { reason });
export const approveTakeover = (sessionId: string, reason: string, rowVersion: number) => mutation<PutAwaySession>(`/api/v1/put-away/sessions/${sessionId}/takeover/approve`, 'POST', { reason, rowVersion });
export const refreshRecommendations = (sessionId: string, rowVersion: number, reason?: string) => mutation<PutAwaySession>(`/api/v1/put-away/sessions/${sessionId}/recommendations`, 'POST', { rowVersion, reason });
export const selectRecommendation = (sessionId: string, recommendationId: string, rowVersion: number, rejectionReason?: string) => mutation<PutAwaySession>(`/api/v1/put-away/sessions/${sessionId}/recommendations/${recommendationId}/select`, 'POST', { rowVersion, rejectionReason });
export const scanItem = (sessionId: string, barcode: string, rowVersion: number, idempotencyKey = crypto.randomUUID()) => mutation<PutAwaySession>(`/api/v1/put-away/sessions/${sessionId}/scan-item`, 'POST', { barcode, rowVersion, clientOccurredAt: new Date().toISOString() }, idempotencyKey);
export const scanLocation = (sessionId: string, barcode: string, rowVersion: number, idempotencyKey = crypto.randomUUID()) => mutation<PutAwaySession>(`/api/v1/put-away/sessions/${sessionId}/scan-location`, 'POST', { barcode, rowVersion, clientOccurredAt: new Date().toISOString() }, idempotencyKey);
export const reportException = (sessionId: string, exceptionType: string, notes: string, rowVersion: number) => mutation<PutAwaySession>(`/api/v1/put-away/sessions/${sessionId}/exceptions`, 'POST', { exceptionType, notes, rowVersion });
export const requestReview = (sessionId: string, reason: string, level: OverrideLevel, rowVersion: number) => mutation<PutAwaySession>(`/api/v1/put-away/sessions/${sessionId}/review`, 'POST', { reason, requestedLevel: level, rowVersion });
export const completionCheck = (sessionId: string, rowVersion: number) => mutation<PutAwaySession>(`/api/v1/put-away/sessions/${sessionId}/completion-check`, 'POST', { rowVersion });
export const completePutAway = (sessionId: string, rowVersion: number) => mutation<PutAwayCompletion>(`/api/v1/put-away/sessions/${sessionId}/complete`, 'POST', { rowVersion }, `putaway-complete-${sessionId}-${rowVersion}`);
export const submitFeedback = (sessionId: string, payload: object) => mutation<void>(`/api/v1/put-away/sessions/${sessionId}/feedback`, 'POST', payload);
