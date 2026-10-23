import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { authApi, AuthApiError, inCeremony } from '../services/authApi';
import { deviceCredentialStore } from '../storage/deviceCredentialStore';
import { signDeviceNonce } from '../security/deviceProof';
import { authenticateWithPasskey, platformAuthenticatorAvailable, registerPasskey } from '../security/webauthnBrowser';
import { OperationControllers } from '../policy/operationControllers';
import type { AuthSession, AuthState, DeviceEnrollmentProfile, UiBootstrap } from '../types/authTypes';

const anonymous: AuthSession = { authenticated: false, context: null, expiresAt: null, idleExpiresAt: null };

interface Value {
  state: AuthState;
  bootstrap: UiBootstrap | null;
  session: AuthSession;
  error: AuthApiError | null;
  isOnline: boolean;
  login(identifier: string, password: string): Promise<void>;
  loginWithPasskey(identifier: string): Promise<void>;
  enrollPasskey(friendlyName?: string): Promise<void>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
  retryBootstrap(): Promise<void>;
  clearError(): void;
  cancel(): void;
}

export const AuthContext = createContext<Value | null>(null);

// TCDS R11-22: R11's API returns { authenticated, user: {...}, authenticationMethod, restrictedSession, ... } where the
// 6.1D client expected { session: {...} }. Accept both, so a successful login really yields a session context.
const envelope = (x: any): AuthSession => {
  const context = x?.session ?? (x?.user ? {
    ...x.user, authSessionId: '', authenticationMethod: x.authenticationMethod,
    restrictedSession: x.restrictedSession === true, breakGlass: x.breakGlass === true,
  } : null);
  return {
    authenticated: Boolean(context) && x?.authenticated !== false,
    context,
    expiresAt: x?.absoluteExpiresAt ?? null,
    idleExpiresAt: x?.idleExpiresAt ?? null,
  };
};

