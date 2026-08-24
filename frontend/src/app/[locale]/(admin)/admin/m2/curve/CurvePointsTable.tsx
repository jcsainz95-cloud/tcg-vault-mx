'use client';

import { useEffect, useRef } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import type { AppLocale } from '@/i18n/routing';
import type { CurvePreviewRowDTO } from '@/types/contract';
import { formatMoneyCents } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { PriceBasisTag } from '@/components/domain/PriceBasisTag';
import { cn } from '@/lib/cn';
import {
  bpToMultiplier,
  bpToPct,
  multiplierToBp,
  pctToBp,
  pesosToCents,
  sanitizeDecimal,
  type CurveAxis,
  type FieldErrorCode,
  type PointRow,
} from './curve-draft';

export interface CurvePointsTableProps {
  axis: CurveAxis;
  rows: PointRow[];
  /** Fila por mercado (centavos) del dry-run — el resultado derivado NO se calcula aquí. */
  previewByMarket: Map<number, CurvePreviewRowDTO>;
  /** Valor guardado por mercado, en unidades de pantalla, para la marca «Antes: 1.15×» (§21.2d). */
  savedByMarket: Map<number, number>;
  fieldErrors: Record<string, FieldErrorCode | undefined>;
  duplicateKeys: Set<string>;
  /** Filas marcadas por el `422` del servidor (§21.4b-2). */
  offendingKeys: Set<string>;
  /** Fila que acaba de cambiar de posición: recibe el realce breve de §21.2a. */
  highlightKey: string | null;
  /** Fila enfocada por «Ir al punto de …» del resumen de error. */
  focusKey: string | null;
  onChange: (key: string, field: 'market' | 'value', raw: string) => void;
  onBlur: (key: string, field: 'market' | 'value') => void;
  onRemove: (key: string) => void;
  onAdd: () => void;
}

/**
 * Tabla de puntos de UNA curva (DESIGN_SYSTEM §21.2). Es un `<table>` real (§7.7), no una lista de
 * tarjetas.
 *
 * **Mover un punto = cambiar su mercado. No hay arrastrar y soltar**: el orden no es un dato que el
 * dueño edite, se DERIVA de `marketCents`. Un asa de arrastre sugeriría que el orden es
 * independiente del valor — y en una pantalla de dinero, una fila que cambia de sitio con el ratón
 * es la clase de gesto que produce un error que nadie recuerda haber hecho.
 *
 * La columna **RESULTADO** es derivada y de solo lectura, y sus cifras vienen del **dry-run del
 * servidor** (`POST /admin/pricing/curve/preview`): aquí no se interpola ni se redondea nada.
 */
