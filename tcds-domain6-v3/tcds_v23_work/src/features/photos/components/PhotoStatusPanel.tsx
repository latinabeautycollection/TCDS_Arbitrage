import { AlertTriangle, Cloud, Database, ShieldCheck, Wifi, WifiOff } from 'lucide-react';
import type { PhotoSession } from '../types/photoTypes';

export function PhotoStatusPanel({ session, localCount }: { session: PhotoSession; localCount: number }) {
  const c = session.connectivity;
  const rows = [
    ['Network', c.online, c.online ? 'Online' : 'Offline capture only'],
    ['R2 primary', c.r2PrimaryAvailable, c.r2PrimaryAvailable ? 'Available' : 'Fallback route required'],
    ['API fallback', c.apiFallbackAvailable, c.apiFallbackAvailable ? 'Available' : 'Unavailable'],
    ['PostgreSQL', c.databaseAvailable, c.databaseAvailable ? 'Ready' : 'Commit blocked'],
    ['AI verification', c.assessmentAvailable, c.assessmentAvailable ? 'Ready' : 'Assessment delayed'],
  ] as const;
  return <section className="rounded-enterprise border border-tcds-line bg-white p-4 shadow-card">
    <div className="mb-3 flex items-center justify-between"><h2 className="font-display text-card font-black text-tcds-ink">Evidence Readiness</h2><span className="rounded-full bg-tcds-gold/10 px-3 py-1 text-xs font-black text-tcds-goldDeep">{localCount} local recovery</span></div>
    <div className="space-y-2">{rows.map(([name, ok, text]) => <div key={name} className="flex items-center justify-between rounded-xl bg-tcds-surface px-3 py-2 text-sm"><span className="flex items-center gap-2 font-bold text-tcds-ink">{name === 'Network' ? ok ? <Wifi size={15}/> : <WifiOff size={15}/> : name === 'PostgreSQL' ? <Database size={15}/> : name.includes('R2') ? <Cloud size={15}/> : name.includes('AI') ? <ShieldCheck size={15}/> : <AlertTriangle size={15}/>} {name}</span><span className={ok ? 'font-black text-tcds-green' : 'font-black text-tcds-warning'}>{text}</span></div>)}</div>
  </section>;
}