export function AuthProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<AuthState>('bootstrapping');
  const [bootstrap, setBootstrap] = useState<UiBootstrap | null>(null);
  const [session, setSession] = useState<AuthSession>(anonymous);
  const [error, setError] = useState<AuthApiError | null>(null);
  const [isOnline, setOnline] = useState(navigator.onLine);
  const controllers = useRef(new OperationControllers());

  const profile = useCallback(async (): Promise<DeviceEnrollmentProfile> => {
    const p = await deviceCredentialStore.profile();
    if (!p) {
      throw new AuthApiError(403, {
        error: { code: 'DEVICE_NOT_ENROLLED', message: 'This workstation has not completed secure device enrollment.' },
      });
    }
    return p;
  }, []);

  const retryBootstrap = useCallback(async () => {
    setState('bootstrapping');
    setError(null);
    try {
      const [ready, p, platform] = await Promise.all([
        controllers.current.run('bootstrap', (s) => authApi.ready(s)),
        deviceCredentialStore.profile(),
        platformAuthenticatorAvailable(),
      ]);
      setBootstrap({
        environment: import.meta.env.VITE_APP_ENV ?? 'UNKNOWN',
        releaseVersion: import.meta.env.VITE_APP_VERSION ?? '6.1D-R2',
        serverReady: ready.ready,
        databaseReady: ready.postgres ?? ready.database ?? null,
        redisReady: ready.redis ?? null,
        webAuthnSupported: Boolean(window.PublicKeyCredential && navigator.credentials),
        platformAuthenticatorAvailable: platform,
        deviceEnrolled: Boolean(p),
        deviceProfile: p,
      });

      if (!p) {
        setSession(anonymous);
        setState('anonymous');
        return;
      }

      try {
        const current = await controllers.current.run('session', (s) => authApi.session(s));
        const next = envelope(current);
        setSession(next);
        setState(next.context?.restrictedSession ? 'restricted' : 'authenticated');
      } catch (e) {
        if (e instanceof AuthApiError && [401, 403].includes(e.status)) {
          setSession(anonymous);
          setState('anonymous');
        } else {
          throw e;
        }
      }
    } catch (e) {
      const x = e instanceof AuthApiError
        ? e
        : new AuthApiError(503, { error: { code: 'BOOTSTRAP_FAILED', message: 'Unable to initialize secure login.' } });
      setError(x);
      setState('unavailable');
    }
  }, []);

  useEffect(() => {
    const on = () => { setOnline(true); void retryBootstrap(); };
    const off = () => setOnline(false);
    addEventListener('online', on);
    addEventListener('offline', off);
    void retryBootstrap();
    return () => {
      controllers.current.cancelAll();
      removeEventListener('online', on);
      removeEventListener('offline', off);
    };
  }, [retryBootstrap]);

  const deviceProof = useCallback(async (p: DeviceEnrollmentProfile, signal: AbortSignal) => {
    const secrets = await deviceCredentialStore.secrets();
    if (!secrets?.signingKey) {
      throw new AuthApiError(403, { error: { code: 'DEVICE_KEY_UNAVAILABLE', message: 'Secure device key is unavailable.' } });
    }
    const options = await authApi.deviceProofOptions(p, 'PASSWORD_LOGIN', signal);
    const signature = await signDeviceNonce(options.rawNonce, p, secrets);
    const verified = await authApi.deviceProofVerify(p, options.challengeId, options.rawNonce, signature, signal);
    if (verified.verified !== true || verified.ceremony !== 'DEVICE_PROOF' || verified.challengeId !== options.challengeId) {
      throw new AuthApiError(403, { error: { code: 'DEVICE_PROOF_FAILED', message: 'Device identity could not be verified.' } });
    }
    return verified.evidenceId;
  }, []);

  const login = useCallback(async (identifier: string, password: string) => {
    setError(null);
    setState('device-proof');
    try {
      const p = await profile();
      const result = await controllers.current.run('authentication', (signal) => inCeremony(async () => {
        const evidenceId = await deviceProof(p, signal);
        setState('authenticating');
        return authApi.passwordLogin(p, identifier, password, evidenceId, signal);
      }));
      const next = envelope(result);
      setSession(next);
      setState(next.context?.restrictedSession ? 'restricted' : 'authenticated');
    } catch (e) {
      const x = e instanceof AuthApiError
        ? e
        : new AuthApiError(401, { error: { code: 'AUTHENTICATION_FAILED', message: 'The credentials or access context could not be verified.' } });
      if (x.code !== 'AUTH_CANCELLED') setError(x);
      setSession(anonymous);
      setState('anonymous');
      throw x;
    }
  }, [deviceProof, profile]);

  const loginWithPasskey = useCallback(async (identifier: string) => {
    setError(null);
    setState('authenticating');
    try {
      const p = await profile();
      const result = await controllers.current.run('authentication', (signal) => inCeremony(async () => {
        const options = await authApi.passkeyAuthenticationOptions(p, identifier, signal);
        const response = await authenticateWithPasskey(options.options);
        return authApi.passkeyAuthenticationVerify(p, options.challengeId, response, signal);
      }));
      setSession(envelope(result));
      setState('authenticated');
    } catch (e) {
      const x = e instanceof AuthApiError
        ? e
        : new AuthApiError(401, { error: { code: 'PASSKEY_CANCELLED', message: 'Passkey verification was cancelled or could not be completed.' } });
      if (x.code !== 'AUTH_CANCELLED') setError(x);
      setSession(anonymous);
      setState('anonymous');
      throw x;
    }
  }, [profile]);

  const enrollPasskey = useCallback(async (friendlyName?: string) => {
    setError(null);
    try {
      const p = await profile();
      await controllers.current.run('authentication', (signal) => inCeremony(async () => {
        const options = await authApi.passkeyRegistrationOptions(p, signal);
        const response = await registerPasskey(options.options);
        const verified = await authApi.passkeyRegistrationVerify(p, options.challengeId, response, friendlyName, signal);
        if (!verified.verified || verified.challengeId !== options.challengeId) {
          throw new AuthApiError(409, { error: { code: 'PASSKEY_ENROLLMENT_FAILED', message: 'Passkey enrollment could not be verified.' } });
        }
      }));
    } catch (e) {
      const x = e instanceof AuthApiError
        ? e
        : new AuthApiError(409, { error: { code: 'PASSKEY_ENROLLMENT_FAILED', message: 'Passkey enrollment could not be completed.' } });
      setError(x);
      throw x;
    }
  }, [profile]);

  const logout = useCallback(async () => {
    try {
      await controllers.current.run('session', (s) => authApi.logout(s));
    } finally {
      setSession(anonymous);
      setState('anonymous');
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const current = await controllers.current.run('session', (s) => authApi.session(s));
      const next = envelope(current);
      setSession(next);
      setState(next.context?.restrictedSession ? 'restricted' : 'authenticated');
    } catch {
      setSession(anonymous);
      setState('anonymous');
    }
  }, []);

  const value = useMemo<Value>(() => ({
    state,
    bootstrap,
    session,
    error,
    isOnline,
    login,
    loginWithPasskey,
    enrollPasskey,
    logout,
    refresh,
    retryBootstrap,
    clearError: () => setError(null),
    cancel: () => controllers.current.cancel('authentication'),
  }), [state, bootstrap, session, error, isOnline, login, loginWithPasskey, enrollPasskey, logout, refresh, retryBootstrap]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const x = useContext(AuthContext);
  if (!x) throw new Error('useAuth must be used within AuthProvider');
  return x;
};
