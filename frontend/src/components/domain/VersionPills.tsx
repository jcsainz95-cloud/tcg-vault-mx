'use client';

import { useId, useRef, type KeyboardEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { formatMoneyCents } from '@/lib/format';
import type { AppLocale } from '@/i18n/routing';
import type { CardLanguage, VersionOptionDTO } from '@/types/contract';
import { isExtendedForm, versionRows, type VersionRow } from '@/lib/version';
import { StampChip } from './VersionChip';

/**
 * §IDS-UX.8 — selector de versión en burbujas (A-contorno de marketing; D-IDS-5 = B).
 *
 * **Las burbujas redondeadas son SOLO de este fichero** (`rounded-pill`, candado 13): insignias, CTA, campos y modales
 * siguen rectos. Borde `--color-border-control` (≥ 3:1 sobre papel, candado 14), elegida en relleno tinta.
 *
 * `VersionPills` (ficha): `radiogroup` con rótulo «IDIOMA Y VERSIÓN»; columna = idioma, fila = versión; pinta
 * `versions[]` EN EL ORDEN DEL SERVIDOR (agotadas ya omitidas por él); con una sola versión NO se dibuja (candado 12).
 * Forma 2×2 estándar (insignia «De liga» dentro de la burbuja) o 2×N (rótulo de fila 12 px muted, 12 px arriba / 6 px
 * abajo, sin insignia dentro). Un solo tab-stop (roving `tabindex`); flechas mueven y eligen en orden de lectura.
 *
 * `PillToggleGroup` (captura admin, IDS-UX.2): la misma burbuja a 44 px con opciones apagadas (borde discontinuo +
 * motivo en `aria-describedby`, visible al enfocar).
 */

const PILL =
  'rounded-pill border-[1.5px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text';
const PILL_IDLE = 'border-border-control bg-bg text-text hover:bg-surface-2';
const PILL_ON = 'border-text bg-text text-primary-fg';

function useRovingKeys(count: number, current: number, select: (i: number) => void) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const next = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (next === 0 || count === 0) return;
    e.preventDefault();
    const i = (current + next + count) % count;
    select(i);
    refs.current[i]?.focus();
  };
  return { refs, onKeyDown };
}

export interface VersionPillsProps {
  versions: readonly VersionOptionDTO[];
  /** `optionKey` elegido (de `preselectVersionOption` o del clic). */
  selectedKey: string | null;
  onSelect: (option: VersionOptionDTO) => void;
  className?: string;
}

