import { CheckCircle2, ScanLine } from 'lucide-react';

export function ScanConfirmationCard({ title, instruction, value, expected, onSubmit, disabled }: {
  title: string;
  instruction: string;
  value: string;
  expected?: string;
  onSubmit: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-enterprise border border-tcds-line bg-white p-4 shadow-soft">
      <div className="flex items-center gap-3">
        <span className={`grid h-10 w-10 place-items-center rounded-2xl ${value ? 'bg-tcds-green text-white' : 'bg-tcds-black text-tcds-gold'}`}>
          {value ? <CheckCircle2 size={21} /> : <ScanLine size={21} />}
        </span>
        <div>
          <h3 className="font-display text-card font-black text-tcds-ink">{title}</h3>
          <p className="text-xs font-semibold text-tcds-muted">{instruction}</p>
        </div>
      </div>
      {expected && <p className="mt-3 rounded-xl bg-tcds-surface px-3 py-2 text-xs font-bold text-tcds-muted">Expected: <span className="text-tcds-ink">{expected}</span></p>}
      <form className="mt-3 flex gap-2" onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const barcode = String(form.get('barcode') ?? '').trim();
        if (barcode) onSubmit(barcode);
      }}>
        <input
          name="barcode"
          defaultValue={value}
          disabled={disabled || Boolean(value)}
          autoComplete="off"
          inputMode="text"
          className="tcds-focus min-h-12 min-w-0 flex-1 rounded-2xl border border-tcds-line bg-white px-3 text-base font-bold text-tcds-ink"
          placeholder="Scan or enter barcode"
          aria-label={`${title} barcode`}
        />
        <button disabled={disabled || Boolean(value)} className="tcds-focus enterprise-motion min-h-12 rounded-2xl bg-tcds-black px-4 font-black text-white disabled:bg-neutral-300">Confirm</button>
      </form>
    </div>
  );
}
