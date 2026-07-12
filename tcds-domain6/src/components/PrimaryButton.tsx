import { Check, Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';

type Props = PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>> & {
  loading?: boolean;
  success?: boolean;
};

export function PrimaryButton({ children, className = '', loading = false, success = false, disabled, ...props }: Props) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={`tcds-focus enterprise-motion flex min-h-14 w-full items-center justify-center gap-2 rounded-enterprise bg-tcds-black px-5 py-4 font-display text-card font-black text-white shadow-card hover:bg-tcds-charcoal disabled:bg-neutral-300 ${success ? 'bg-tcds-green' : ''} ${className}`}
    >
      {loading && <Loader2 size={18} className="animate-spin" />}
      {success && <Check size={18} />}
      <span>{children}</span>
    </button>
  );
}
