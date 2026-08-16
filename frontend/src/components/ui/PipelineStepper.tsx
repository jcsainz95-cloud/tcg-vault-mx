'use client';

import { cn } from '@/lib/cn';

export interface Step {
  key: string;
  label: string;
}

export interface PipelineStepperProps {
  steps: Step[];
  /** key del paso actual */
  current: string;
  /** true si el flujo terminó en rama de error (rechazada/fallida) */
  errored?: boolean;
}

/**
 * PipelineStepper (DESIGN_SYSTEM §7.9): <ol> con aria-current en el actual.
 *
 * Dirección 5a: deja de ser una fila de píldoras con círculos y se vuelve una
 * línea de tiempo tipográfica — folio mono 01…05 y una regla superior que se
 * pinta hasta donde llegó el envío (tinta en lo recorrido, bermellón en el paso
 * actual). El estado sigue teniendo texto propio, no solo color.
 */
export function PipelineStepper({ steps, current, errored }: PipelineStepperProps) {
  const currentIdx = steps.findIndex((s) => s.key === current);

  return (
    <ol className="flex flex-col border-t border-border sm:flex-row sm:border-t-0">
      {steps.map((step, i) => {
        const done = i < currentIdx;
        const isCurrent = i === currentIdx;
        const reached = done || isCurrent;
        return (
          <li
            key={step.key}
            aria-current={isCurrent ? 'step' : undefined}
            className={cn(
              'flex items-baseline gap-3 border-b border-border py-4',
              'sm:-mt-px sm:flex-1 sm:flex-col sm:items-stretch sm:gap-2 sm:border-b-0 sm:border-t sm:border-border sm:pb-4',
              // La regla superior es el progreso: se engrosa donde ya se pasó.
              reached && 'sm:border-t-2',
              isCurrent && !errored && 'sm:border-t-accent',
              isCurrent && errored && 'sm:border-t-accent',
              done && 'sm:border-t-text',
            )}
          >
            <span
              className={cn(
                'font-mono text-[10px] leading-none',
                isCurrent ? 'text-accent' : 'text-muted',
              )}
            >
              {String(i + 1).padStart(2, '0')}
            </span>
            <span
              className={cn(
                'text-sm leading-none',
                isCurrent ? 'font-medium text-text' : reached ? 'text-text' : 'text-muted',
              )}
            >
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
