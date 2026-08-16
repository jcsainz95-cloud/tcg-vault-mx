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

/**
 * Métrica del dashboard (DESIGN_SYSTEM §7.8), con enmascarado financiero.
 *
 * Dirección 5a: deja de ser una tarjeta y pasa a ser una celda de una retícula
 * reglada — más datos por pantalla y ninguna caja redondeada. La regla la pone el
 * contenedor (`divide-*` / `border-*`), no la celda, para que no se dupliquen.
 */
export function StatCard({ label, value, sub, icon, masked, maskedLabel, className }: StatCardProps) {
  return (
    <div className={cn('flex flex-col px-6 py-7 sm:px-10', className)}>
      <div className="flex items-start justify-between gap-3">
        <span className="eyebrow">{label}</span>
        {icon && <span className="text-muted">{icon}</span>}
      </div>
      {masked ? (
        <span className="mt-4 flex items-center gap-2 font-mono text-sm text-muted">
          <Lock size={15} aria-hidden /> {maskedLabel}
        </span>
      ) : (
        <>
          <span className="tabular mt-4 text-[26px] font-medium leading-none text-text">{value}</span>
          {sub && <div className="mt-2 font-mono text-xs leading-relaxed text-muted">{sub}</div>}
        </>
      )}
    </div>
  );
}
