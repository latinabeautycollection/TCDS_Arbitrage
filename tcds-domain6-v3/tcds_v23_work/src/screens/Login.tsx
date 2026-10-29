import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Eye, EyeOff, KeyRound, LockKeyhole, RefreshCw, ScanFace, ShieldCheck, Smartphone, XCircle } from 'lucide-react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { BrandMark } from '../components/BrandMark';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenCard } from '../components/ScreenCard';
import { brand } from '../config/brand';
import { AuthReadinessCard } from '../features/auth/components/AuthReadinessCard';
import { LoginErrorBanner } from '../features/auth/components/LoginErrorBanner';
import { useAuth } from '../features/auth/context/AuthContext';

// Face ID offer: remembered per user on this device ('on' = enrolled here, 'skip' = declined).
const faceIdKey = (userId: string) => `tcds.faceid.${userId}`;
const faceIdChoice = (userId: string) => { try { return localStorage.getItem(faceIdKey(userId)); } catch { return null; } };
const rememberFaceId = (userId: string, choice: 'on' | 'skip') => { try { localStorage.setItem(faceIdKey(userId), choice); } catch { /* private mode */ } };

// Login V2 sign-in screen: the app's original design, driven by the 6.1D auth context.
export function Login() {
  const identifierId = useId();
  const passwordId = useId();
  const navigate = useNavigate();
  const location = useLocation();
  const { state, session, bootstrap, error, isOnline, login, loginWithPasskey, enrollPasskey, cancel, retryBootstrap, clearError } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const passwordSignIn = useRef(false);

  const redirectTo = (location.state as { from?: string } | null)?.from ?? '/dashboard';
  const signingIn = state === 'authenticating' || state === 'device-proof';
  const busy = signingIn || state === 'bootstrapping';
  const deviceReady = bootstrap?.deviceEnrolled === true;
  const showPasskeyButton = Boolean(deviceReady && bootstrap?.webAuthnSupported && bootstrap?.platformAuthenticatorAvailable && isOnline);
  const profile = bootstrap?.deviceProfile ?? null;
  const faceIdUser = session?.context?.userId || identifier.trim().toLowerCase();

  // Straight after a password sign-in on this screen, offer Face ID once on a phone that supports it. Decided during render:
  // the redirect below runs in the same render that sees the new session, so an effect would be too late.
  const offerFaceId = Boolean(session?.authenticated && passwordSignIn.current && !session.context?.restrictedSession
    && bootstrap?.webAuthnSupported && bootstrap?.platformAuthenticatorAvailable && isOnline && !faceIdChoice(faceIdUser));

  // The device check runs when the app starts; re-check on arrival (e.g. straight after Device setup).
  useEffect(() => {
    if (bootstrap && !bootstrap.deviceEnrolled) void retryBootstrap();
  }, []);

  async function turnOnFaceId() {
    clearError();
    setEnrolling(true);
    try {
      await enrollPasskey(`${brand.product} on this device`);
      rememberFaceId(faceIdUser, 'on');
      navigate(redirectTo, { replace: true });
    } catch { /* rendered by context; the user can retry or skip */ }
    finally { setEnrolling(false); }
  }

  function skipFaceId() {
    clearError();
    rememberFaceId(faceIdUser, 'skip');
    navigate(redirectTo, { replace: true });
  }

  if (session?.authenticated && offerFaceId) {
    return (
      <div className="safe-top safe-bottom flex min-h-[100dvh] items-center justify-center px-4 py-8">
        <div className="w-full max-w-md space-y-5">
          <header className="text-center">
            <BrandMark />
            <h1 className="mt-5 font-display text-3xl font-black tracking-tight text-tcds-ink">Turn on Face ID?</h1>
            <p className="mt-2 text-sm font-semibold text-tcds-muted">Sign in next time with a glance instead of typing your password.</p>
          </header>
          {error && <LoginErrorBanner error={error} onDismiss={clearError} />}
          <ScreenCard>
            <div className="flex items-start gap-3 text-sm font-semibold text-tcds-muted">
              <ScanFace className="mt-1 shrink-0 text-tcds-gold" size={22} />
              <p>Face ID stays on this phone. Your face is never sent to TCDS. You can still sign in with your password at any time.</p>
            </div>
            <div className="mt-5 space-y-2">
              <PrimaryButton type="button" onClick={() => void turnOnFaceId()} loading={enrolling} disabled={enrolling || !isOnline}>
                {enrolling ? 'Setting Up Face ID…' : 'Turn On Face ID'}
              </PrimaryButton>
              <button type="button" onClick={skipFaceId} disabled={enrolling} className="tcds-focus flex min-h-12 w-full items-center justify-center rounded-xl text-sm font-black text-tcds-muted disabled:opacity-50">
                Not now
              </button>
            </div>
          </ScreenCard>
        </div>
      </div>
    );
  }

  if (session?.authenticated) return <Navigate to={redirectTo} replace />;

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearError();
    if (!identifier.trim() || !password) return;
    passwordSignIn.current = true;
    try { await login(identifier.trim(), password); } catch { passwordSignIn.current = false; /* rendered by context */ }
  }

  async function submitPasskey() {
    clearError();
    if (!identifier.trim()) return;
    passwordSignIn.current = false;
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

        {bootstrap && !deviceReady && (
          <ScreenCard className="border-amber-300 bg-amber-50">
            <div className="flex items-start gap-3">
              <Smartphone className="mt-1 shrink-0 text-amber-700" size={22} />
              <div className="space-y-3">
                <p className="font-display text-lg font-black text-tcds-ink">Set up this device first</p>
                <p className="text-sm font-semibold text-amber-900">Sign-in only works on an approved warehouse device. This device has not been set up yet.</p>
                <Link to="/device-setup" className="tcds-focus inline-flex min-h-12 items-center justify-center rounded-2xl bg-tcds-black px-5 font-display font-black text-white">
                  Set up this device
                </Link>
              </div>
            </div>
          </ScreenCard>
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
                  disabled={busy}
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

            <PrimaryButton type="submit" loading={signingIn} disabled={!isOnline || !deviceReady || !identifier.trim() || !password || state === 'unavailable'}>
              {state === 'device-proof' ? 'Verifying Device…' : state === 'authenticating' ? 'Signing You In…' : 'Sign In Securely'}
            </PrimaryButton>

            <div className="text-right">
              <Link to="/auth/recovery" className="tcds-focus inline-flex min-h-11 items-center rounded-xl text-sm font-black text-tcds-gold underline underline-offset-4">
                Forgot password?
              </Link>
            </div>

            {signingIn && (
              <button type="button" onClick={cancel} className="tcds-focus flex min-h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-black text-tcds-muted">
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
            First-time employees sign in with a password, then enroll Face ID or a passkey from their account.
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
          <p className="break-all">Device {profile?.deviceId ?? 'not set up'}</p>
          {profile && <p><Link to="/device-setup" className="underline">Device setup</Link></p>}
        </footer>
      </div>
    </div>
  );
}
