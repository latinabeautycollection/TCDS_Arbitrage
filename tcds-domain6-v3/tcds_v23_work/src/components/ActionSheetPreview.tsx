import { ChevronRight } from 'lucide-react';

export function ActionSheetPreview({ title, actions }: { title: string; actions: string[] }) {
  return (
    <div className="rounded-[1.5rem] border border-tcds-line bg-white p-4 shadow-executive">
      <p className="mb-3 text-[10px] font-black uppercase tracking-[0.26em] text-tcds-gold">Bottom Sheet Pattern</p>
      <h3 className="mb-3 font-display text-lg font-black text-tcds-ink">{title}</h3>
      <div className="space-y-2">
        {actions.map((action) => (
          <button key={action} className="tcds-focus enterprise-motion flex min-h-12 w-full items-center justify-between rounded-2xl bg-tcds-surface px-4 py-3 text-left font-black text-tcds-ink">
            {action}<ChevronRight size={18} className="text-tcds-gold" />
          </button>
        ))}
      </div>
    </div>
  );
}
