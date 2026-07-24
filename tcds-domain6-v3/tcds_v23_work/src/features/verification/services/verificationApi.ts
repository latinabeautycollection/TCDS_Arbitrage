import type { AdaptiveCard, ApiProblem, CompletionGate, VerificationSession } from '../types/verificationTypes';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';
const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? '3.6.0';
const REQUEST_TIMEOUT_MS = 15000;

function requestHeaders(idempotencyKey?: string): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'X-Request-ID': crypto.randomUUID(),
    'X-Correlation-ID': crypto.randomUUID(),
    'X-TCDS-App-Version': APP_VERSION,
    ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})
  };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: 'include',
      cache: 'no-store',
      headers: { ...requestHeaders(), ...(init.headers ?? {}) },
      signal: controller.signal
    });
    if (response.status === 401) {
      window.location.assign('/');
      throw { code: 'SESSION_EXPIRED', message: 'Your secure session expired.', retryable: false } satisfies ApiProblem;
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw {
        code: body.code ?? `HTTP_${response.status}`,
        message: body.message ?? 'The verification service could not complete the request.',
        requestId: response.headers.get('x-request-id') ?? undefined,
        retryable: response.status >= 500 || response.status === 429
      } satisfies ApiProblem;
    }
    return await response.json() as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw { code: 'TIMEOUT', message: 'The verification request timed out.', retryable: true } satisfies ApiProblem;
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export function getVerification(verificationId: string): Promise<VerificationSession> {
  return request(`/api/v1/item-verifications/${encodeURIComponent(verificationId)}`);
}

export function saveCardDecision(verificationId: string, card: AdaptiveCard): Promise<VerificationSession> {
  return request(`/api/v1/item-verifications/${encodeURIComponent(verificationId)}/decisions`, {
    method: 'PUT',
    headers: requestHeaders(crypto.randomUUID()),
    body: JSON.stringify({ cardId: card.cardId, selectedValue: card.selectedValue, notes: card.notes })
  });
}

export function attestVerification(verificationId: string): Promise<VerificationSession> {
  return request(`/api/v1/item-verifications/${encodeURIComponent(verificationId)}/attest`, {
    method: 'POST',
    headers: requestHeaders(crypto.randomUUID()),
    body: JSON.stringify({ attested: true })
  });
}

export function runAssessment(verificationId: string): Promise<VerificationSession> {
  return request(`/api/v1/item-verifications/${encodeURIComponent(verificationId)}/assess`, {
    method: 'POST',
    headers: requestHeaders(crypto.randomUUID()),
    body: '{}'
  });
}

export function completionCheck(verificationId: string): Promise<CompletionGate> {
  return request(`/api/v1/item-verifications/${encodeURIComponent(verificationId)}/completion-check`, {
    method: 'POST',
    headers: requestHeaders(crypto.randomUUID()),
    body: '{}'
  });
}

export function completeVerification(verificationId: string): Promise<VerificationSession> {
  return request(`/api/v1/item-verifications/${encodeURIComponent(verificationId)}/complete`, {
    method: 'POST',
    headers: requestHeaders(crypto.randomUUID()),
    body: '{}'
  });
}

export function requestReview(verificationId: string, reason: string): Promise<VerificationSession> {
  return request(`/api/v1/item-verifications/${encodeURIComponent(verificationId)}/review/request`, {
    method: 'POST',
    headers: requestHeaders(crypto.randomUUID()),
    body: JSON.stringify({ reason })
  });
}

export function submitOverride(verificationId: string, decision: 'APPROVE' | 'REJECT', reason: string): Promise<VerificationSession> {
  return request(`/api/v1/item-verifications/${encodeURIComponent(verificationId)}/overrides`, {
    method: 'POST',
    headers: requestHeaders(crypto.randomUUID()),
    body: JSON.stringify({ decision, reason })
  });
}
