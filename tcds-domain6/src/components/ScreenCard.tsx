import type { PropsWithChildren } from 'react';

export function ScreenCard({ children, className = '' }: PropsWithChildren<{ className?: string }>) {
  return <section className={`rounded-enterprise border border-tcds-line bg-tcds-card p-5 shadow-card ${className}`}>{children}</section>;
}
