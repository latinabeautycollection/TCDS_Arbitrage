import { CheckCircle2, Info, X } from 'lucide-react';
export function PackShipToast({ title, detail, onDismiss }: { title: string; detail?: string; onDismiss: () => void }) {
  return <div role="status" aria-live="polite" className="fixed left-1/2 top-[calc(1rem+env(safe-area-inset-top))] z-[60] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-2xl border border-tcds-line bg-white p-4 shadow-2xl"><div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 shrink-0 text-tcds-green" size={20}/><div className="min-w-0 flex-1"><p className="font-black text-tcds-ink">{title}</p>{detail && <p className="mt-1 text-sm text-tcds-muted">{detail}</p>}</div><button onClick={onDismiss} aria-label="Dismiss notification"><X size={17}/></button></div></div>;
}
