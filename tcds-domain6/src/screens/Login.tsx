import { LockKeyhole, ScanFace, Smartphone } from 'lucide-react';
import { BrandMark } from '../components/BrandMark';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenCard } from '../components/ScreenCard';
import { SystemReadiness } from '../components/SystemReadiness';
import { brand } from '../config/brand';

export function Login() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 pb-16 pt-8">
      <div className="w-full max-w-md space-y-5">
        <div className="text-center">
          <BrandMark />
          <p className="mt-5 text-xs font-black uppercase tracking-[0.36em] text-tcds-gold">{brand.company}</p>
          <h1 className="mt-2 font-display text-4xl font-black tracking-tight text-tcds-ink">{brand.product}</h1>
          <p className="mt-2 text-sm font-semibold text-tcds-muted">Secure access for registered warehouse iPhones</p>
        </div>

        <ScreenCard className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-black text-tcds-ink">Employee ID</label>
            <input className="tcds-focus w-full rounded-2xl border border-tcds-line bg-tcds-surface px-4 py-4 text-tcds-ink placeholder:text-tcds-muted/50 focus:border-tcds-gold" placeholder="EMP-0001" inputMode="text" autoComplete="username" />
          </div>
          <div>
            <label className="mb-2 block text-sm font-black text-tcds-ink">Password / PIN</label>
            <input type="password" className="tcds-focus w-full rounded-2xl border border-tcds-line bg-tcds-surface px-4 py-4 text-tcds-ink placeholder:text-tcds-muted/50 focus:border-tcds-gold" placeholder="••••••••" autoComplete="current-password" />
          </div>

          <PrimaryButton>Sign In</PrimaryButton>

          <div className="flex items-center gap-3 text-xs font-black uppercase tracking-[0.2em] text-tcds-muted">
            <div className="h-px flex-1 bg-tcds-line" />
            or
            <div className="h-px flex-1 bg-tcds-line" />
          </div>

          <button className="tcds-focus enterprise-motion flex w-full items-center justify-center gap-2 rounded-2xl border border-tcds-line bg-white px-4 py-4 text-sm font-black text-tcds-ink shadow-soft">
            <Smartphone size={18} className="text-tcds-gold" /> Device Sign-In
          </button>
          <button className="tcds-focus enterprise-motion flex w-full items-center justify-center gap-2 rounded-2xl border border-tcds-line bg-white px-4 py-4 text-sm font-black text-tcds-ink shadow-soft">
            <ScanFace size={18} className="text-tcds-gold" /> Face ID / Touch ID
          </button>
        </ScreenCard>

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
