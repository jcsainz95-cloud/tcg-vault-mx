'use client';

import { useLocale, useTranslations } from 'next-intl';
import { ArrowDown, ArrowUp, Equal } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { AppLocale } from '@/i18n/routing';
import type { MarketingAggTable, MarketingCell, MarketingScreenPayload } from '@/types/contract';
import { CellValue, MarketingTable, NotMeasuredBlock, cellMeaning } from './MarketingTable';
import { ResumenCharts } from './ResumenCharts';

/**
 * Pestaña «Resumen» (`§MKT-V2`, docs/specs/MKT_PANEL_V2.md §1). Pinta `r1` (cifras con flecha), `r2` (avisos) y `r3`
 * (día por día, SOLO si el servidor lo manda: régimen `exact`). MKT-3: ⛔ no suma ni recalcula; la flecha sale del signo
 * de `delta_abs` y el porcentaje es `delta_pct`, ambos del servidor. Una celda `'< 5'`/`'oculta'`/`null` o un texto
 * `NO MEDIDO` se pinta como lo que es, sin flecha.
 */

type Row = Record<string, MarketingCell>;
const NOISE_BELOW = 5; // spec §1: si actual y anterior < 5, el cambio es ruido («≈»)

const num = (c: MarketingCell | undefined): number | null => (typeof c === 'number' && Number.isFinite(c) ? c : null);
const text = (c: MarketingCell | undefined): string => (typeof c === 'string' ? c : '');

export type DeltaKind = 'none' | 'noise' | 'new' | 'same' | 'up' | 'down';

/** Qué dice la flecha de una fila de `r1`. Pura (prueba en `ResumenScreen.test.tsx`). */
export function deltaKindOf(row: Row): DeltaKind {
  const actual = num(row.actual);
  const anterior = num(row.anterior);
  if (actual === null || anterior === null) return 'none';
  if (actual < NOISE_BELOW && anterior < NOISE_BELOW) return 'noise';
  if (anterior === 0 && actual > 0) return 'new';
  const abs = num(row.delta_abs) ?? actual - anterior;
  if (abs === 0) return 'same';
  return abs > 0 ? 'up' : 'down';
}

function signed(n: number, locale: AppLocale, style: 'decimal' | 'percent' = 'decimal'): string {
  return new Intl.NumberFormat(locale === 'es' ? 'es-MX' : 'en-US', {
    style,
    signDisplay: 'exceptZero',
    maximumFractionDigits: style === 'percent' ? 0 : 2,
  }).format(style === 'percent' ? n / 100 : n);
}

function Delta({ row }: { row: Row }) {
  const t = useTranslations('admin.marketing.resumen.delta');
  const locale = useLocale() as AppLocale;
  const kind = deltaKindOf(row);
  if (kind === 'none') return null;
  const abs = num(row.delta_abs);
  const pct = num(row.delta_pct);
  const Icon = kind === 'up' || kind === 'new' ? ArrowUp : kind === 'down' ? ArrowDown : Equal;
  const tone = kind === 'up' || kind === 'new' ? 'text-success' : kind === 'down' ? 'text-danger' : 'text-muted';
  let label: string;
  if (kind === 'noise') label = t('noise');
  else if (kind === 'new') label = t('new');
  else if (kind === 'same') label = t('same');
  else {
    const parts = [abs !== null ? signed(abs, locale) : null, pct !== null ? `(${signed(pct, locale, 'percent')})` : null].filter(Boolean);
    label = `${t(kind)} ${parts.join(' ')}`.trim();
  }
  return (
    <p className={cn('flex items-center gap-1 text-sm', tone)} data-delta={kind}>
      <Icon size={14} aria-hidden />
      <span>{label}</span>
    </p>
  );
}

function FigureCard({ row, table }: { row: Row; table: MarketingAggTable }) {
  const t = useTranslations('admin.marketing.resumen');
  const locale = useLocale();
  const col = (key: string) => table.columns.find((c) => c.key === key) ?? { key, labelEs: key, kind: 'number' as const };
  const actual = row.actual;
  const notMeasured = typeof actual === 'string' && /^NO MEDIDO/.test(actual);
  const showBefore = !notMeasured && cellMeaning(row.anterior) !== 'none';
  // El servidor marca las sublíneas con «· » (Nuevos / Recurrentes, MX$ bajo Pedidos, impresiones bajo clics).
  const raw = text(row.cifra);
  const sub = raw.startsWith('·');
  return (
    <li
      className={cn('flex flex-col gap-1 border p-4', sub ? 'border-dashed border-border-strong' : 'border-border')}
      data-testid="mkt-figure"
      data-sub={sub ? '' : undefined}
    >
      <p className="text-xs uppercase tracking-[0.06em] text-muted" lang={locale === 'es' ? undefined : 'es'}>
        {sub ? raw.replace(/^·\s*/, '') : raw}
      </p>
      {notMeasured ? (
        <p className="text-sm text-text" lang={locale === 'es' ? undefined : 'es'}>
          <span className="font-semibold">{t('notMeasured')}</span> {actual.replace(/^NO MEDIDO\s*[—-]?\s*/, '')}
        </p>
      ) : (
        <p className={cn('font-serif text-text', sub ? 'text-xl' : 'text-2xl')}>
          <CellValue cell={actual} column={col('actual')} />
        </p>
      )}
      <Delta row={row} />
      {showBefore && (
        <p className="text-xs text-muted">
          {t('before')} <CellValue cell={row.anterior} column={col('anterior')} />
        </p>
      )}
    </li>
  );
}

