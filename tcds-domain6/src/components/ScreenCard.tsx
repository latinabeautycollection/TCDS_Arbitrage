import type { PropsWithChildren } from 'react';

export function ScreenCard({ children, className = '' }: PropsWithChildren<{ className?: string }>) {
  return <section className={`rounded-executive border border-tcds-line bg-tcds-card p-5 shadow-executive ${className}`}>{children}</section>;
}
