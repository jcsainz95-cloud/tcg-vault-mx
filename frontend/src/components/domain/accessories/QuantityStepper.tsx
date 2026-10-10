'use client';

import { useEffect, useId, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';

export interface QuantityStepperProps {
  value: number;
  min?: number;
  /** Tope DEL SERVIDOR (p. ej. `maxQty − enCarrito`); ⛔ nunca un 99 fijo por defecto en la ficha. */
  max: number;
  onChange: (next: number) => void;
  /** Etiqueta visible (ficha) o solo para lector (`labelHidden`, carrito). */
  label: string;
  labelHidden?: boolean;
  /** Nota unida por `aria-describedby` (p. ej. «Puedes agregar hasta {n}.»). */
  hint?: string;
  disabled?: boolean;
  /** `aria-live` sobre el valor (carrito: re-cotiza). */
  announce?: boolean;
  compact?: boolean;
  className?: string;
}

/**
 * `QuantityStepper` (`DESIGN_SYSTEM §AC-UX.3/.14`): «−» · campo numérico · «+», 44 px cada uno, `role="group"`
 * etiquetado por su `label`. Escribir fuera de rango se corrige AL SALIR del campo (no a cada tecla).
 */
export function QuantityStepper({
  value,
  min = 1,
  max,
  onChange,
  label,
  labelHidden,
  hint,
  disabled,
  announce,
  compact,
  className,
}: QuantityStepperProps) {
  const t = useTranslations('accessories.stepper');
  const id = useId();
  const labelId = `${id}-label`;
  const hintId = `${id}-hint`;
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const clamp = (n: number) => Math.min(max, Math.max(min, Math.trunc(n)));
  const commit = () => {
    const n = Number(draft);
    const next = Number.isFinite(n) && draft.trim() !== '' ? clamp(n) : value;
    setDraft(String(next));
    if (next !== value) onChange(next);
  };
  const size = compact ? 'h-11 w-11' : 'h-11 w-11 sm:h-12 sm:w-12';

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label id={labelId} htmlFor={`${id}-input`} className={cn('eyebrow', labelHidden && 'sr-only')}>
        {label}
      </label>
      <div role="group" aria-labelledby={labelId} className="inline-flex items-stretch border border-border-strong self-start">
        <button
          type="button"
          aria-label={t('decrease')}
          disabled={disabled || value <= min}
          onClick={() => onChange(clamp(value - 1))}
          className={cn(size, 'inline-flex items-center justify-center text-text hover:bg-surface-2 disabled:text-muted disabled:hover:bg-transparent')}
        >
          <Minus size={14} aria-hidden />
        </button>
        <input
          id={`${id}-input`}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={draft}
          disabled={disabled}
          aria-describedby={hint ? hintId : undefined}
          aria-live={announce ? 'polite' : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
          }}
          className="tabular w-14 border-x border-border-strong bg-transparent text-center text-[15px] text-text outline-none [appearance:textfield] focus-visible:shadow-focus [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <button
          type="button"
          aria-label={t('increase')}
          disabled={disabled || value >= max}
          onClick={() => onChange(clamp(value + 1))}
          className={cn(size, 'inline-flex items-center justify-center text-text hover:bg-surface-2 disabled:text-muted disabled:hover:bg-transparent')}
        >
          <Plus size={14} aria-hidden />
        </button>
      </div>
      {hint && (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
