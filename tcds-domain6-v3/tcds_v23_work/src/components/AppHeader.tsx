import { useEffect, useRef, useState } from 'react';
import { Bell, HelpCircle, LogOut, Menu, UserRound, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { BrandMark } from './BrandMark';
import { useAuth } from '../features/auth/context/AuthContext';

// TCDS Login V2: the menu button opens the account menu (signed-in user + Sign out).
function AccountMenu() {
  const { session, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  async function signOut() {
    setSigningOut(true);
    await logout().catch(() => {});
    navigate('/', { replace: true });
  }

  const who = session?.context?.employeeNumber;
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((v) => !v)} className="tcds-focus enterprise-motion rounded-enterprise border border-tcds-line bg-white p-2.5 text-tcds-ink shadow-surface" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} aria-haspopup="menu">
        {open ? <X size={20} /> : <Menu size={20} />}
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-full z-20 mt-2 w-64 rounded-enterprise border border-tcds-line bg-white p-2 shadow-card">
          <div className="flex items-center gap-3 px-3 py-3">
            <UserRound size={20} className="shrink-0 text-tcds-gold" />
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-tcds-muted">Signed in</p>
              <p className="truncate text-sm font-black text-tcds-ink">{who ?? 'Warehouse user'}</p>
            </div>
          </div>
          <div className="my-1 h-px bg-tcds-line" />
          <button role="menuitem" onClick={() => void signOut()} disabled={signingOut} className="tcds-focus flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-black text-red-700 hover:bg-red-50 disabled:opacity-50">
            <LogOut size={18} /> {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      )}
    </div>
  );
}

export function AppHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="safe-top sticky top-0 z-10 border-b border-tcds-line bg-white/92 px-4 py-3 backdrop-blur-2xl">
      <div className="mx-auto flex max-w-md items-center justify-between gap-3">
        <AccountMenu />
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
