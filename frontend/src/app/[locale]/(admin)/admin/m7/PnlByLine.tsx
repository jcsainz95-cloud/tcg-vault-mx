'use client';

import { useState } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import type { AppLocale } from '@/i18n/routing';
import { cn } from '@/lib/cn';
import { fmtPct } from '@/lib/reports/comparison';
import { Banner } from '@/components/ui/Banner';
import { QueryState } from '@/components/ui/QueryState';
import { PNL_LINES, type PnlColumnDTO, type PnlLineKey, type PnlReportDTO } from '@/types/reports-pnl';
import { money } from '../m9/salesFormat';
import { Figure } from '../reportes/Figure';
import { CellDelta } from './CellDelta';
import { ROWS, deltaOf, type RowDef } from './pnlLinesFormat';

type ColKey = PnlLineKey | 'total';

/**
 * §REPORTES-CEO F2b — Finanzas › «Resultado por línea de negocio» (`GET /admin/reports/finance/pnl`, solo súper-admin).
 * De lo general al detalle: tres cifras-titular del total → la tabla por línea (Sellado, Cartas raw, Gradeadas, Accesorios,
 * «Sin línea» y Total) → lo informativo que NO se suma → el lugar reservado del Marketplace. ⛔ La pantalla NO calcula dinero:
 * cada importe, margen y variación es del servidor. En celular se ve UNA línea a la vez junto al Total (selector arriba);
 * desde `md` van todas las columnas, con la primera columna fija y desplazamiento horizontal si no caben.
 */
