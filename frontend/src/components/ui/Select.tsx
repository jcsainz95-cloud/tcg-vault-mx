'use client';

import { forwardRef, useId } from 'react';
import { CircleAlert } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  options: SelectOption[];
  placeholder?: string;
  hint?: string;
  /** Mensaje de error (§CS-UX.3): sube la regla a danger, pinta `aria-invalid` + `aria-describedby`. */
  error?: string;
}

/*
 * Dirección 5a: mismo tratamiento que Input — regla en vez de caja, etiqueta mono.
 * El indicador es el triángulo ▾ del diseño, no el chevron de lucide.
 * Error (§CS-UX.3): `aria-invalid`, `aria-describedby` al texto del error, borde danger 2px y mensaje
 * con icono (nunca solo color). El color no es el único canal.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, options, placeholder, hint, error, className, id, required, ...props },
  ref,
) {
  const autoId = useId();
  const selectId = id ?? autoId;
  const describedBy = error ? `${selectId}-err` : hint ? `${selectId}-hint` : undefined;
  return (
    <div className="flex flex-col">
      <label htmlFor={selectId} className="eyebrow">
        {label}
      </label>
      {/* Anillo de foco (bermellón, --shadow-focus) en el wrapper: el <select> lleva
          outline-none. Excepción de accesibilidad que sobrevive a "sombras 0"
          (DESIGN_SYSTEM §6.3 → §6.2 focus = borde --color-primary + --shadow-focus; §8.2). */}
      <div
        className={cn(
          'relative mt-3 border-b pb-3 focus-within:shadow-focus',
          error ? 'border-b-2 border-accent' : 'border-border-strong focus-within:border-text',
        )}
      >
        <select
          ref={ref}
          id={selectId}
          className={cn(
            'w-full appearance-none bg-transparent pr-6 text-base text-text outline-none',
            className,
          )}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          aria-required={required ? true : undefined}
          required={required}
          {...props}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-0 top-0 text-muted" aria-hidden>
          ▾
        </span>
      </div>
      {error ? (
        <p id={`${selectId}-err`} className="mt-2 flex items-center gap-1.5 font-mono text-xs text-accent">
          <CircleAlert size={14} aria-hidden />
          {error}
        </p>
      ) : hint ? (
        <p id={`${selectId}-hint`} className="mt-2 font-mono text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
