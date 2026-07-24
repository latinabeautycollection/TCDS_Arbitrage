import { CloudOff, ShieldCheck } from 'lucide-react';
export function OfflineRecoveryBanner({ online, queueCount }: { online: boolean; queueCount: number }) {
  if (online && queueCount === 0) return null;
  return <div className={`rounded-enterprise border p-4 ${online ? 'border-amber-200 bg-amber-50' : 'border-red-200 bg-red-50'}`} role="status">
    <div className="flex gap-3">{online ? <ShieldCheck className="text-tcds-warning"/> : <CloudOff className="text-tcds-red"/>}<div><p className="font-black text-tcds-ink">{online ? 'Recovery queue pending' : 'Offline — completion blocked'}</p><p className="mt-1 text-xs font-semibold text-tcds-muted">{queueCount} operation{queueCount === 1 ? '' : 's'} preserved on this device. Scans can be retained, but capacity and concurrency must be revalidated online before inventory is committed.</p></div></div>
  </div>;
}
