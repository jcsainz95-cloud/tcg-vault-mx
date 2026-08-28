'use client';

import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { sanitizeDecimal, type BandRow, type FieldErrorCode } from './curve-draft';

export interface RoundingLadderTableProps {
  rows: BandRow[];
  fieldErrors: Record<string, FieldErrorCode | undefined>;
  offending: boolean;
  onChange: (key: string, field: 'upto' | 'step', raw: string) => void;
  onBlur: (key: string, field: 'upto' | 'step') => void;
  onRemove: (key: string) => void;
  onAdd: () => void;
}

/**
 * Escalera de redondeo ↑ (DESIGN_SYSTEM §21.3b), anidada dentro del bloque VENTA porque **solo
 * aplica a ese eje**: la compra no se redondea.
 *
 * **La última banda no tiene input de «Hasta»**: se pinta la versalita fija `EN ADELANTE`
 * (`uptoCents: null`). Así los estados inválidos «ninguna banda abierta» y «dos bandas abiertas»
 * **no se pueden expresar** desde la UI — es la mitad barata de V8 resuelta por construcción. La
 * otra mitad (cada frontera múltiplo exacto del escalón de la banda inferior) la valida el servidor.
 */
export function RoundingLadderTable({
  rows,
  fieldErrors,
  offending,
  onChange,
  onBlur,
  onRemove,
  onAdd,
}: RoundingLadderTableProps) {
  const t = useTranslations('admin.m2.curve');
  const canRemove = rows.length > 1;

  return (
    <div className="mt-3 flex flex-col gap-3">
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">{t('rounding.tableCaption')}</caption>
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="eyebrow py-2 font-normal">
              {t('rounding.uptoCol')}
            </th>
            <th scope="col" className="eyebrow py-2 font-normal">
              {t('rounding.stepCol')}
            </th>
            <th scope="col" className="py-2">
              <span className="sr-only">{t('point.actionsCol')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const isOpen = row.uptoRaw === null;
            const uptoErr = fieldErrors[`${row.key}:upto`];
            const stepErr = fieldErrors[`${row.key}:step`];
            // La banda abierta y la única banda no se pueden quitar: sin banda abierta no hay paso
            // que elegir arriba del último umbral.
            const removable = canRemove && !isOpen;
            return (
              <tr
                key={row.key}
                data-testid="curve-rounding-band"
                className={offending ? 'border-l-2 border-accent' : 'border-l-2 border-transparent'}
              >
                <td className="py-3 pr-3">
                  {isOpen ? (
                    <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted">
                      {t('rounding.openBand')}
                    </span>
                  ) : (
                    <>
                      <label className="sr-only" htmlFor={`${row.key}-upto`}>
                        {t('rounding.uptoAria', { n: index + 1 })}
                      </label>
                      <span className="flex items-baseline gap-1.5 border-b border-border-strong pb-1 focus-within:shadow-focus">
                        <span className="shrink-0 font-mono text-[11px] text-muted">MX$</span>
                        <input
                          id={`${row.key}-upto`}
                          className="tabular-nums w-24 bg-transparent font-mono text-[13px] text-text outline-none"
                          inputMode="decimal"
                          value={row.uptoRaw ?? ''}
                          aria-invalid={uptoErr ? true : undefined}
                          aria-describedby={uptoErr ? `${row.key}-upto-err` : undefined}
                          onChange={(e) => onChange(row.key, 'upto', sanitizeDecimal(e.target.value))}
                          onBlur={() => onBlur(row.key, 'upto')}
                        />
                      </span>
                      {uptoErr && (
                        <p id={`${row.key}-upto-err`} className="mt-1 font-mono text-[11px] text-accent">
                          {t(`fieldError.${uptoErr}`)}
                        </p>
                      )}
                    </>
                  )}
                </td>
                <td className="py-3 pr-3">
                  <label className="sr-only" htmlFor={`${row.key}-step`}>
                    {t('rounding.stepAria', { n: index + 1 })}
                  </label>
                  <span className="flex items-baseline gap-1.5 border-b border-border-strong pb-1 focus-within:shadow-focus">
                    <span className="shrink-0 font-mono text-[11px] text-muted">MX$</span>
                    <input
                      id={`${row.key}-step`}
                      className="tabular-nums w-20 bg-transparent font-mono text-[13px] text-text outline-none"
                      inputMode="decimal"
                      value={row.stepRaw}
                      aria-invalid={stepErr ? true : undefined}
                      aria-describedby={stepErr ? `${row.key}-step-err` : undefined}
                      onChange={(e) => onChange(row.key, 'step', sanitizeDecimal(e.target.value))}
                      onBlur={() => onBlur(row.key, 'step')}
                    />
                  </span>
                  {stepErr && (
                    <p id={`${row.key}-step-err`} className="mt-1 font-mono text-[11px] text-accent">
                      {t(`fieldError.${stepErr}`)}
                    </p>
                  )}
                </td>
                <td className="py-3 pl-2 text-right">
                  <button
                    type="button"
                    onClick={() => onRemove(row.key)}
                    disabled={!removable}
                    aria-label={t('rounding.removeAria', { n: index + 1 })}
                    title={removable ? undefined : t('rounding.removeDisabled')}
                    aria-describedby={removable ? undefined : `${row.key}-remove-why`}
                    className="inline-flex h-11 w-11 items-center justify-center text-text transition-colors hover:text-accent disabled:cursor-not-allowed disabled:text-muted"
                  >
                    <X size={16} aria-hidden />
                  </button>
                  {!removable && (
                    <span id={`${row.key}-remove-why`} className="sr-only">
                      {t('rounding.removeDisabled')}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <Button variant="secondary" size="sm" onClick={onAdd} className="w-full">
        {t('rounding.add')}
      </Button>
      <p className="text-xs text-muted">{t('rounding.hint')}</p>
    </div>
  );
}
