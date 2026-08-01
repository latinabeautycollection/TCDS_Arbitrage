import { useState } from 'react';
import { ArrowLeft, LockKeyhole, ScanFace } from 'lucide-react';
import { BrandMark } from '../components/BrandMark';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenCard } from '../components/ScreenCard';
import { SystemReadiness } from '../components/SystemReadiness';
import { brand } from '../config/brand';

export function Login() {
  const [step, setStep] = useState<'credentials' | 'passkey'>('credentials');

  return (
    <div className="flex min-h-screen items-center justify-center px-4 pb-16 pt-8">
      <div className="w-full max-w-md space-y-5">
        <div className="text-center">
          <BrandMark />
          <p className="mt-5 text-xs font-black uppercase tracking-[0.36em] text-tcds-gold">{brand.company}</p>
          <h1 className="mt-2 font-display text-4xl font-black tracking-tight text-tcds-ink">{brand.product}</h1>
          <p className="mt-2 text-sm font-semibold text-tcds-muted">Secure access for registered warehouse iPhones</p>
        </div>

        <div className="flex items-center justify-center gap-2 text-xs font-black uppercase tracking-[0.2em]">
          <span className={step === 'credentials' ? 'text-tcds-gold' : 'text-tcds-muted'}>1 · Credentials</span>
          <div className="h-px w-6 bg-tcds-line" />
          <span className={step === 'passkey' ? 'text-tcds-gold' : 'text-tcds-muted'}>2 · Face ID</span>
        </div>

        {step === 'credentials' ? (
          <ScreenCard className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-black text-tcds-ink">Username</label>
              <input className="tcds-focus w-full rounded-2xl border border-tcds-line bg-tcds-surface px-4 py-4 text-tcds-ink placeholder:text-tcds-muted/50 focus:border-tcds-gold" placeholder="warehouse.username" inputMode="text" autoComplete="username" />
            </div>
            <div>
              <label className="mb-2 block text-sm font-black text-tcds-ink">Password</label>
              <input type="password" className="tcds-focus w-full rounded-2xl border border-tcds-line bg-tcds-surface px-4 py-4 text-tcds-ink placeholder:text-tcds-muted/50 focus:border-tcds-gold" placeholder="••••••••" autoComplete="current-password" />
            </div>
            <PrimaryButton onClick={() => setStep('passkey')}>Continue</PrimaryButton>
            <p className="text-center text-xs font-semibold text-tcds-muted">Face ID verification on your registered iPhone is required after your password.</p>
          </ScreenCard>
        ) : (
          <ScreenCard className="space-y-4 text-center">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-tcds-line bg-tcds-surface">
              <ScanFace size={40} className="text-tcds-gold" />
            </div>
            <div>
              <p className="font-display text-xl font-black text-tcds-ink">Confirm it's you</p>
              <p className="mt-1 text-sm font-semibold text-tcds-muted">Authenticate with Face ID on your registered warehouse iPhone to finish signing in.</p>
            </div>
            <PrimaryButton>Authenticate with Face ID</PrimaryButton>
            <button onClick={() => setStep('credentials')} className="tcds-focus enterprise-motion flex w-full items-center justify-center gap-2 rounded-2xl border border-tcds-line bg-white px-4 py-4 text-sm font-black text-tcds-ink shadow-soft">
              <ArrowLeft size={18} className="text-tcds-gold" /> Back
            </button>
          </ScreenCard>
        )}

        <SystemReadiness />

        <ScreenCard>
          <div className="flex items-start gap-3 text-sm text-tcds-muted">
            <LockKeyhole className="mt-1 text-tcds-gold" size={18} />
            <div>
              <p className="font-display font-black text-tcds-ink">Need Help?</p>
              <p>{brand.supportLabel}. Password resets are handled by the warehouse administrator.</p>
            </div>
          </div>
        </ScreenCard>

        <p className="text-center text-xs font-semibold text-tcds-muted">Version {brand.version} · {brand.buildName}</p>
      </div>
    </div>
  );
}
