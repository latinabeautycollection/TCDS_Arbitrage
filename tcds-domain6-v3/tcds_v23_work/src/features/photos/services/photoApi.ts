import type { CompletionGate, PhotoSession } from '../types/photoTypes';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';
const timeoutMs = 20_000;

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  const requestId = crypto.randomUUID();
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: 'include',
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'X-Request-ID': requestId,
        'X-Correlation-ID': crypto.randomUUID(),
        'X-TCDS-App-Version': import.meta.env.VITE_APP_VERSION ?? '3.0.0',
        ...init.headers,
      },
    });
    if (response.status === 401) throw new Error('SESSION_EXPIRED');
    if (response.status === 409) throw new Error('SESSION_CONFLICT');
    if (!response.ok) throw new Error(`PHOTO_API_${response.status}`);
    return await response.json() as T;
  } finally {
    window.clearTimeout(timer);
  }
}

export const photoApi = {
  loadSession: (sessionId: string) => request<PhotoSession>(`/api/v1/photo-sessions/${encodeURIComponent(sessionId)}`),
  claimSession: (sessionId: string) => request<PhotoSession>(`/api/v1/photo-sessions/${sessionId}/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: '{}' }),
  authorizeUpload: (sessionId: string, requirementId: string, file: File, sha256: string) => request<{ uploadId: string; route: 'DIRECT_R2' | 'API_FALLBACK'; uploadUrl: string; headers: Record<string,string> }>(`/api/v1/photo-sessions/${sessionId}/uploads/authorize`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ requirementId, fileName: file.name, contentType: file.type, byteSize: file.size, sha256 }) }),
  completeUpload: (sessionId: string, payload: unknown) => request<PhotoSession>(`/api/v1/photo-sessions/${sessionId}/uploads/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(payload) }),
  retryAssessment: (sessionId: string, assetId: string) => request<PhotoSession>(`/api/v1/photo-sessions/${sessionId}/photos/${assetId}/reassess`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: '{}' }),
  requestReview: (sessionId: string, requirementId: string, reason: string) => request<PhotoSession>(`/api/v1/photo-sessions/${sessionId}/review/request`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ requirementId, reason }) }),
  createOverride: (sessionId: string, requirementId: string, reasonCode: string, reason: string, level: 'MANAGER' | 'EXECUTIVE') => request<PhotoSession>(`/api/v1/photo-sessions/${sessionId}/overrides`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ requirementId, reasonCode, reason, level }) }),
  completionCheck: (sessionId: string) => request<CompletionGate>(`/api/v1/photo-sessions/${sessionId}/completion-check`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: '{}' }),
  completeSession: (sessionId: string) => request<CompletionGate>(`/api/v1/photo-sessions/${sessionId}/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: '{}' }),
};
