'use client';

import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import type { AppLocale } from '@/i18n/routing';
import type { MarketingAggTable, MarketingCell, MarketingColumn } from '@/types/contract';
import { formatNumber, formatPct, formatPesos } from './mkt-format';

/**
 * `MarketingTable` + `CellValue` + `NotMeasuredBlock` (`DESIGN_SYSTEM §MKT-UX.5`). Pinta una `AggTable` TAL CUAL llega
 * (MKT-3: ⛔ no suma, no reordena, no recalcula, no adivina una celda oculta).
 *
 * El régimen de celdas (`privacy`, §MKT.G.2/.G.5; `exact` solo para la sesión del dueño, HECHOS 2026-10-18) lo aplica
 * el SERVIDOR: aquí no cambia nada, porque la celda trae su significado (`'< 5'`, `'oculta'`, `null` = «—»).
 */

/** Centinela del servidor para un conteo menor a 5 (`backend/.../small-cells.ts SMALL_CELL_SENTINEL`). */
export const SMALL = '< 5';
/** Centinela de supresión coherente mes↔semanas (§MKT.G.10, v1.103): un conteo N≥5 que se oculta igual. */
export const OCULTA = 'oculta';
/** Literal de la fila de supresión complementaria (`small-cells.ts OTROS_LABEL`); frágil hasta MKT-UX.17 punto 3. */
export const OTROS_LABEL = 'Otros (< 5 c/u)';

export type CellMeaning = 'small' | 'hidden' | 'none' | 'value';

/**
 * ÚNICA pieza que decide qué dice una celda (§MKT-UX.5 «las cinco cosas»; «No medido» va a nivel de tabla).
 * - `'< 5'` ⇒ cantidad pequeña.
 * - `'oculta'` ⇒ «Oculto» (conteo ocultado por supresión coherente §MKT.G.10, o celda de una fila suprimida), en texto visible.
 * - `null` ⇒ «—» (SIN DATO), siempre, en todo `kind` y en todo régimen (API_CONTRACT §MKT.G.5, v1.106, C-P1).
 * - cualquier número (también `0`) o texto ⇒ el dato.
 * El servidor (`sealHiddenRows`, C-P1) ya convierte en `'oculta'` toda celda no texto `null` de una fila suprimida: aquí
 * no se adivina nada por vecindad (TL-MKT2b-c cerró FE-MKT2-4, la compatibilidad pre-v1.106, el 2026-10-19).
 */
export function cellMeaning(cell: MarketingCell | undefined): CellMeaning {
  if (cell === SMALL) return 'small';
  if (cell === OCULTA) return 'hidden';
  if (cell === null || cell === undefined) return 'none';
  return 'value';
}

function formatValue(cell: number | string, column: MarketingColumn, locale: AppLocale): string {
  if (typeof cell === 'string') return cell;
  switch (column.kind) {
    case 'money':
      return formatPesos(cell, locale);
    case 'pct':
      return formatPct(cell, locale);
    case 'count':
      return formatNumber(cell, locale, 0);
    default:
      return formatNumber(cell, locale);
  }
}

export function CellValue({ cell, column }: { cell: MarketingCell | undefined; column: MarketingColumn }) {
  const t = useTranslations('admin.marketing.cells');
  const locale = useLocale() as AppLocale;
  const meaning = cellMeaning(cell);
  if (meaning === 'small') {
    return (
      <span data-cell="small">
        <span className="font-mono">{SMALL}</span>
        <span className="sr-only"> {t('small')}</span>
      </span>
    );
  }
  if (meaning === 'hidden') {
    return (
      <span data-cell="hidden" className="text-xs uppercase tracking-[0.06em] text-muted">
        <span aria-hidden>{t('hidden')}</span>
        <span className="sr-only">{t('hiddenSr')}</span>
      </span>
    );
  }
  if (meaning === 'none') {
    return (
      <span data-cell="none" className="text-muted">
        <span aria-hidden>—</span>
        <span className="sr-only">{t('none')}</span>
      </span>
    );
  }
  const v = cell as number | string;
  if (typeof v === 'string' && v === OTROS_LABEL) return <span data-cell="others">{t('others')}</span>;
  const text = formatValue(v, column, locale);
  return (
    <span data-cell="value" className={cn(typeof v === 'string' && column.kind === 'text' && 'break-words')}>
      {text}
    </span>
  );
}

/** Bloque «No medido todavía» (§MKT-UX.5): borde discontinuo, título, motivo del servidor y «esto no es cero». */
export function NotMeasuredBlock({ title, reason }: { title: string; reason?: string }) {
  const t = useTranslations('admin.marketing.table');
  const locale = useLocale();
  return (
    <div
      role="group"
      aria-label={t('notMeasuredGroup', { titulo: title })}
      data-testid="mkt-not-measured"
      className="border border-dashed border-border-strong p-4"
    >
      <p className="font-semibold text-text">{t('notMeasuredTitle')}</p>
      {reason && (
        <p className="mt-1 text-sm text-text" lang={locale === 'es' ? undefined : 'es'}>
          {reason}
        </p>
      )}
      <p className="mt-1 text-xs text-muted">{t('notMeasuredBody')}</p>
    </div>
  );
}

/** ¿La tabla muestra alguna celda «< 5» u «Oculto» (incluida `'oculta'`)? (decide la nota al pie, UX-MKT-5). */
export function tableHasSuppressed(table: MarketingAggTable): boolean {
  return table.rows.some((row) =>
    table.columns.some((c) => {
      const m = cellMeaning(row[c.key]);
      return m === 'small' || m === 'hidden';
    }),
  );
}

