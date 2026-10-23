import { CheckCircle2, CircleAlert, CircleHelp, Database, KeyRound, Server, ShieldCheck, Wifi, WifiOff } from 'lucide-react';
import type { UiBootstrap } from '../types/authTypes';
import { readinessState, type ReadinessState } from '../policy/readinessPolicy';

function StateIcon({ state }: { state: ReadinessState }) {
  if (state === 'HEALTHY') return <CheckCircle2 size={16} className="text-tcds-green" aria-label="Healthy" />;
  if (state === 'DEGRADED') return <CircleAlert size={16} className="text-tcds-red" aria-label="Degraded" />;
  return <CircleHelp size={16} className="text-tcds-warning" aria-label="Unknown" />;
}

export function AuthReadinessCard({ bootstrap, online }: { bootstrap: UiBootstrap | null; online: boolean }) {
  const rows = [
    { label: 'Network', state: readinessState(online), icon: online ? Wifi : WifiOff },
    { label: 'Authentication API', state: readinessState(bootstrap?.serverReady), icon: Server },
    { label: 'PostgreSQL', state: readinessState(bootstrap?.databaseReady), icon: Database },
    { label: 'Rate Limit Store', state: readinessState(bootstrap?.redisReady), icon: Server },
    { label: 'Approved Device', state: readinessState(bootstrap?.deviceEnrolled), icon: ShieldCheck },
    { label: 'WebAuthn', state: readinessState(bootstrap?.webAuthnSupported), icon: KeyRound },
  ];
  return <div className="rounded-enterprise border border-tcds-line bg-white p-4 shadow-card" aria-label="Secure login readiness">
    <div className="mb-3 flex items-center justify-between gap-3">
      <p className="text-xs font-black uppercase tracking-[0.2em] text-tcds-muted">Secure Login Readiness</p>
      <span className="text-[10px] font-bold text-tcds-muted">Green = verified · Amber = unknown · Red = degraded</span>
    </div>
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {rows.map(({ label, state, icon: Icon }) => <div key={label} className="flex items-center gap-2 rounded-2xl bg-tcds-surface px-3 py-3 text-xs font-black text-tcds-ink">
        <StateIcon state={state} /><Icon size={16} className="text-tcds-gold" /><span>{label}</span><span className="ml-auto text-[10px] text-tcds-muted">{state}</span>
      </div>)}
    </div>
  </div>;
}
