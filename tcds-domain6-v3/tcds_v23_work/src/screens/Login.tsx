import { useEffect, useId, useState, type FormEvent } from 'react';
import { Eye, EyeOff, KeyRound, LockKeyhole, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { BrandMark } from '../components/BrandMark';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenCard } from '../components/ScreenCard';
import { brand } from '../config/brand';
import { AuthReadinessCard } from '../features/auth/components/AuthReadinessCard';
import { LoginErrorBanner } from '../features/auth/components/LoginErrorBanner';
import { useAuth } from '../features/auth/context/AuthContext';

export function Login() {
  const identifierId = useId();
  const passwordId = useId();
  const navigate = useNavigate();
  const location = useLocation();
  const {
    state, session, bootstrap, error, isOnline, passkeyAvailable,
    login, loginWithPasskey, checkPasskeyAvailability,
    cancelAuthentication, retryBootstrap, clearError,
  } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const redirectTo = (location.state as { from?: string } | null)?.from ?? '/dashboard';
  const busy = state === 'authenticating' || state === 'bootstrapping';
  const passwordAllowed = bootstrap?.passwordEnabled !== false;
  const platformReady = Boolean(
    bootstrap?.passkeyEnabled &&
    bootstrap.webAuthnSupported &&
    bootstrap.device.registered &&
    bootstrap.device.trusted &&
    bootstrap.device.status === 'ACTIVE' &&
    isOnline
  );
  const showPasskeyButton = platformReady && passkeyAvailable === true;

  useEffect(() => {
    if (session?.authenticated) navigate(redirectTo, { replace: true });
  }, [session?.authenticated, navigate, redirectTo]);

  if (session?.authenticated) return <Navigate to={redirectTo} replace />;

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearError();
    if (!identifier.trim() || !password) return;
    try { await login({ identifier: identifier.trim(), password }); } catch { /* rendered by context */ }
  }

  async function submitPasskey() {
    clearError();
    if (!identifier.trim()) return;
    try { await loginWithPasskey(identifier.trim()); } catch { /* rendered by context */ }
  }

  return (
    <div className="safe-top safe-bottom flex min-h-[100dvh] items-center justify-center px-4 py-8">
      <div className="w-full max-w-md space-y-5">
        <header className="text-center">
          <BrandMark />
          <p className="mt-5 text-xs font-black uppercase tracking-[0.36em] text-tcds-gold">{brand.company}</p>
          <h1 className="mt-2 font-display text-4xl font-black tracking-tight text-tcds-ink">{brand.product}</h1>
          <p className="mt-2 text-sm font-semibold text-tcds-muted">Secure warehouse identity access</p>
        </header>

        {!isOnline && (
          <div role="status" className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm font-bold text-amber-900">
            Offline mode: the application shell remains available, but new sign-ins require a secure server connection.
          </div>
        )}

        {error && <LoginErrorBanner error={error} onDismiss={clearError} />}

        {state === 'unavailable' && (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm font-semibold text-amber-900" role="status">
            <p className="font-black">Secure login is temporarily unavailable.</p>
            <button type="button" onClick={() => void retryBootstrap()} disabled={!isOnline} className="tcds-focus mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl border border-amber-400 bg-white px-4 font-black disabled:opacity-50">
              <RefreshCw size={17} /> Retry secure connection
            </button>
          </div>
        )}

        <ScreenCard>
          <form className="space-y-4" onSubmit={submitPassword} noValidate>
            <div>
              <label htmlFor={identifierId} className="mb-2 block text-sm font-black text-tcds-ink">Username or Employee Number</label>
              <input
                id={identifierId}
                name="username"
                value={identifier}
                onChange={(event) => { setIdentifier(event.target.value); clearError(); }}
                onBlur={() => void checkPasskeyAvailability(identifier)}
                className="tcds-focus min-h-14 w-full rounded-2xl border border-tcds-line bg-tcds-surface px-4 py-4 text-[16px] font-semibold text-tcds-ink placeholder:text-tcds-muted/50 focus:border-tcds-gold"
                placeholder="EMP-0001"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="username webauthn"
                enterKeyHint="next"
                inputMode="text"
                disabled={busy}
                required
              />
            </div>

            <div>
              <label htmlFor={passwordId} className="mb-2 block text-sm font-black text-tcds-ink">Password</label>
              <div className="relative">
                <input
                  id={passwordId}
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => { setPassword(event.target.value); clearError(); }}
                  className="tcds-focus min-h-14 w-full rounded-2xl border border-tcds-line bg-tcds-surface px-4 py-4 pr-14 text-[16px] font-semibold text-tcds-ink placeholder:text-tcds-muted/50 focus:border-tcds-gold"
                  placeholder="Enter password"
                  autoComplete="current-password"
                  enterKeyHint="go"
                  disabled={busy || !passwordAllowed}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  className="tcds-focus absolute inset-y-0 right-1 flex min-h-12 min-w-12 items-center justify-center rounded-xl text-tcds-muted"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>

            <PrimaryButton type="submit" loading={state === 'authenticating'} disabled={!isOnline || !passwordAllowed || !identifier.trim() || !password || state === 'unavailable'}>
              {state === 'authenticating' ? 'Signing You In…' : 'Sign In Securely'}
            </PrimaryButton>

            {state === 'authenticating' && (
              <button type="button" onClick={cancelAuthentication} className="tcds-focus flex min-h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-black text-tcds-muted">
                <XCircle size={17} /> Cancel sign-in
              </button>
            )}
          </form>

          {showPasskeyButton && (
            <>
              <div className="my-5 flex items-center gap-3 text-xs font-black uppercase tracking-[0.2em] text-tcds-muted" aria-hidden="true">
                <div className="h-px flex-1 bg-tcds-line" />or<div className="h-px flex-1 bg-tcds-line" />
              </div>
              <button
                type="button"
                onClick={submitPasskey}
                disabled={busy || !identifier.trim()}
                className="tcds-focus enterprise-motion flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl border border-tcds-line bg-white px-4 py-4 text-sm font-black text-tcds-ink shadow-soft disabled:cursor-not-allowed disabled:opacity-50"
              >
                <KeyRound size={19} className="text-tcds-gold" /> Continue with Face ID / Passkey
              </button>
            </>
          )}

          <p className="mt-4 text-center text-xs font-semibold text-tcds-muted">
            {showPasskeyButton
              ? 'A passkey is available for this account on an approved device.'
              : 'First-time employees sign in with a password, then enroll Face ID or a passkey from their authenticated account.'}
          </p>
        </ScreenCard>

        <AuthReadinessCard bootstrap={bootstrap} online={isOnline} />

        <ScreenCard>
          <div className="flex items-start gap-3 text-sm text-tcds-muted">
            <LockKeyhole className="mt-1 shrink-0 text-tcds-gold" size={18} />
            <div>
              <p className="font-display font-black text-tcds-ink">Authorized Personnel Only</p>
              <p>Use is restricted to approved TCDS personnel. Access attempts may be monitored, logged, and audited.</p>
              <p className="mt-2 font-bold">{brand.supportLabel} for access or password-reset assistance.</p>
            </div>
          </div>
        </ScreenCard>

        <footer className="space-y-1 text-center text-xs font-semibold text-tcds-muted">
          <p className="flex items-center justify-center gap-1"><ShieldCheck size={14} className="text-tcds-gold" /> Secure session · HttpOnly cookie · No browser token storage</p>
          <p>Version {bootstrap?.releaseVersion ?? brand.version} · {bootstrap?.environment ?? import.meta.env.VITE_APP_ENV ?? 'UNKNOWN'}</p>
          <p className="break-all">Device {bootstrap?.device.deviceId ?? localStorage.getItem('tcds.device.installationId') ?? 'unregistered'}</p>
          <p>{bootstrap?.device.facilityCode ?? 'Facility unassigned'} · {bootstrap?.device.stationCode ?? 'Station unassigned'}</p>
        </footer>
      </div>
    </div>
  );
}
