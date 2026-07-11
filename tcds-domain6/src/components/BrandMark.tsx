import { brand } from '../config/brand';

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center justify-center gap-3">
      <img
        src="/tcds-logo.svg"
        alt="TCDS"
        className={`${compact ? 'h-11 w-11 rounded-2xl' : 'mx-auto h-24 w-24 rounded-[2rem]'} border border-tcds-gold/35 bg-tcds-black shadow-gold`}
      />
      {compact && (
        <div className="leading-tight">
          <p className="font-display text-xl font-black tracking-tight text-tcds-ink">{brand.company}</p>
          <p className="text-[9px] font-black uppercase tracking-[0.22em] text-tcds-gold">Warehouse</p>
        </div>
      )}
    </div>
  );
}
