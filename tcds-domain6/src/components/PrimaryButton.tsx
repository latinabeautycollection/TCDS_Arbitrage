import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';

export function PrimaryButton({ children, className = '', ...props }: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>>) {
  return <button {...props} className={`tcds-focus enterprise-motion w-full rounded-2xl bg-tcds-black px-5 py-4 font-display text-base font-black tracking-tight text-white shadow-soft hover:bg-tcds-charcoal ${className}`}>{children}</button>;
}
