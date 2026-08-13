'use client';

import { Lock } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface StatCardProps {
  label: string;
  value?: React.ReactNode;
  sub?: React.ReactNode;
  icon?: React.ReactNode;
  /** enmascarado por rol (vault_operator): muestra candado, nunca la cifra */
  masked?: boolean;
  maskedLabel?: string;
  className?: string;
}

/** StatCard del dashboard (DESIGN_SYSTEM §7.8), con enmascarado financiero. */
export function StatCard({ label, value, sub, icon, masked, maskedLabel, className }: StatCardProps) {
  return (
    <div className={cn('flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 shadow-sm', className)}>
      <div className="flex items-start justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted">{label}</span>
        {icon && <span className="text-muted">{icon}</span>}
      </div>
      {masked ? (
        <span className="flex items-center gap-2 text-sm text-subtle">
          <Lock size={16} /> {maskedLabel}
        </span>
      ) : (
        <>
          <span className="tabular text-h1 font-bold text-text">{value}</span>
          {sub && <div className="text-xs text-muted">{sub}</div>}
        </>
      )}
    </div>
  );
}
