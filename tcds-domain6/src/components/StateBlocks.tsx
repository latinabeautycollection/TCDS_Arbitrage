import { AlertTriangle, CheckCircle2, CloudOff, Loader2, PackageOpen } from 'lucide-react';

export function LoadingSkeleton({ label = 'Loading warehouse data…' }: { label?: string }) {
  return (
    <div className="rounded-2xl border border-tcds-line bg-white p-4 shadow-soft" aria-label={label}>
      <div className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-tcds-muted">
        <Loader2 size={14} className="animate-spin text-tcds-gold" /> {label}
      </div>
      <div className="space-y-2">
        <div className="skeleton h-5 rounded-full" />
        <div className="skeleton h-5 w-10/12 rounded-full" />
        <div className="skeleton h-5 w-7/12 rounded-full" />
      </div>
    </div>
  );
}

export function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-tcds-strongLine bg-white p-5 text-center shadow-soft">
      <PackageOpen className="mx-auto text-tcds-gold" size={30} />
      <p className="mt-3 font-display text-lg font-black text-tcds-ink">{title}</p>
      <p className="mt-1 text-sm font-semibold text-tcds-muted">{message}</p>
    </div>
  );
}

export function ErrorState({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-2xl border border-tcds-red/20 bg-red-50 p-4 shadow-soft">
      <div className="flex gap-3">
        <AlertTriangle className="shrink-0 text-tcds-red" size={22} />
        <div>
          <p className="font-display font-black text-tcds-ink">{title}</p>
          <p className="mt-1 text-sm font-semibold text-tcds-muted">{message}</p>
        </div>
      </div>
    </div>
  );
}

export function OfflineState() {
  return (
    <div className="rounded-2xl border border-tcds-warning/25 bg-amber-50 p-4 shadow-soft">
      <div className="flex items-center gap-3">
        <CloudOff className="text-tcds-warning" size={22} />
        <div>
          <p className="font-display font-black text-tcds-ink">Offline-safe mode</p>
          <p className="text-sm font-semibold text-tcds-muted">Scans, photos, and receiving drafts can queue. Label purchase is blocked until online.</p>
        </div>
      </div>
    </div>
  );
}

export function SuccessToastPreview({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-tcds-green/20 bg-emerald-50 p-4 shadow-soft">
      <div className="flex items-center gap-3">
        <CheckCircle2 className="text-tcds-green" size={22} />
        <p className="font-display font-black text-tcds-ink">{message}</p>
      </div>
    </div>
  );
}