export function VersionPills({ versions, selectedKey, onSelect, className }: VersionPillsProps) {
  const t = useTranslations('version');
  // Textos solo de la ficha: namespace aparte para no engordar el de la portada (DYN-F10, trinquete de bytes).
  const td = useTranslations('versionDetail');
  const locale = useLocale() as AppLocale;
  const labelId = useId();
  const rows = versionRows(versions);
  const extended = isExtendedForm(rows);
  // Orden de lectura de las burbujas PRESENTES (fila, luego columna en → es): el del teclado.
  const flat: VersionOptionDTO[] = rows.flatMap((r) => (['en', 'es'] as const).flatMap((l) => (r.cells[l] ? [r.cells[l]!] : [])));
  const currentIndex = Math.max(0, flat.findIndex((v) => v.optionKey === selectedKey));
  const { refs, onKeyDown } = useRovingKeys(flat.length, currentIndex, (i) => onSelect(flat[i]));

  if (versions.length <= 1) return null;

  const rowLabel = (row: VersionRow): string => {
    const parts = [row.stamp ? td(`row.${row.stamp.type}`) : td('row.noStamp')];
    if (row.finishLabel) parts.push(t(`finishLabel.${row.finishLabel}`));
    // D-IDS-6 (pendiente de ux-ui con marketing): mientras no decidan, `stamp.label` tal cual (ARCHITECTURE §15.4).
    if (row.needsStampLabel && row.stamp?.label) parts.push(row.stamp.label);
    return parts.join(' · ');
  };

  const pill = (row: VersionRow, lang: CardLanguage, rowLabelId: string | undefined) => {
    const opt = row.cells[lang];
    // Ranura vacía: hueco fijo por (fila, columna), sin reordenar (IDS-UX.8).
    if (!opt) return <div key={lang} aria-hidden="true" />;
    const index = flat.indexOf(opt);
    const checked = opt.optionKey === selectedKey;
    const name = t(`language.${lang}`);
    const price = formatMoneyCents(opt.fromPriceCents, locale);
    const chip = !extended && row.stamp ? t(`chip.${row.stamp.type}`) : null;
    return (
      <button
        key={lang}
        ref={(el) => {
          refs.current[index] = el;
        }}
        type="button"
        role="radio"
        aria-checked={checked}
        aria-label={[name, chip, price].filter(Boolean).join(', ')}
        aria-describedby={rowLabelId}
        tabIndex={checked || (selectedKey == null && index === 0) ? 0 : -1}
        data-option-key={opt.optionKey}
        data-testid="version-pill"
        onClick={() => onSelect(opt)}
        onKeyDown={onKeyDown}
        className={cn(PILL, 'flex min-h-16 w-full flex-col items-center justify-center px-3 py-2', checked ? PILL_ON : PILL_IDLE)}
      >
        <span className="flex flex-wrap items-center justify-center gap-x-[5px] gap-y-1 font-sans text-[14px] font-semibold leading-tight">
          <span>{name}</span>
          {chip && row.stamp && <StampChip type={row.stamp.type} onInk={checked} className="h-[18px] border-[1.25px]" />}
        </span>
        <span className="tabular mt-0.5 font-sans text-[14px] leading-tight">{price}</span>
      </button>
    );
  };

  return (
    <div className={className} data-testid="version-pills" data-form={extended ? '2xN' : '2x2'}>
      <p id={labelId} className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
        {td('picker.label')}
      </p>
      <div role="radiogroup" aria-labelledby={labelId} className={cn('mt-2', !extended && 'grid grid-cols-2 gap-2')}>
        {extended
          ? rows.map((row, i) => {
              const id = `${labelId}-row-${i}`;
              return (
                <div key={row.id} data-testid="version-row">
                  <p id={id} data-testid="version-row-label" className={cn('mb-1.5 text-[12px] leading-4 text-muted', i > 0 && 'mt-3')}>
                    {rowLabel(row)}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {pill(row, 'en', id)}
                    {pill(row, 'es', id)}
                  </div>
                </div>
              );
            })
          : rows.flatMap((row) => [pill(row, 'en', undefined), pill(row, 'es', undefined)].map((el, j) => (
              <div key={`${row.id}-${j}`} className="contents">
                {el}
              </div>
            )))}
      </div>
    </div>
  );
}

export interface PillToggleOption<V extends string> {
  value: V;
  label: string;
  /** Apagada: borde discontinuo + motivo (visible al enfocar y en `aria-describedby`); no se puede elegir. */
  disabledReason?: string | null;
}

export function PillToggleGroup<V extends string>({
  label,
  options,
  value,
  onChange,
  testId,
}: {
  label: string;
  options: readonly PillToggleOption<V>[];
  value: V;
  onChange: (v: V) => void;
  testId?: string;
}) {
  const labelId = useId();
  const enabled = options.filter((o) => !o.disabledReason);
  const current = Math.max(0, enabled.findIndex((o) => o.value === value));
  const { refs, onKeyDown } = useRovingKeys(enabled.length, current, (i) => onChange(enabled[i].value));
  return (
    <div data-testid={testId}>
      <p id={labelId} className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
        {label}
      </p>
      <div role="radiogroup" aria-labelledby={labelId} className="mt-1.5 flex flex-wrap gap-2">
        {options.map((o) => {
          const checked = o.value === value;
          const disabled = !!o.disabledReason;
          const reasonId = `${labelId}-${o.value}-reason`;
          const ei = enabled.indexOf(o);
          return (
            <span key={o.value} className="group relative inline-flex flex-col">
              <button
                ref={(el) => {
                  if (ei >= 0) refs.current[ei] = el;
                }}
                type="button"
                role="radio"
                aria-checked={checked}
                aria-disabled={disabled || undefined}
                aria-describedby={disabled ? reasonId : undefined}
                tabIndex={!disabled && checked ? 0 : -1}
                data-value={o.value}
                onClick={() => {
                  if (!disabled) onChange(o.value);
                }}
                onKeyDown={onKeyDown}
                className={cn(
                  PILL,
                  'min-h-11 px-4 text-sm font-medium',
                  disabled
                    ? 'cursor-not-allowed border-dashed border-muted bg-bg text-muted'
                    : checked
                      ? PILL_ON
                      : PILL_IDLE,
                )}
              >
                {o.label}
              </button>
              {disabled && (
                <span id={reasonId} className="mt-1 max-w-[16rem] text-[11px] leading-snug text-muted">
                  {o.disabledReason}
                </span>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}
