import type { AllocatedBarcode, IntakeCandidate, IntakeItemDraft, IntakeVerificationResult, PackageCondition, ReceiptMatch, ReceiptSummary, ReceiveBootstrap, ReceivingSession } from '../types/receivingTypes';
const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController(); const timeout = window.setTimeout(() => controller.abort(), 15000);
  try { const response = await fetch(`${API_BASE}${path}`, { ...init, signal: init.signal ?? controller.signal, credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Request-ID': crypto.randomUUID(), 'X-Correlation-ID': crypto.randomUUID(), 'X-App-Version': import.meta.env.VITE_APP_VERSION || '3.4.0', ...(init.headers || {}) } });
    if (response.status === 401) throw new Error('SESSION_EXPIRED'); if (response.status === 409) throw new Error('CONFLICT'); if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.code || `HTTP_${response.status}`); } return response.status === 204 ? (undefined as T) : response.json() as Promise<T>;
  } finally { clearTimeout(timeout); }
}
export const receivingApi = {
  bootstrap: () => request<ReceiveBootstrap>('/api/v1/receiving/bootstrap'),
  matchPackage: (identifier: string) => request<ReceiptMatch>('/api/v1/receiving/packages/match', { method: 'POST', body: JSON.stringify({ identifier }) }),
  saveInspection: (receiptId: string, input: { packageCondition: PackageCondition; sealIntact: boolean; visibleDamage: boolean; carrierLabelClear: boolean; evidenceAssetIds: string[]; notes?: string; }) => request<{ inboundPackageId: string; evidenceSatisfied: boolean }>(`/api/v1/receiving/receipts/${receiptId}/package-inspection`, { method: 'POST', body: JSON.stringify(input) }),
  openSession: (receiptId: string, inboundPackageId: string) => request<ReceivingSession>('/api/v1/receiving/sessions', { method: 'POST', body: JSON.stringify({ receiptId, inboundPackageId, idempotencyKey: crypto.randomUUID() }) }),
  reconcileContents: (sessionId: string, actualCount: number) => request<{ exceptionCount: number; blocking: boolean }>(`/api/v1/receiving/sessions/${sessionId}/contents`, { method: 'POST', body: JSON.stringify({ actualCount, idempotencyKey: crypto.randomUUID() }) }),
  createCandidate: (sessionId: string, draft: IntakeItemDraft) => request<IntakeCandidate>(`/api/v1/receiving/sessions/${sessionId}/intake-candidates`, { method: 'POST', body: JSON.stringify({ ...draft, idempotencyKey: crypto.randomUUID() }) }),
  validateCandidate: (candidateId: string) => request<{ passed: boolean; errors: string[] }>(`/api/v1/receiving/intake-candidates/${candidateId}/validate`, { method: 'POST' }),
  verifyCandidate: (candidateId: string) => request<IntakeVerificationResult>(`/api/v1/receiving/intake-candidates/${candidateId}/verify`, { method: 'POST' }),
  verificationStatus: (candidateId: string) => request<IntakeVerificationResult>(`/api/v1/receiving/intake-candidates/${candidateId}/verification`),
  allocateBarcode: (candidateId: string) => request<AllocatedBarcode>(`/api/v1/receiving/intake-candidates/${candidateId}/barcode`, { method: 'POST', body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }) }),
  summary: (sessionId: string) => request<ReceiptSummary>(`/api/v1/receiving/sessions/${sessionId}/summary`),
  completeSession: (sessionId: string) => request<{ receiptId: string; status: string }>(`/api/v1/receiving/sessions/${sessionId}/complete`, { method: 'POST', body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }) }),
};
