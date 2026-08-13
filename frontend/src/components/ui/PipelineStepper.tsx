'use client';

import { Check, X } from 'lucide-react';
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

/** PipelineStepper (DESIGN_SYSTEM §7.9): <ol> con aria-current en el actual. */
export function PipelineStepper({ steps, current, errored }: PipelineStepperProps) {
  const currentIdx = steps.findIndex((s) => s.key === current);

  return (
    <ol className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-0">
      {steps.map((step, i) => {
        const done = i < currentIdx;
        const isCurrent = i === currentIdx;
        const state = errored && isCurrent ? 'error' : done ? 'done' : isCurrent ? 'current' : 'pending';
        return (
          <li
            key={step.key}
            className="flex items-center gap-3 sm:flex-1 sm:flex-col sm:gap-2 sm:text-center"
            aria-current={isCurrent ? 'step' : undefined}
          >
            <div className="flex items-center sm:w-full">
              <span
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold',
                  state === 'done' && 'border-success bg-success text-white',
                  state === 'current' && 'border-primary text-primary shadow-focus',
                  state === 'error' && 'border-danger bg-danger text-white',
                  state === 'pending' && 'border-border-strong text-subtle',
                )}
              >
                {state === 'done' ? <Check size={16} /> : state === 'error' ? <X size={16} /> : i + 1}
              </span>
              {i < steps.length - 1 && (
                <span
                  className={cn('mx-1 hidden h-0.5 flex-1 sm:block', done ? 'bg-success' : 'bg-border')}
                  aria-hidden
                />
              )}
            </div>
            <span
              className={cn(
                'text-sm',
                isCurrent ? 'font-semibold text-text' : 'text-muted',
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