export function PnlByLine({ query }: { query: Pick<UseQueryResult<PnlReportDTO>, 'data' | 'isLoading' | 'isError' | 'error' | 'refetch'> }) {
  const t = useTranslations('admin.m7.lines');
  const locale = useLocale() as AppLocale;
  const [mobileLine, setMobileLine] = useState<PnlLineKey>('sealed');
  const d = query.data;
  const cmp = d?.comparison ?? null;
  const basis = cmp?.basis;
  const fixed = d?.total.fixedCostsCents;

  const colOf = (c: ColKey): PnlColumnDTO | undefined => (d ? (c === 'total' ? d.total : d.own[c]) : undefined);
  const prevOf = (c: ColKey): PnlColumnDTO | undefined => (d?.previous ? (c === 'total' ? d.previous.total : d.previous.own[c]) : undefined);
  const deltasOf = (c: ColKey) => (cmp ? (c === 'total' ? cmp.total : cmp.byLine[c]) : undefined);
  const cols: ColKey[] = [...PNL_LINES, 'total'];

  function cell(row: RowDef, c: ColKey) {
    const col = colOf(c);
    if (!col) return null;
    const v = row.get(col);
    if (row.kind === 'pct') {
      const prev = prevOf(c);
      const before = prev && basis && basis !== 'none' ? fmtPct(prev.marginBps, locale, false) : null;
      return (
        <>
          <span>{v === null ? <Dash why={t('noMargin')} /> : fmtPct(v, locale, false)}</span>
          {before && <span className="block text-xs text-muted">{t('marginBefore', { pct: before })}</span>}
        </>
      );
    }
    return (
      <>
        <span>{money(v ?? 0, locale)}</span>
        <CellDelta d={deltaOf(deltasOf(c), row.fig)} basis={basis} testId={`pl-delta-${row.id}-${c}`} />
      </>
    );
  }

  const hideOnPhone = (c: ColKey) => (c === 'total' || c === mobileLine ? '' : 'hidden md:table-cell');
  const rows: RowDef[] = [...ROWS];

  return (
    <section aria-labelledby="pnl-lines-h" className="flex flex-col gap-4" data-testid="pnl-lines">
      <div className="flex flex-col gap-1">
        <h2 id="pnl-lines-h" className="text-h2 font-semibold">
          {t('title')}
        </h2>
        <p className="max-w-2xl text-sm text-muted">{t('intro')}</p>
      </div>
      <QueryState isLoading={query.isLoading} isError={query.isError} error={query.error} onRetry={() => query.refetch()}>
        {d && (
          <div className="flex flex-col gap-5">
            {/* 1 · Lo general: el total, con su variación (del servidor). */}
            <div className="grid divide-y divide-border border border-border bg-surface sm:grid-cols-3 sm:divide-x sm:divide-y-0" data-testid="pnl-lines-headline">
              <Figure
                label={t('rows.netSales')}
                value={money(d.total.netSalesCents, locale)}
                money={cmp?.total.netSalesCents}
                basis={basis}
              />
              <Figure
                label={t('rows.grossProfit')}
                value={money(d.total.grossProfitCents, locale)}
                money={cmp?.total.grossProfitCents}
                basis={basis}
                note={d.total.marginBps !== null ? t('marginNote', { pct: fmtPct(d.total.marginBps, locale, false) as string }) : undefined}
              />
              <Figure
                label={fixed == null ? t('rows.contribution') : t('rows.result')}
                value={money(fixed == null ? d.total.contributionCents : (d.total.resultCents ?? 0), locale)}
                money={cmp?.total.contributionCents}
                basis={basis}
                note={fixed == null ? t('beforeFixedHelp') : undefined}
              />
            </div>

            {/* Avisos de dato dudoso, siempre junto a su cifra (contadores del servidor; sin listas). */}
            {d.allocationMismatchOrders > 0 && (
              <div data-testid="pnl-lines-mismatch">
                <Banner variant="warning" role="status">
                  {t('allocationMismatch', { count: d.allocationMismatchOrders })}
                </Banner>
              </div>
            )}

            {/* 2 · Por línea. Celular: una línea a la vez + Total. */}
            <div className="flex flex-col gap-2">
              <div role="group" aria-label={t('pickLine')} className="flex flex-wrap md:hidden" data-testid="pnl-lines-picker">
                {PNL_LINES.map((l) => (
                  <button
                    key={l}
                    type="button"
                    aria-pressed={mobileLine === l}
                    onClick={() => setMobileLine(l)}
                    className={cn(
                      'min-h-[44px] -ml-px border border-border px-3 text-sm first:ml-0 focus-visible:shadow-focus focus-visible:outline-none',
                      mobileLine === l ? 'bg-text text-surface' : 'bg-surface text-text hover:bg-surface-2',
                    )}
                  >
                    {t(`line.${l}`)}
                  </button>
                ))}
              </div>
              <div className="relative overflow-x-auto border border-border bg-surface" tabIndex={0} role="region" aria-label={t('tableLabel')}>
                <table className="w-full min-w-full border-collapse text-sm" data-testid="pnl-lines-table">
                  <caption className="sr-only">{t('tableLabel')}</caption>
                  <thead>
                    <tr className="border-b border-border-strong">
                      <th scope="col" className="sticky left-0 z-10 bg-surface px-3 py-2 text-left font-normal">
                        <span className="sr-only">{t('rowHeader')}</span>
                      </th>
                      {cols.map((c) => (
                        <th
                          key={c}
                          scope="col"
                          data-testid={`pl-head-${c}`}
                          className={cn('eyebrow whitespace-nowrap px-3 py-2 text-right md:min-w-[7.5rem]', c === 'total' && 'border-l border-border-strong text-text', hideOnPhone(c))}
                        >
                          {c === 'total' ? t('total') : t(`line.${c}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} data-testid={`pl-row-${r.id}`} className={cn('border-b border-border last:border-b-0', r.strong && 'bg-surface-2/60')}>
                        <th scope="row" className={cn('sticky left-0 z-10 bg-surface px-3 py-2 text-left align-top font-normal', r.strong && 'bg-surface-2 font-semibold')}>
                          <span aria-hidden className="mr-1 inline-block w-3 tabular text-muted">{r.sign}</span>
                          {r.sign === '−' && <span className="sr-only">{t('srSubtracts')} </span>}
                          {r.sign === '±' && <span className="sr-only">{t('srEither')} </span>}
                          <span className={r.strong ? '' : 'text-muted'}>{t(`rows.${r.id}`)}</span>
                          {r.id === 'shippingResult' && <span className="block pl-4 text-xs text-muted">{t('shippingResultHelp')}</span>}
                          {r.id === 'cogs' && d.costMissingCount > 0 && (
                            <span className="block pl-4 text-xs text-muted" data-testid="pnl-lines-cost-missing">
                              {t('costMissing', { count: d.costMissingCount })}
                            </span>
                          )}
                          {r.id === 'paymentFee' && d.stripeFeeEstimatedOrders > 0 && (
                            <span className="block pl-4 text-xs text-muted" data-testid="pnl-lines-fee-estimated">
                              {t('feeEstimated', { count: d.stripeFeeEstimatedOrders })}
                            </span>
                          )}
                        </th>
                        {cols.map((c) => (
                          <td
                            key={c}
                            data-testid={`pl-${r.id}-${c}`}
                            className={cn('tabular whitespace-nowrap px-3 py-2 text-right align-top', r.strong && 'font-semibold', c === 'total' && 'border-l border-border-strong font-semibold', hideOnPhone(c))}
                          >
                            {cell(r, c)}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {fixed != null && (
                      <>
                        <tr data-testid="pl-row-fixedCosts" className="border-t border-border">
                          <th scope="row" className="sticky left-0 z-10 bg-surface px-3 py-2 text-left font-normal text-muted">
                            <span aria-hidden className="mr-1 inline-block w-3 tabular">−</span>
                            {t('rows.fixedCosts')}
                          </th>
                          {cols.map((c) => (
                            <td key={c} className={cn('tabular px-3 py-2 text-right', hideOnPhone(c))}>
                              {c === 'total' ? money(d.total.fixedCostsCents ?? 0, locale) : ''}
                            </td>
                          ))}
                        </tr>
                      </>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted" data-testid="pnl-lines-unassigned-help">
                {t('unassignedHelp')}
              </p>
              <p className="text-xs text-muted md:hidden">{t('phoneHint')}</p>
            </div>

            {/* 3 · Informativo: NO entra en la suma. */}
            <div data-testid="pnl-lines-memo" className="flex flex-col gap-2 border border-dashed border-border bg-surface-2/40 p-4">
              <p className="eyebrow text-muted">{t('memo.title')}</p>
              <p className="text-xs text-muted">{t('memo.help')}</p>
              <dl className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
                <MemoItem label={t('memo.iva')} value={money(d.memo.iva.netCents, locale)} sub={t('memo.ivaSub', { collected: money(d.memo.iva.collectedCents, locale), refunded: money(d.memo.iva.refundedCents, locale) })} />
                <MemoItem label={t('memo.inventoryPurchases')} value={money(d.memo.inventoryPurchasesCents, locale)} />
                <MemoItem label={t('memo.chargebacks')} value={money(d.memo.chargebacks.cents, locale)} sub={t('memo.chargebacksSub', { count: d.memo.chargebacks.orders })} />
                <MemoItem label={t('memo.shrinkage')} value={money(d.memo.shrinkageCents, locale)} />
                <MemoItem label={t('memo.insurance')} value={money(d.memo.shipping.insuranceCents, locale)} />
                <MemoItem label={t('memo.adjustments')} value={money(d.memo.shipping.adjustmentsCents, locale)} />
                <MemoItem label={t('memo.buylistFee')} value={money(d.memo.buylist.retainedFeeCents, locale)} />
                <MemoItem label={t('memo.buylistGuide')} value={money(d.memo.buylist.guideCostCents, locale)} />
              </dl>
            </div>

            {/* 4 · Marketplace: lugar reservado. Sin cifras inventadas: solo lo que manda el servidor (hoy `null`). */}
            <div data-testid="pnl-lines-marketplace" className="flex flex-col gap-1 border border-border bg-surface p-4">
              <p className="eyebrow text-muted">{t('marketplace.title')}</p>
              <p className="text-sm text-muted">{d.marketplace.available ? t('marketplace.available') : t('marketplace.reserved')}</p>
              <dl className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
                <MemoItem label={t('marketplace.gmv')} value={d.marketplace.gmvCents === null ? <Dash why={t('marketplace.none')} /> : money(d.marketplace.gmvCents, locale)} />
                <MemoItem label={t('marketplace.commission')} value={d.marketplace.commissionCents === null ? <Dash why={t('marketplace.none')} /> : money(d.marketplace.commissionCents, locale)} />
              </dl>
            </div>
          </div>
        )}
      </QueryState>
    </section>
  );
}

function MemoItem({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border py-1.5 last:border-b-0">
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-muted">{label}</dt>
        <dd className="tabular">{value}</dd>
      </div>
      {sub && <p className="text-xs text-muted">{sub}</p>}
    </div>
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
