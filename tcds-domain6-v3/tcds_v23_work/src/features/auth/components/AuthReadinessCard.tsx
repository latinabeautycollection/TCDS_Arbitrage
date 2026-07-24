import { CheckCircle2, CircleAlert, Database, KeyRound, Server, ShieldCheck, Wifi, WifiOff } from 'lucide-react';
import type { AuthBootstrap } from '../types/authTypes';

export function AuthReadinessCard({ bootstrap, online }: { bootstrap: AuthBootstrap | null; online: boolean }) {
  const deviceReady = Boolean(bootstrap?.device.registered && bootstrap.device.trusted && bootstrap.device.status === 'ACTIVE');
  const rows = [
    { label: 'Network', ok: online, icon: online ? Wifi : WifiOff },
    { label: 'Authentication API', ok: Boolean(bootstrap?.readiness.api), icon: Server },
    { label: 'PostgreSQL', ok: Boolean(bootstrap?.readiness.database), icon: Database },
    { label: 'Registered Device', ok: deviceReady, icon: ShieldCheck },
    { label: 'Passkey Platform', ok: Boolean(bootstrap?.passkeyEnabled && bootstrap.webAuthnSupported), icon: KeyRound },
  ];

  return (
    <div className="rounded-enterprise border border-tcds-line bg-white p-4 shadow-card" aria-label="Secure login readiness">
      <p className="mb-3 text-xs font-black uppercase tracking-[0.2em] text-tcds-muted">Secure Login Readiness</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {rows.map(({ label, ok, icon: Icon }) => (
          <div key={label} className="flex items-center gap-2 rounded-2xl bg-tcds-surface px-3 py-3 text-xs font-black text-tcds-ink">
            {ok ? <CheckCircle2 size={16} className="text-tcds-green" /> : <CircleAlert size={16} className="text-tcds-warning" />}
            <Icon size={16} className="text-tcds-gold" />
            <span>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
