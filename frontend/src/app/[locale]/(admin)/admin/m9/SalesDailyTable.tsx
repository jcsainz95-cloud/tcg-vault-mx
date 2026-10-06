'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { AppLocale } from '@/i18n/routing';
import type { SalesFiguresDTO, SalesReportDTO } from '@/types/contract';
import { cn } from '@/lib/cn';
import { formatMoneyCents } from '@/lib/format';
import { NoData } from './SalesSummary';
import { Segmented } from './SalesBarChart';
import { bucketDays, fmtDay, fmtMonth, fmtRange, money, oneDecimal, signedMoney } from './salesFormat';
import type { SalesCols } from './salesParams';

interface Col {
  key: string;
  header: string;
  title?: string;
  render: (f: SalesFiguresDTO) => React.ReactNode;
}

/** ¿Llegaron los campos P2 de fase B? (⛔ `?? 0`: si no vienen, la vista P2 no existe, UX-AN-13). */
export function hasP2(f: SalesFiguresDTO): boolean {
  return f.shipping !== undefined && f.buylist !== undefined && f.profitCents !== undefined;
}

/**
 * Tabla por día / semana / mes (`§AN-UX.5`): TODAS las filas de `rows` (también las de cero) y un `tfoot` con
 * `totals` del DTO (⛔ nunca la suma de las filas, AN-1 / UX-AN-4).
 */
