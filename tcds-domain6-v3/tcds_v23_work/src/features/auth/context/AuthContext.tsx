import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { startPasskeyAuthentication } from '../services/webauthnClient';
import { authApi, AuthApiError } from '../services/authApi';
import type { AuthBootstrap, AuthSession, LoginRequest } from '../types/authTypes';

type AuthState = 'bootstrapping' | 'anonymous' | 'authenticating' | 'authenticated' | 'unavailable';

interface AuthContextValue {
  state: AuthState;
  bootstrap: AuthBootstrap | null;
  session: AuthSession | null;
  error: AuthApiError | null;
  isOnline: boolean;
  passkeyAvailable: boolean | null;
  login(payload: LoginRequest): Promise<void>;
  loginWithPasskey(identifier: string): Promise<void>;
  checkPasskeyAvailability(identifier: string): Promise<void>;
  cancelAuthentication(): void;
  retryBootstrap(): Promise<void>;
  logout(): Promise<void>;
  refreshSession(): Promise<void>;
  clearError(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function ensureInstallationId(): string {
  const key = 'tcds.device.installationId';
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(key, created);
  return created;
}

const anonymousSession: AuthSession = {
  authenticated: false,
  user: null,
  expiresAt: null,
  idleExpiresAt: null,
  authenticationMethod: null,
};

export function AuthProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<AuthState>('bootstrapping');
  const [bootstrap, setBootstrap] = useState<AuthBootstrap | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [error, setError] = useState<AuthApiError | null>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [passkeyAvailable, setPasskeyAvailable] = useState<boolean | null>(null);
  const activeRequest = useRef<AbortController | null>(null);

  const withController = useCallback(async <T,>(work: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    try { return await work(controller.signal); }
    finally { if (activeRequest.current === controller) activeRequest.current = null; }
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      const current = await authApi.session();
      setSession(current);
      setState(current.authenticated ? 'authenticated' : 'anonymous');
    } catch (err) {
      const apiError = err instanceof AuthApiError ? err : new AuthApiError({ detail: 'Unable to verify the current session.' });
      if (apiError.status === 401) {
        setSession(anonymousSession);
        setState('anonymous');
      } else {
        setError(apiError);
        setState('unavailable');
      }
    }
  }, []);

  const retryBootstrap = useCallback(async () => {
    setError(null);
    setState('bootstrapping');
    try {
      const bootstrapResult = await withController((signal) => authApi.bootstrap(signal));
      setBootstrap(bootstrapResult);
      await refreshSession();
    } catch (err) {
      const apiError = err instanceof AuthApiError ? err : new AuthApiError({ detail: 'Unable to initialize secure login.' });
      if (apiError.code !== 'AUTH_CANCELLED') setError(apiError);
      setState('unavailable');
    }
  }, [refreshSession, withController]);

  useEffect(() => {
    ensureInstallationId();
    const online = () => { setIsOnline(true); void retryBootstrap(); };
    const offline = () => setIsOnline(false);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    void retryBootstrap();

    return () => {
      activeRequest.current?.abort();
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, [retryBootstrap]);

  const login = useCallback(async (payload: LoginRequest) => {
    setError(null);
    setState('authenticating');
    try {
      const result = await withController((signal) => authApi.login(payload, signal));
      setSession(result);
      setState('authenticated');
    } catch (err) {
      const apiError = err instanceof AuthApiError ? err : new AuthApiError({ detail: 'Sign in failed.' });
      if (apiError.code !== 'AUTH_CANCELLED') setError(apiError);
      setState('anonymous');
      throw apiError;
    }
  }, [withController]);

  const checkPasskeyAvailability = useCallback(async (identifier: string) => {
    setPasskeyAvailable(null);
    if (!identifier.trim() || !bootstrap?.passkeyEnabled || !bootstrap.webAuthnSupported || !isOnline) return;
    try {
      const result = await authApi.passkeyAvailability(identifier.trim());
      setPasskeyAvailable(result.available);
    } catch {
      setPasskeyAvailable(false);
    }
  }, [bootstrap?.passkeyEnabled, bootstrap?.webAuthnSupported, isOnline]);

  const loginWithPasskey = useCallback(async (identifier: string) => {
    setError(null);
    setState('authenticating');
    try {
      const optionsJSON = await withController((signal) => authApi.passkeyAuthenticationOptions(identifier, signal));
      const assertion = await startPasskeyAuthentication(optionsJSON);
      const result = await withController((signal) => authApi.verifyPasskeyAuthentication(assertion, signal));
      setSession(result);
      setState('authenticated');
    } catch (err) {
      const apiError = err instanceof AuthApiError
        ? err
        : new AuthApiError({ code: 'PASSKEY_CANCELLED', detail: 'Face ID / passkey sign-in was cancelled or could not be completed.' });
      if (apiError.code !== 'AUTH_CANCELLED') setError(apiError);
      setState('anonymous');
      throw apiError;
    }
  }, [withController]);

  const cancelAuthentication = useCallback(() => {
    activeRequest.current?.abort();
    setState('anonymous');
  }, []);

  const logout = useCallback(async () => {
    try { await authApi.logout(); } finally {
      setSession(anonymousSession);
      setState('anonymous');
    }
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    state, bootstrap, session, error, isOnline, passkeyAvailable,
    login, loginWithPasskey, checkPasskeyAvailability, cancelAuthentication,
    retryBootstrap, logout, refreshSession,
    clearError: () => setError(null),
  }), [state, bootstrap, session, error, isOnline, passkeyAvailable, login, loginWithPasskey, checkPasskeyAvailability, cancelAuthentication, retryBootstrap, logout, refreshSession]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider.');
  return context;
}
