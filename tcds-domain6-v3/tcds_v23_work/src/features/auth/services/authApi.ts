import type { AuthenticationOptionsJSON, AuthenticationResponseJSON } from './webauthnClient';
import type { ApiProblem, AuthBootstrap, AuthSession, LoginRequest, PasskeyAvailability } from '../types/authTypes';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
const REQUEST_TIMEOUT_MS = Number(import.meta.env.VITE_AUTH_REQUEST_TIMEOUT_MS ?? 12000);

export class AuthApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;
  readonly retryAfterSeconds?: number;

  constructor(problem: ApiProblem, fallbackStatus = 500) {
    super(problem.detail ?? problem.title ?? 'Authentication request failed.');
    this.name = 'AuthApiError';
    this.status = problem.status ?? fallbackStatus;
    this.code = problem.code ?? 'AUTH_REQUEST_FAILED';
    this.requestId = problem.requestId;
    this.retryAfterSeconds = problem.retryAfterSeconds;
  }
}

function createHeaders(includeJson = false): Headers {
  const headers = new Headers();
  if (includeJson) headers.set('Content-Type', 'application/json');
  headers.set('Accept', 'application/json');
  headers.set('X-Request-ID', crypto.randomUUID());
  headers.set('X-Correlation-ID', crypto.randomUUID());
  headers.set('X-TCDS-App-Version', import.meta.env.VITE_APP_VERSION ?? '3.1.1-login');

  const deviceId = localStorage.getItem('tcds.device.installationId');
  if (deviceId) headers.set('X-TCDS-Device-ID', deviceId);
  return headers;
}

async function request<T>(path: string, init: RequestInit = {}, externalSignal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort('timeout'), REQUEST_TIMEOUT_MS);
  const abortFromExternal = () => controller.abort('cancelled');
  externalSignal?.addEventListener('abort', abortFromExternal, { once: true });

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      credentials: 'include',
      cache: 'no-store',
      headers: init.headers ?? createHeaders(Boolean(init.body)),
      signal: controller.signal,
    });

    if (!response.ok) {
      let problem: ApiProblem = { status: response.status, title: 'Authentication request failed.' };
      try { problem = { ...problem, ...(await response.json() as ApiProblem) }; } catch { /* non-JSON error */ }
      throw new AuthApiError(problem, response.status);
    }

    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  } catch (error) {
    if (error instanceof AuthApiError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      const cancelled = externalSignal?.aborted;
      throw new AuthApiError({
        status: cancelled ? 499 : 504,
        code: cancelled ? 'AUTH_CANCELLED' : 'AUTH_TIMEOUT',
        detail: cancelled ? 'The sign-in request was cancelled.' : 'The authentication service did not respond in time.',
      }, cancelled ? 499 : 504);
    }
    throw new AuthApiError({ status: 503, code: 'AUTH_NETWORK_ERROR', detail: 'The authentication service is unavailable. Check the network connection.' }, 503);
  } finally {
    window.clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', abortFromExternal);
  }
}

export const authApi = {
  bootstrap: (signal?: AbortSignal) => request<AuthBootstrap>('/api/v1/auth/bootstrap', { headers: createHeaders() }, signal),
  session: (signal?: AbortSignal) => request<AuthSession>('/api/v1/auth/session', { headers: createHeaders() }, signal),
  login: (payload: LoginRequest, signal?: AbortSignal) => request<AuthSession>('/api/v1/auth/login', {
    method: 'POST', headers: createHeaders(true), body: JSON.stringify(payload),
  }, signal),
  logout: (signal?: AbortSignal) => request<void>('/api/v1/auth/logout', { method: 'POST', headers: createHeaders(true), body: '{}' }, signal),
  passkeyAvailability: (identifier: string, signal?: AbortSignal) => request<PasskeyAvailability>('/api/v1/auth/passkeys/availability', {
    method: 'POST', headers: createHeaders(true), body: JSON.stringify({ identifier }),
  }, signal),
  passkeyAuthenticationOptions: (identifier: string, signal?: AbortSignal) => request<AuthenticationOptionsJSON>('/api/v1/auth/passkeys/authentication/options', {
    method: 'POST', headers: createHeaders(true), body: JSON.stringify({ identifier }),
  }, signal),
  verifyPasskeyAuthentication: (response: AuthenticationResponseJSON, signal?: AbortSignal) => request<AuthSession>('/api/v1/auth/passkeys/authentication/verify', {
    method: 'POST', headers: createHeaders(true), body: JSON.stringify(response),
  }, signal),
};