function Figures({ table }: { table: MarketingAggTable }) {
  const t = useTranslations('admin.marketing.resumen');
  if (!table.measured) return <NotMeasuredBlock title={table.title} reason={table.notMeasuredReason} />;
  return (
    <section aria-labelledby="mkt-r1" className="flex flex-col gap-3" data-testid="mkt-r1">
      <h2 id="mkt-r1" className="font-serif text-xl text-text">
        {t('figures')}
      </h2>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {table.rows.map((row, i) => (
          <FigureCard key={i} row={row} table={table} />
        ))}
      </ul>
      <p className="text-xs text-muted">{t('lag')}</p>
    </section>
  );
}

function Alerts({ table }: { table: MarketingAggTable }) {
  const t = useTranslations('admin.marketing.resumen');
  const locale = useLocale();
  if (!table.measured) return <NotMeasuredBlock title={table.title} reason={table.notMeasuredReason} />;
  const sev = (g: string) => (g === 'alta' || g === 'media' || g === 'info' ? t(`severity.${g}`) : g);
  return (
    <section aria-labelledby="mkt-r2" className="flex flex-col gap-3" data-testid="mkt-r2">
      <h2 id="mkt-r2" className="font-serif text-xl text-text">
        {t('alerts')}
      </h2>
      {table.rows.length === 0 ? (
        <p className="text-sm text-text">{t('noAlerts')}</p>
      ) : (
        <ul className="flex flex-col gap-3" lang={locale === 'es' ? undefined : 'es'}>
          {table.rows.map((row, i) => (
            <li
              key={i}
              data-severity={text(row.gravedad)}
              className={cn('border-l-2 pl-4', text(row.gravedad) === 'alta' ? 'border-accent' : 'border-border-strong')}
            >
              <p className="text-sm text-text">
                <span className="mr-2 font-mono text-[11px] uppercase tracking-[0.06em] text-muted">{sev(text(row.gravedad))}</span>
                <span className="font-semibold">{text(row.titulo)}</span>
              </p>
              {text(row.evidencia) && <p className="font-mono text-xs text-muted">{text(row.evidencia)}</p>}
              {text(row.accion) && <p className="text-sm text-text">{text(row.accion)}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ResumenScreen({ data }: { data: MarketingScreenPayload }) {
  const t = useTranslations('admin.marketing.resumen');
  const r1 = data.tables.find((x) => x.id === 'r1');
  const r2 = data.tables.find((x) => x.id === 'r2');
  // r3 solo existe con `privacy: 'exact'` (sesión del dueño). Sin ella no se pinta nada del día por día.
  const r3 = data.privacy === 'exact' ? data.tables.find((x) => x.id === 'r3') : undefined;
  const rest = data.tables.filter((x) => !['r1', 'r2', 'r3'].includes(x.id));
  return (
    <div className="flex flex-col gap-8" data-testid="mkt-resumen">
      {r1 && <Figures table={r1} />}
      {r2 && <Alerts table={r2} />}
      {r3 &&
        (r3.measured && r3.rows.length > 0 ? (
          <section aria-labelledby="mkt-r3" className="flex flex-col gap-3" data-testid="mkt-r3">
            <h2 id="mkt-r3" className="font-serif text-xl text-text">
              {t('daily.title')}
            </h2>
            <p className="text-xs uppercase tracking-[0.06em] text-muted" data-testid="mkt-r3-private">
              {t('daily.private')}
            </p>
            <ResumenCharts rows={r3.rows} />
            <details>
              <summary className="min-h-[44px] cursor-pointer py-2 text-sm text-text">{t('daily.table')}</summary>
              <MarketingTable table={r3} />
            </details>
            {r3.notes?.map((n, i) => (
              <p key={i} className="text-xs text-muted">
                {n}
              </p>
            ))}
          </section>
        ) : (
          <MarketingTable table={r3} />
        ))}
      {rest.map((tb) => (
        <MarketingTable key={tb.id} table={tb} />
      ))}
    </div>
  );
}