function isOthersRow(row: Record<string, MarketingCell>): boolean {
  return Object.values(row).some((c) => c === OTROS_LABEL);
}

const CARD_KEY_COLUMNS = 3;
const CARD_COLLAPSE_OVER = 8;

export function MarketingTable({ table }: { table: MarketingAggTable }) {
  const t = useTranslations('admin.marketing');
  const locale = useLocale();
  const serverLang = locale === 'es' ? undefined : 'es';
  const titleId = `mkt-table-${table.id}`;
  const cols = table.columns;
  const footnote = table.measured && tableHasSuppressed(table);

  const header = (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h2 id={titleId} className="font-serif text-xl text-text" lang={serverLang}>
        {table.title}
      </h2>
      <p className="text-xs text-muted">{t('source.prefix', { fuente: t(`source.${table.source}`) })}</p>
    </div>
  );

  if (!table.measured && cols.length === 0) {
    return (
      <section aria-labelledby={titleId} data-testid={`mkt-table-${table.id}`} className="flex flex-col gap-3 border-t border-border pt-5">
        {header}
        <NotMeasuredBlock title={table.title} reason={table.notMeasuredReason} />
      </section>
    );
  }

  const body = !table.measured ? (
    <tr>
      <td colSpan={cols.length} className="py-3">
        <NotMeasuredBlock title={table.title} reason={table.notMeasuredReason} />
      </td>
    </tr>
  ) : table.rows.length === 0 ? (
    <tr>
      <td colSpan={cols.length} className="py-3" data-testid="mkt-table-empty">
        <p className="text-sm text-text">{t('table.empty')}</p>
        <p className="text-xs text-muted">{t('table.emptyHint')}</p>
      </td>
    </tr>
  ) : (
    table.rows.map((row, i) => {
      return (
        <tr key={i} className={cn('border-b border-border', isOthersRow(row) && 'border-t border-t-border-strong')}>
          {cols.map((c, j) => {
            const Tag = j === 0 ? 'th' : 'td';
            return (
              <Tag
                key={c.key}
                scope={j === 0 ? 'row' : undefined}
                className={cn(
                  'py-2.5 pr-4 text-sm font-normal text-text',
                  c.kind === 'text' ? 'text-left' : 'tabular text-right tabular-nums',
                )}
              >
                <CellValue cell={row[c.key]} column={c} />
              </Tag>
            );
          })}
        </tr>
      );
    })
  );

  return (
    <section aria-labelledby={titleId} data-testid={`mkt-table-${table.id}`} className="flex flex-col gap-3 border-t border-border pt-5">
      {header}
      <div
        className="hidden overflow-x-auto md:block"
        tabIndex={0}
        role="region"
        aria-label={t('table.scrollLabel', { titulo: table.title })}
      >
        <table className="w-full border-collapse">
          <caption className="sr-only">{table.title}</caption>
          <thead className="sticky top-[var(--app-header-h,0px)] bg-bg">
            <tr className="border-b border-border-strong">
              {cols.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  lang={serverLang}
                  className={cn('py-2 pr-4 font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-muted', c.kind === 'text' ? 'text-left' : 'text-right')}
                >
                  {c.labelEs}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{body}</tbody>
        </table>
      </div>

      {/* Móvil (< md): una tarjeta por fila, mismos textos (§7.7). `display:none` de verdad fuera de su ancho. */}
      <div className="flex flex-col gap-3 md:hidden" data-testid={`mkt-cards-${table.id}`}>
        {!table.measured ? (
          <NotMeasuredBlock title={table.title} reason={table.notMeasuredReason} />
        ) : table.rows.length === 0 ? (
          <div>
            <p className="text-sm text-text">{t('table.empty')}</p>
            <p className="text-xs text-muted">{t('table.emptyHint')}</p>
          </div>
        ) : (
          table.rows.map((row, i) => {
                  const [head, ...rest] = cols;
            const collapse = cols.length > CARD_COLLAPSE_OVER;
            const shown = collapse ? rest.slice(0, CARD_KEY_COLUMNS - 1) : rest;
            const more = collapse ? rest.slice(CARD_KEY_COLUMNS - 1) : [];
            const pair = (c: MarketingColumn) => (
              <div key={c.key} className="flex justify-between gap-3 py-1">
                <dt className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted" lang={serverLang}>
                  {c.labelEs}
                </dt>
                <dd className="tabular text-right text-sm text-text">
                  <CellValue cell={row[c.key]} column={c} />
                </dd>
              </div>
            );
            return (
              <article key={i} className="border-b border-border pb-2">
                {head && (
                  <h3 className="text-sm font-medium text-text">
                    <CellValue cell={row[head.key]} column={head} />
                  </h3>
                )}
                <dl>{shown.map(pair)}</dl>
                {more.length > 0 && (
                  <details>
                    <summary className="min-h-[44px] cursor-pointer py-2 text-sm text-text">{t('table.seeAll')}</summary>
                    <dl>{more.map(pair)}</dl>
                  </details>
                )}
              </article>
            );
          })
        )}
      </div>

      {footnote && (
        <p className="text-xs text-muted" data-testid="mkt-footnote">
          {t('cells.footnote')}
        </p>
      )}
      {table.notes?.map((n, i) => (
        <p key={i} className="text-xs text-muted" lang={serverLang}>
          {n}
        </p>
      ))}
    </section>
  );
}
