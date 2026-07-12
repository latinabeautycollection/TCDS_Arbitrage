import { brand } from '../config/brand';

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center justify-center">
      <img
        src="/tcds-enterprise-logo.webp"
        alt={`${brand.legalName} logo`}
        className={compact
          ? 'h-11 w-[9.75rem] rounded-xl border border-tcds-gold/25 bg-tcds-black object-cover object-center shadow-soft'
          : 'mx-auto h-auto w-[18rem] max-w-full rounded-[1.35rem] border border-tcds-gold/30 bg-tcds-black object-cover shadow-gold'}
      />
    </div>
  );
}
