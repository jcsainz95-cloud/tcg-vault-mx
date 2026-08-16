'use client';

import { forwardRef, useId } from 'react';
import { cn } from '@/lib/cn';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
  prefix?: string;
  suffix?: string;
}

/*
 * Dirección 5a: el campo pierde la caja y queda como una regla bajo el valor.
 * La etiqueta es mono en versalitas; el error se marca subiendo la regla a bermellón
 * y con texto, nunca con un relleno de color.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, prefix, suffix, className, id, ...props },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedBy = error ? `${inputId}-err` : hint ? `${inputId}-hint` : undefined;
  return (
    <div className="flex flex-col">
      <label htmlFor={inputId} className="eyebrow">
        {label}
      </label>
      <div
        className={cn(
          // El campo no tiene caja, pero el ANILLO de foco (bermellón, --shadow-focus)
          // es la excepción de accesibilidad que sobrevive a "sombras 0"
          // (DESIGN_SYSTEM §6.2 focus = borde --color-primary + --shadow-focus; §8.2).
          // El <input> interno lleva outline-none, así que el anillo va en el wrapper.
          'mt-3 flex items-baseline gap-2 border-b pb-3 focus-within:shadow-focus',
          error ? 'border-accent' : 'border-border-strong focus-within:border-text',
        )}
      >
        {prefix && <span className="shrink-0 font-mono text-sm text-muted">{prefix}</span>}
        <input
          ref={ref}
          id={inputId}
          className={cn(
            'w-full min-w-0 bg-transparent text-base text-text outline-none placeholder:text-muted',
            className,
          )}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...props}
        />
        {suffix && <span className="shrink-0 font-mono text-sm text-muted">{suffix}</span>}
      </div>
      {error ? (
        <p id={`${inputId}-err`} className="mt-2 font-mono text-xs text-accent">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="mt-2 font-mono text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