export function CurvePointsTable({
  axis,
  rows,
  previewByMarket,
  savedByMarket,
  fieldErrors,
  duplicateKeys,
  offendingKeys,
  highlightKey,
  focusKey,
  onChange,
  onBlur,
  onRemove,
  onAdd,
}: CurvePointsTableProps) {
  const t = useTranslations('admin.m2.curve');
  const locale = useLocale() as AppLocale;
  const firstInputs = useRef<Record<string, HTMLInputElement | null>>({});

  // El foco sigue a la fila: tras reordenar (§21.2a) y al saltar desde el resumen de error
  // (§21.4b-1) el dueño no pierde de vista su propio punto.
  useEffect(() => {
    if (!focusKey) return;
    firstInputs.current[focusKey]?.focus();
    firstInputs.current[focusKey]?.scrollIntoView({ block: 'center', behavior: 'auto' });
  }, [focusKey]);

  const valueCol = axis === 'sale' ? t('sale.multiplierCol') : t('buy.payCol');
  const canRemove = rows.length > 1;

  return (
    <div className="mt-3 flex flex-col gap-3">
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">
          {axis === 'sale' ? t('sale.tableCaption') : t('buy.tableCaption')}
        </caption>
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="eyebrow w-[7.5rem] py-2 font-normal">
              <span className="sr-only">{t('point.positionCol')}</span>
            </th>
            <th scope="col" className="eyebrow py-2 font-normal">
              {t('sale.marketCol')}
            </th>
            <th scope="col" className="eyebrow py-2 font-normal">
              {valueCol}
            </th>
            <th scope="col" className="eyebrow py-2 font-normal">
              {axis === 'sale' ? t('sale.resultCol') : t('buy.resultCol')}
            </th>
            <th scope="col" className="py-2">
              <span className="sr-only">{t('point.actionsCol')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const marketCents = pesosToCents(row.marketRaw);
            const preview = marketCents != null ? previewByMarket.get(marketCents) : undefined;
            const leg = preview ? preview.draft[axis] : undefined;
            const marketErr = fieldErrors[`${row.key}:market`];
            const valueErr = fieldErrors[`${row.key}:value`];
            const dupe = duplicateKeys.has(row.key);
            const offending = offendingKeys.has(row.key);
            const savedBp = marketCents != null ? savedByMarket.get(marketCents) : undefined;
            const savedText =
              savedBp == null
                ? null
                : axis === 'sale'
                  ? `${bpToMultiplier(savedBp)}×`
                  : `${bpToPct(savedBp)}%`;
            const currentBp = axis === 'sale' ? multiplierToBp(row.valueRaw) : pctToBp(row.valueRaw);
            const changed = savedBp != null && currentBp != null && currentBp !== savedBp;
            const rowLabel = marketCents != null ? formatMoneyCents(marketCents, locale) : '';
            return (
              <tr
                key={row.key}
                data-testid={`curve-point-${axis}`}
                className={cn(
                  'align-top',
                  offending || dupe
                    ? 'border-l-2 border-accent'
                    : highlightKey === row.key
                      ? 'border-l-2 border-accent motion-safe:transition-colors'
                      : 'border-l-2 border-transparent',
                )}
              >
                <td className="py-3 pr-2">
                  <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted">
                    {row.isNew
                      ? t('point.new')
                      : index === 0
                        ? t('point.flatBefore')
                        : index === rows.length - 1
                          ? t('point.flatAfter')
                          : ''}
                  </span>
                </td>
                <td className="py-3 pr-3">
                  <label className="sr-only" htmlFor={`${row.key}-market`}>
                    {t('point.marketAria', { n: index + 1 })}
                  </label>
                  <span className="flex items-baseline gap-1.5 border-b border-border-strong pb-1 focus-within:shadow-focus">
                    <span className="shrink-0 font-mono text-[11px] text-muted">MX$</span>
                    <input
                      id={`${row.key}-market`}
                      ref={(el) => {
                        firstInputs.current[row.key] = el;
                      }}
                      className="tabular-nums w-24 bg-transparent font-mono text-[13px] text-text outline-none"
                      inputMode="decimal"
                      value={row.marketRaw}
                      aria-invalid={marketErr || dupe || offending ? true : undefined}
                      aria-describedby={
                        marketErr || dupe ? `${row.key}-market-err` : undefined
                      }
                      onChange={(e) => onChange(row.key, 'market', sanitizeDecimal(e.target.value))}
                      onBlur={() => onBlur(row.key, 'market')}
                    />
                  </span>
                </td>
                <td className="py-3 pr-3">
                  <label className="sr-only" htmlFor={`${row.key}-value`}>
                    {axis === 'sale'
                      ? t('point.multiplierAria', { n: index + 1 })
                      : t('point.payAria', { n: index + 1 })}
                  </label>
                  <span className="flex items-baseline gap-1.5 border-b border-border-strong pb-1 focus-within:shadow-focus">
                    <input
                      id={`${row.key}-value`}
                      className="tabular-nums w-16 bg-transparent font-mono text-[13px] text-text outline-none"
                      inputMode="decimal"
                      value={row.valueRaw}
                      aria-invalid={valueErr ? true : undefined}
                      aria-describedby={valueErr ? `${row.key}-value-err` : undefined}
                      onChange={(e) => onChange(row.key, 'value', sanitizeDecimal(e.target.value))}
                      onBlur={() => onBlur(row.key, 'value')}
                    />
                    <span className="shrink-0 font-mono text-[11px] text-muted">
                      {axis === 'sale' ? '×' : '%'}
                    </span>
                  </span>
                  {changed && savedText && (
                    <span className="mt-1 block font-mono text-[10px] text-muted">
                      {t('point.previousValue', { value: savedText })}
                    </span>
                  )}
                </td>
                {/* Columna DERIVADA: pozo de superficie (§4.3), no relleno de estado. `<td>`
                    normal — no un input deshabilitado (§21.10). */}
                <td className="bg-surface-2 px-3 py-3">
                  {leg && leg.priceCents != null ? (
                    <span className="flex flex-col gap-1">
                      <span className="tabular-nums font-mono text-[13px] text-text">
                        {formatMoneyCents(leg.priceCents, locale)}
                      </span>
                      {leg.basis === 'floor' && <PriceBasisTag basis="floor" />}
                    </span>
                  ) : (
                    <span className="font-mono text-[11px] text-muted">—</span>
                  )}
                </td>
                <td className="py-3 pl-2 text-right">
                  <button
                    type="button"
                    onClick={() => onRemove(row.key)}
                    disabled={!canRemove}
                    aria-label={t('point.removeAria', { market: rowLabel })}
                    title={canRemove ? undefined : t('point.removeLastDisabled')}
                    aria-describedby={canRemove ? undefined : `${row.key}-remove-why`}
                    className="inline-flex h-11 w-11 items-center justify-center text-text transition-colors hover:text-accent disabled:cursor-not-allowed disabled:text-muted"
                  >
                    <X size={16} aria-hidden />
                  </button>
                  {!canRemove && (
                    <span id={`${row.key}-remove-why`} className="sr-only">
                      {t('point.removeLastDisabled')}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
          {/* Sub-filas de mensaje a todo el ancho (§21.4b-2): el error vive bajo su punto. */}
          {rows.map((row) => {
            const marketErr = fieldErrors[`${row.key}:market`];
            const valueErr = fieldErrors[`${row.key}:value`];
            const dupe = duplicateKeys.has(row.key);
            if (!marketErr && !valueErr && !dupe) return null;
            return (
              <tr key={`${row.key}-msg`}>
                <td colSpan={5} className="pb-2">
                  {marketErr && (
                    <p
                      id={`${row.key}-market-err`}
                      className="font-mono text-[11px] text-accent"
                    >
                      {t(`fieldError.${marketErr}`)}
                    </p>
                  )}
                  {dupe && !marketErr && (
                    <p id={`${row.key}-market-err`} className="font-mono text-[11px] text-accent">
                      {t('fieldError.duplicateMarket')}
                    </p>
                  )}
                  {valueErr && (
                    <p id={`${row.key}-value-err`} className="font-mono text-[11px] text-accent">
                      {t(`fieldError.${valueErr}`)}
                    </p>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Agregar un punto es NEUTRO por construcción: al confirmar el mercado se prerrellena con
          el valor interpolado de la curva actual, así que no cambia ningún precio (§21.2b). */}
      <Button variant="secondary" size="sm" onClick={onAdd} className="w-full">
        {t('point.add')}
      </Button>
      {rows.some((r) => r.prefilledNeutral) && (
        <p className="font-mono text-[11px] text-muted">{t('point.addedNeutralHint')}</p>
      )}
    </div>
  );
}