export function SalesDailyTable({
  data,
  cols,
  today,
  onCols,
  csv,
}: {
  data: SalesReportDTO;
  cols: SalesCols;
  today: string;
  onCols: (c: SalesCols) => void;
  csv: React.ReactNode;
}) {
  const t = useTranslations('admin.m9.sales');
  const locale = useLocale() as AppLocale;
  const fm = (n: number) => formatMoneyCents(n, locale);
  const unit = data.groupBy;
  const p2 = hasP2(data.totals);
  const view: SalesCols = p2 ? cols : 'sales';
  const includesToday = data.period.to === today;
  const range = fmtRange(data.period.from, data.period.to, locale);

  const salesCols: Col[] = [
    { key: 'orders', header: t('card.orders'), render: (f) => f.orders },
    { key: 'charged', header: t('card.charged'), render: (f) => fm(f.chargedCents) },
    { key: 'net', header: t('card.netSales'), render: (f) => fm(f.netSalesCents) },
    {
      key: 'refunds',
      header: t('card.refunds'),
      render: (f) => (f.refunds.count === 0 ? '0' : `${f.refunds.count} · ${fm(f.refunds.amountCents)}`),
    },
    { key: 'netAfter', header: t('card.netAfterRefunds'), render: (f) => money(f.netSalesAfterRefundsCents, locale) },
    { key: 'ticket', header: t('card.avgTicket'), render: (f) => (f.avgTicketCents === null ? <NoData /> : fm(f.avgTicketCents)) },
    {
      key: 'ppo',
      header: t('card.piecesPerOrder'),
      render: (f) => (f.piecesPerOrder === null ? <NoData /> : oneDecimal(f.piecesPerOrder, locale)),
    },
  ];

  const ts = data.totals.shipping;
  const moneyCols: Col[] = [];
  if (p2 && ts) {
    moneyCols.push({ key: 'shipCharged', header: t('table.shippingCharged'), render: (f) => fm(f.shipping!.chargedNetCents) });
    moneyCols.push({
      key: 'shipCost',
      header: t('table.shippingCost'),
      render: (f) => (
        <>
          {fm(f.shipping!.costNetCents)}
          {f.shipping!.costMissingCount > 0 && (
            <span className="ml-1 text-xs text-muted">
              <span aria-hidden>⚠ </span>
              {t('table.costMissing', { count: f.shipping!.costMissingCount })}
            </span>
          )}
        </>
      ),
    });
    moneyCols.push({
      key: 'shipAdj',
      header: t('table.shippingAdjustments'),
      title: t('table.shippingAdjustmentsHint'),
      render: (f) => fm(f.shipping!.adjustmentsCents),
    });
    if (ts.resultNetCents !== undefined) {
      moneyCols.push({
        key: 'shipResult',
        header: t('table.shippingResult'),
        // ⛔ AN-F-5: tal cual del DTO, nunca cobrado − costo. Signo siempre, en tinta.
        render: (f) =>
          f.shipping!.resultNetCents === undefined ? (
            <NoData />
          ) : (
            <span data-testid="sales-shipping-result">
              {signedMoney(f.shipping!.resultNetCents, locale)}
              {f.shipping!.costMissingCount > 0 && (
                <>
                  <span aria-hidden> ⚠</span>
                  <span className="sr-only">{t('table.shippingResultMaybeLower')}</span>
                </>
              )}
            </span>
          ),
      });
    }
    if (ts.buylistRevenueCents !== undefined) {
      moneyCols.push({ key: 'blRev', header: t('table.buylistRevenue'), render: (f) => (f.shipping!.buylistRevenueCents === undefined ? <NoData /> : fm(f.shipping!.buylistRevenueCents)) });
    }
    if (ts.buylistCostCents !== undefined) {
      moneyCols.push({ key: 'blCost', header: t('table.buylistCost'), render: (f) => (f.shipping!.buylistCostCents === undefined ? <NoData /> : fm(f.shipping!.buylistCostCents)) });
    }
    moneyCols.push({
      key: 'blPaid',
      header: t('table.buylistPaid'),
      render: (f) => (
        <>
          {`${f.buylist!.paidCount} · ${fm(f.buylist!.paidNetCents)}`}
          {f.buylist!.paidWithoutPayoutCount > 0 && (
            <span className="ml-1 text-xs text-muted">
              <span aria-hidden>⚠ </span>
              {t('table.payoutMissing', { count: f.buylist!.paidWithoutPayoutCount })}
            </span>
          )}
        </>
      ),
    });
    if (data.totals.chargebacks !== undefined) {
      moneyCols.push({
        key: 'chargebacks',
        header: t('table.chargebacks'),
        render: (f) =>
          !f.chargebacks ? <NoData /> : f.chargebacks.count === 0 ? '0' : `${f.chargebacks.count} · ${fm(f.chargebacks.amountCents)}`,
      });
    }
    moneyCols.push({ key: 'profit', header: t('table.profit'), render: (f) => money(f.profitCents!, locale) });
  }

  const columns = view === 'money' ? moneyCols : salesCols;

  const label = (r: { from: string; to: string }) => {
    if (unit === 'day') {
      const base = fmtDay(r.from, locale, { weekday: true });
      return includesToday && r.to === today ? (
        <>
          {base} <span className="text-xs text-muted">· {t('table.inProgress')}</span>
        </>
      ) : (
        base
      );
    }
    const days = bucketDays(r);
    const full = unit === 'week' ? days === 7 : r.from.endsWith('-01') && nextDayIsNewMonth(r.to);
    const base = unit === 'week' ? `${fmtDay(r.from, locale)} – ${fmtDay(r.to, locale)}` : fmtMonth(r.from, locale);
    return (
      <>
        {base}
        {!full && <span className="text-xs text-muted"> · {t('table.partialDays', { days })}</span>}
        {includesToday && r.to === today && <span className="text-xs text-muted"> · {t('table.inProgress')}</span>}
      </>
    );
  };

  const anyCostMissing = p2 && data.rows.some((r) => (r.shipping?.costMissingCount ?? 0) > 0);
  const anyPayoutMissing = p2 && data.rows.some((r) => (r.buylist?.paidWithoutPayoutCount ?? 0) > 0);
  const undated = data.chargebacksUndatedCount;

  return (
    <section aria-labelledby="sales-table-h" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="sales-table-h" className="text-h2 font-semibold">
          {t('table.title', { unit })}
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          {p2 && (
            <Segmented
              label={t('table.colsLabel')}
              value={view}
              options={[
                { value: 'sales', label: t('table.colsSales') },
                { value: 'money', label: t('table.colsMoney') },
              ]}
              onChange={onCols}
            />
          )}
        </div>
      </div>
      {csv}
      {data.rows.length > 31 && <p className="text-xs text-muted md:hidden">{t('table.tooMany')}</p>}

      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse" data-testid="sales-table">
          <caption className="sr-only">{t('table.caption', { unit, from: range.from, to: range.to })}</caption>
          <thead className="sticky top-0 bg-bg">
            <tr className="border-y border-border">
              <th scope="col" className="eyebrow sticky left-0 bg-bg py-3.5 pr-5 text-left font-medium">
                {t('table.colPeriod', { unit })}
              </th>
              {columns.map((c) => (
                <th key={c.key} scope="col" title={c.title} className="eyebrow py-3.5 pr-5 text-right font-medium last:pr-0">
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => {
              const zero = r.orders === 0 && r.refunds.count === 0;
              return (
                <tr key={r.from} data-testid="sales-row" data-from={r.from} className={cn('border-b border-border', zero && 'text-muted')}>
                  <th scope="row" className="sticky left-0 bg-bg py-3 pr-5 text-left text-sm font-normal">
                    {label(r)}
                  </th>
                  {columns.map((c) => (
                    <td key={c.key} className={cn('tabular py-3 pr-5 text-right text-sm last:pr-0', zero ? 'text-muted' : 'text-text')}>
                      {c.render(r)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-b border-border-strong" data-testid="sales-total-row">
              <th scope="row" className="sticky left-0 bg-bg py-3 pr-5 text-left text-sm font-medium">
                {t('table.total')}
              </th>
              {columns.map((c) => (
                <td key={c.key} className="tabular py-3 pr-5 text-right text-sm font-medium text-text last:pr-0">
                  {c.render(data.totals)}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      {/* < md: cada fila colapsa a tarjeta (§7.7). */}
      <div className="md:hidden">
        {data.rows.map((r) => (
          <div key={r.from} data-testid="sales-row-card" className={cn('border-b border-border py-3 first:border-t', r.orders === 0 && r.refunds.count === 0 && 'text-muted')}>
            <p className="text-sm font-medium">{label(r)}</p>
            {columns.map((c) => (
              <div key={c.key} className="flex items-center justify-between gap-3 py-1">
                <span className="eyebrow">{c.header}</span>
                <span className="tabular text-sm">{c.render(r)}</span>
              </div>
            ))}
          </div>
        ))}
        <div className="border-b border-border-strong py-3">
          <p className="text-sm font-medium">{t('table.total')}</p>
          {columns.map((c) => (
            <div key={c.key} className="flex items-center justify-between gap-3 py-1">
              <span className="eyebrow">{c.header}</span>
              <span className="tabular text-sm font-medium">{c.render(data.totals)}</span>
            </div>
          ))}
        </div>
      </div>

      {view === 'money' && (
        <div className="flex flex-col gap-1 text-xs text-muted">
          <p>{t('table.profitNote')}</p>
          {ts?.resultNetCents !== undefined && <p>{t('table.shippingResultNote')}</p>}
          {anyCostMissing && (
            <p>
              <span aria-hidden>⚠ </span>
              {t('table.costMissingNote')}
            </p>
          )}
          {anyPayoutMissing && (
            <p>
              <span aria-hidden>⚠ </span>
              {t('table.payoutMissingNote')}
            </p>
          )}
          {data.totals.chargebacks !== undefined && <p>{t('table.chargebacksNote')}</p>}
          {data.totals.chargebacks !== undefined && undated !== undefined && undated > 0 && (
            <p data-testid="sales-chargebacks-undated">
              <span aria-hidden>⚠ </span>
              {t('chargebacks.undated', { count: undated })}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function nextDayIsNewMonth(ymd: string): boolean {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.getUTCDate() === 1;
}
