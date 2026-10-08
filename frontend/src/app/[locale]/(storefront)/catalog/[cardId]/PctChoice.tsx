'use client';

import { useId } from 'react';
import { cn } from '@/lib/cn';

export interface ChoiceOption<V extends string | number> {
  value: V;
  label: string;
  /** Línea bajo el rótulo, DENTRO del `<label>` (WSH-UX.2 h): los pesos de un %. Ya formateada por el llamador. */
  sub?: string;
}

/**
 * Grupo de radios con piel de chip (DESIGN_SYSTEM §WSH-UX.2 h, patrón AN-UX.2): `<fieldset>` con `<legend>` visible,
 * `<input type="radio">` reales (las flechas mueven dentro del grupo de forma nativa), 44 px de alto, foco visible.
 * Activo = `primary` (tinta); inactivo = `ghost` con regla. ⛔ Este componente no sabe de dinero: si hay pesos, llegan
 * como texto en `sub`, ya formateados desde el DTO.
 */
export function ChoiceChips<V extends string | number>({
  legend,
  name,
  options,
  value,
  onChange,
  disabled,
  className,
}: {
  legend: string;
  name: string;
  options: ChoiceOption<V>[];
  value: V;
  onChange: (v: V) => void;
  disabled?: boolean;
  className?: string;
}) {
  const legendId = useId();
  return (
    <fieldset role="radiogroup" aria-labelledby={legendId} className={cn('min-w-0', className)} disabled={disabled}>
      <legend id={legendId} className="eyebrow mb-3">
        {legend}
      </legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const checked = o.value === value;
          return (
            <label
              key={String(o.value)}
              className={cn(
                'relative inline-flex min-h-[44px] cursor-pointer flex-col justify-center border px-4 py-2 text-left',
                'focus-within:shadow-focus',
                checked ? 'border-text bg-primary text-primary-fg' : 'border-border-strong text-text hover:border-text',
                disabled && 'cursor-not-allowed opacity-60',
              )}
            >
              <input
                type="radio"
                name={name}
                value={String(o.value)}
                checked={checked}
                onChange={() => onChange(o.value)}
                className="sr-only"
              />
              <span className="font-mono text-[11px] uppercase tracking-label">{o.label}</span>
              {o.sub && (
                <span className={cn('tabular mt-1 text-[12px]', checked ? 'text-primary-fg' : 'text-muted')}>{o.sub}</span>
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * Los tres niveles 5 / 10 / 16 % (HECHOS 2026-10-06). `pesos` = la cifra del servidor por nivel
 * (`GET /wishlist/preview`, v1.87.1) ya formateada; sin dato (`no_market` o sin respuesta) ⇒ sin línea de pesos.
 */
export function PctChoice({
  legend,
  name,
  value,
  onChange,
  optionLabel,
  pesos,
  disabled,
}: {
  legend: string;
  name: string;
  value: 5 | 10 | 16;
  onChange: (v: 5 | 10 | 16) => void;
  optionLabel: (pct: number) => string;
  pesos?: Partial<Record<5 | 10 | 16, string>>;
  disabled?: boolean;
}) {
  const options: ChoiceOption<5 | 10 | 16>[] = ([5, 10, 16] as const).map((pct) => ({
    value: pct,
    label: optionLabel(pct),
    sub: pesos?.[pct],
  }));
  return (
    <ChoiceChips legend={legend} name={name} options={options} value={value} onChange={onChange} disabled={disabled} />
  );
}
