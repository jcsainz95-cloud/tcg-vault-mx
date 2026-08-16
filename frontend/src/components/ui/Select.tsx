'use client';

import { forwardRef, useId } from 'react';
import { cn } from '@/lib/cn';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  options: SelectOption[];
  placeholder?: string;
}

/*
 * Dirección 5a: mismo tratamiento que Input — regla en vez de caja, etiqueta mono.
 * El indicador es el triángulo ▾ del diseño, no el chevron de lucide.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, options, placeholder, className, id, ...props },
  ref,
) {
  const autoId = useId();
  const selectId = id ?? autoId;
  return (
    <div className="flex flex-col">
      <label htmlFor={selectId} className="eyebrow">
        {label}
      </label>
      <div className="relative mt-3 border-b border-border-strong pb-3 focus-within:border-text">
        <select
          ref={ref}
          id={selectId}
          className={cn(
            'w-full appearance-none bg-transparent pr-6 text-base text-text outline-none',
            className,
          )}
          {...props}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <span
          className="pointer-events-none absolute right-0 top-0 text-muted"
          aria-hidden
        >
          ▾
        </span>
      </div>
    </div>
  );
});
