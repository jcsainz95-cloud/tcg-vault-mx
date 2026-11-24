'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { AppLocale } from '@/i18n/routing';
import type { ComparisonBasis, MoneyDeltaDTO } from '@/types/contract';
import { fmtBps, moneyDirection } from '@/lib/reports/comparison';
import { money, signedMoney } from '../m9/salesFormat';

/** Anchos de las columnas del estado de resultados (en pantallas ≥ sm); el encabezado y cada renglón comparten los mismos. */
export const COL_AMOUNT = 'sm:w-28 sm:text-right';
/** Renglones sin comparación: su importe queda bajo «Este periodo» (7 rem + 11 rem + 2 espacios de 0.75 rem). */
export const COL_PAD = 'sm:pr-[19.5rem]';
const COL_PREV = 'sm:w-28 sm:text-right';
const COL_VAR = 'sm:w-44 sm:text-right';

/** `previousCents` y variación de UNA cifra, tal cual del servidor (§2 F2a). ⛔ Cero aritmética de dinero en el navegador. */
export function CompareCells({ d, basis, inline = false }: { d: MoneyDeltaDTO; basis: ComparisonBasis; inline?: boolean }) {
  const t = useTranslations('admin.reports.compare');
  const locale = useLocale() as AppLocale;
  const none = basis === 'none';
  const pct = none ? null : fmtBps(d.deltaBps, locale);
  const dir = moneyDirection(d);
  return (
    <span
      data-testid="cmp-cells"
      data-basis={basis}
      className={`flex w-full justify-end gap-3 text-xs text-muted ${inline ? '' : 'sm:w-auto'}`}
    >
      <span data-testid="cmp-prev" className={`tabular ${inline ? '' : COL_PREV}`}>
        <span className={inline ? '' : 'sm:hidden'}>{t('cols.before')} </span>
        {none ? <Dash why={t('noBase')} /> : money(d.previousCents, locale)}
      </span>
      <span data-testid="cmp-var" className={`tabular ${inline ? '' : COL_VAR}`}>
        {none || pct === null ? (
          <Dash why={none ? t('noBase') : t('noPrevious')} />
        ) : (
          <>
            <span aria-hidden>{dir === 'up' ? '▲' : dir === 'down' ? '▼' : '＝'} </span>
            <span className="sr-only">{t(`dir.${dir}`)} </span>
            {pct}
            {d.deltaCents !== 0 && <span> · {signedMoney(d.deltaCents, locale)}</span>}
          </>
        )}
      </span>
    </span>
  );
}

function Dash({ why }: { why: string }) {
  return (
    <>
      <span aria-hidden>—</span>
      <span className="sr-only">{why}</span>
    </>
  );
}

/** Encabezado de columnas del estado de resultados (solo ≥ sm; en móvil cada renglón dice «Antes …»). */
export function CompareHeader() {
  const t = useTranslations('admin.reports.compare');
  return (
    <div data-testid="cmp-header" className="hidden items-end justify-end gap-3 pb-1 text-xs text-muted sm:flex">
      <span className={`eyebrow ${COL_AMOUNT}`}>{t('cols.current')}</span>
      <span className={`eyebrow ${COL_PREV}`}>{t('cols.previous')}</span>
      <span className={`eyebrow ${COL_VAR}`}>{t('cols.variation')}</span>
    </div>
  );
}
