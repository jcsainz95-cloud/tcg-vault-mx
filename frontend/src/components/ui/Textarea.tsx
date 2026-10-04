'use client';

import { forwardRef, useId } from 'react';
import { cn } from '@/lib/cn';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: string;
  error?: string;
  /** Contador visible «{n} / {max}» (DESIGN_SYSTEM §37.8c/§37.8d: notas y motivos con tope). */
  counter?: { max: number };
}

/**
 * Área de texto con la misma regla-bajo-el-valor de `Input` (§6.2): etiqueta mono en versalitas, sin caja,
 * error en bermellón con texto. Nace para los motivos obligatorios de §37 (anular, cancelar, re-emitir,
 * reclamar, capturar el monto): un `<input>` de una línea no da aire para escribir «de dónde sale la cifra».
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, counter, className, id, value, ...props },
  ref,
) {
  const autoId = useId();
  const areaId = id ?? autoId;
  const describedBy = error ? `${areaId}-err` : hint ? `${areaId}-hint` : undefined;
  const length = typeof value === 'string' ? value.length : 0;
  return (
    <div className="flex flex-col">
      <label htmlFor={areaId} className="eyebrow">
        {label}
      </label>
      <div
        className={cn(
          'mt-3 border-b pb-3 focus-within:shadow-focus',
          error ? 'border-accent' : 'border-border-strong focus-within:border-text',
        )}
      >
        <textarea
          ref={ref}
          id={areaId}
          value={value}
          rows={3}
          className={cn('w-full min-w-0 resize-y bg-transparent text-base text-text outline-none placeholder:text-muted', className)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...props}
        />
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-3">
        {error ? (
          <p id={`${areaId}-err`} className="font-mono text-xs text-accent">
            {error}
          </p>
        ) : hint ? (
          <p id={`${areaId}-hint`} className="font-mono text-xs text-muted">
            {hint}
          </p>
        ) : (
          <span />
        )}
        {counter && (
          // §43.18c: pasado el tope, bermellón (sin `maxLength`: se deja escribir de más y se dice).
          <span
            className={cn('tabular shrink-0 font-mono text-xs', length > counter.max ? 'text-accent' : 'text-muted')}
            aria-hidden
            data-testid="textarea-counter"
          >
            {length} / {counter.max}
          </span>
        )}
      </div>
    </div>
  );
});
