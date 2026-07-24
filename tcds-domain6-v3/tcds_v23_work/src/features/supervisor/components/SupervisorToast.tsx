import { CheckCircle2, X } from 'lucide-react';
export function SupervisorToast({ message, onClose }: { message: string; onClose: () => void }) {
  return <div role="status" aria-live="polite" className="fixed bottom-28 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-start gap-3 rounded-enterprise border border-emerald-200 bg-white p-4 shadow-card">
    <CheckCircle2 className="mt-0.5 text-tcds-green" size={20}/><p className="flex-1 text-sm font-black text-tcds-ink">{message}</p><button onClick={onClose} aria-label="Dismiss notification" className="tcds-focus rounded-lg p-1"><X size={16}/></button>
  </div>;
}
