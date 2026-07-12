import { Bell, HelpCircle, Menu } from 'lucide-react';
import { BrandMark } from './BrandMark';

export function AppHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="safe-top sticky top-0 z-10 border-b border-tcds-line bg-white/92 px-4 py-3 backdrop-blur-2xl">
      <div className="mx-auto flex max-w-md items-center justify-between gap-3">
        <button className="tcds-focus enterprise-motion rounded-enterprise border border-tcds-line bg-white p-2.5 text-tcds-ink shadow-surface" aria-label="Open menu"><Menu size={20} /></button>
        <BrandMark compact />
        <div className="flex items-center gap-2">
          <button className="tcds-focus enterprise-motion rounded-enterprise border border-tcds-line bg-white p-2.5 text-tcds-gold shadow-surface" aria-label="Open help"><HelpCircle size={19} /></button>
          <button className="tcds-focus enterprise-motion relative rounded-enterprise border border-tcds-line bg-white p-2.5 text-tcds-ink shadow-surface" aria-label="Open notifications"><Bell size={19} /><span className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-tcds-gold text-[10px] font-black text-white">3</span></button>
        </div>
      </div>
      <div className="page-gold-rule mx-auto max-w-md pt-5">
        <p className="text-caption font-black uppercase tracking-[0.30em] text-tcds-gold">Domain 6</p>
        <h1 className="mt-1 font-display text-page font-black text-tcds-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-body font-medium text-tcds-muted">{subtitle}</p>}
      </div>
    </header>
  );
}
