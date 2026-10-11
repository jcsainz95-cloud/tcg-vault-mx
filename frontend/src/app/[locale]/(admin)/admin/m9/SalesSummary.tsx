'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { AppLocale } from '@/i18n/routing';
import type { SalesDeltaDTO, SalesReportDTO } from '@/types/contract';
import { formatMoneyCents } from '@/lib/format';
import { StatCard } from '@/components/ui/StatCard';
import { money, oneDecimal, signOf, signedMoney } from './salesFormat';

/** Retícula de celdas igual que el tablero (§7.8). */
export const SALES_GRID =
  'grid -mx-5 lg:-mx-10 border-y border-border divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4 [&>*:nth-child(n+5)]:sm:border-t';

type Unit = 'orders' | 'money' | 'ppo';

/**
 * Línea de comparación (`§AN-UX.3`): unidades ANTES que el porcentaje (AN-3), `text-muted` siempre (⛔ verde/rojo,
 * AN-6/UX-AN-17), flecha `aria-hidden` y `sr-only` «subió/bajó/igual». `diff` y `pct` tal cual del DTO (⛔ calcular).
 */
export function SalesDelta({
  delta,
  unit,
  prevOrders,
  currOrders,
  before,
  testId,
}: {
  delta: SalesDeltaDTO;
  unit: Unit;
  prevOrders: number;
  currOrders: number;
  /** valor anterior ya formateado (de `previousTotals`, tal cual) para «Antes: …». */
  before?: string;
  testId: string;
}) {
  const t = useTranslations('admin.m9.sales');
  const locale = useLocale() as AppLocale;
  const cls = 'font-mono text-xs text-muted';

  if (delta.diff === null) {
    let text: string | null = null;
    if (prevOrders === 0) text = t('delta.noPreviousAlone');
    else if (currOrders === 0 && before !== undefined) text = t('delta.before', { value: before });
    if (!text) return null;
    return (
      <span className={cls} data-testid={testId}>
        {text}
      </span>
    );
  }
  if (delta.diff === 0) {
    return (
      <span className={cls} data-testid={testId}>
        {/* «igual» ya lo dice el texto visible («Igual que el periodo anterior»); no hay clave sr-only aparte. */}
        <span aria-hidden>= </span>
        {t('delta.same')}
      </span>
    );
  }
  const up = delta.diff > 0;
  const abs = Math.abs(delta.diff);
  const sign = signOf(delta.diff);
  const units =
    unit === 'orders'
      ? `${sign}${t('delta.orders', { diff: abs })}`
      : unit === 'money'
        ? signedMoney(delta.diff, locale)
        : `${sign}${t('delta.piecesPerOrder', { diff: oneDecimal(abs, locale) })}`;
  const tail =
    delta.pct !== null
      ? `${signOf(delta.pct)}${Math.abs(delta.pct)} %`
      : prevOrders === 0
        ? t('delta.noPrevious')
        : t('delta.wasZero');
  return (
    <span className={cls} data-testid={testId}>
      <span className="sr-only">{up ? t('delta.up') : t('delta.down')} </span>
      <span aria-hidden>{up ? '▲' : '▼'} </span>
      {units} · {tail}
    </span>
  );
}

/** «—» con su `sr-only` (AN-2): ⛔ nunca «MX$0.00», `NaN` ni `Infinity`. */
export function NoData() {
  const t = useTranslations('admin.m9.sales');
  return (
    <>
      <span aria-hidden>—</span>
      <span className="sr-only">{t('noData')}</span>
    </>
  );
}

/** Las ocho celdas del periodo (`§AN-UX.3`), cada cifra tal cual del DTO. */
export function SalesSummary({ data }: { data: SalesReportDTO }) {
  const t = useTranslations('admin.m9.sales');
  const locale = useLocale() as AppLocale;
  const { totals: tt, previousTotals: pt, comparison: c, customers } = data;
  const po = pt.orders;
  const co = tt.orders;
  const fm = (n: number) => formatMoneyCents(n, locale);

  const cell = (key: string, value: React.ReactNode) => <span data-testid={`sales-card-${key}`}>{value}</span>;

  return (
    <section aria-labelledby="sales-summary-h" className="flex flex-col gap-3">
      <h2 id="sales-summary-h" className="text-h2 font-semibold">
        {t('summary.title')}
      </h2>
      <div className={SALES_GRID}>
        <StatCard
          label={t('card.orders')}
          value={cell('orders', tt.orders)}
          sub={<SalesDelta delta={c.orders} unit="orders" prevOrders={po} currOrders={co} testId="sales-delta-orders" />}
        />
        <StatCard
          label={t('card.charged')}
          value={cell('chargedCents', fm(tt.chargedCents))}
          sub={
            <span className="flex flex-col gap-0.5">
              <span>{t('card.chargedHelp')}</span>
              <SalesDelta delta={c.chargedCents} unit="money" prevOrders={po} currOrders={co} testId="sales-delta-chargedCents" />
            </span>
          }
        />
        <StatCard
          label={t('card.netSales')}
          value={cell('netSalesCents', fm(tt.netSalesCents))}
          sub={
            <span className="flex flex-col gap-0.5">
              <span>{t('card.netSalesHelp')}</span>
              <SalesDelta delta={c.netSalesCents} unit="money" prevOrders={po} currOrders={co} testId="sales-delta-netSalesCents" />
            </span>
          }
        />
        <StatCard
          label={t('card.refunds')}
          value={cell('refundsAmountCents', fm(tt.refunds.amountCents))}
          sub={
            <span className="flex flex-col gap-0.5">
              {tt.refunds.count === 0 ? (
                <span>{t('card.refundsNone')}</span>
              ) : (
                <>
                  <span>
                    {t('card.refundsDetail', {
                      count: tt.refunds.count,
                      card: fm(tt.refunds.byChannel.card.amountCents),
                      spei: fm(tt.refunds.byChannel.spei.amountCents),
                    })}
                  </span>
                  <span>{t('card.refundsNet', { amount: fm(tt.refunds.netCents) })}</span>
                </>
              )}
              <SalesDelta delta={c.refundsAmountCents} unit="money" prevOrders={po} currOrders={co} testId="sales-delta-refundsAmountCents" />
            </span>
          }
        />
        <StatCard
          label={t('card.netAfterRefunds')}
          value={cell('netSalesAfterRefundsCents', money(tt.netSalesAfterRefundsCents, locale))}
          sub={
            <span className="flex flex-col gap-0.5">
              <span>{t('card.netAfterRefundsHelp')}</span>
              {tt.netSalesAfterRefundsCents < 0 && <span>{t('card.netAfterRefundsNegative')}</span>}
              <SalesDelta
                delta={c.netSalesAfterRefundsCents}
                unit="money"
                prevOrders={po}
                currOrders={co}
                testId="sales-delta-netSalesAfterRefundsCents"
              />
            </span>
          }
        />
        <StatCard
          label={t('card.avgTicket')}
          value={cell('avgTicketCents', tt.avgTicketCents === null ? <NoData /> : fm(tt.avgTicketCents))}
          sub={
            <span className="flex flex-col gap-0.5">
              <span>{t('card.avgTicketHelp')}</span>
              <SalesDelta
                delta={c.avgTicketCents}
                unit="money"
                prevOrders={po}
                currOrders={co}
                before={pt.avgTicketCents === null ? undefined : fm(pt.avgTicketCents)}
                testId="sales-delta-avgTicketCents"
              />
            </span>
          }
        />
        <StatCard
          label={t('card.piecesPerOrder')}
          value={cell('piecesPerOrder', tt.piecesPerOrder === null ? <NoData /> : oneDecimal(tt.piecesPerOrder, locale))}
          sub={
            <span className="flex flex-col gap-0.5">
              <span>{t('card.pieces', { count: tt.pieces })}</span>
              <SalesDelta
                delta={c.piecesPerOrder}
                unit="ppo"
                prevOrders={po}
                currOrders={co}
                before={pt.piecesPerOrder === null ? undefined : oneDecimal(pt.piecesPerOrder, locale)}
                testId="sales-delta-piecesPerOrder"
              />
            </span>
          }
        />
        <StatCard
          label={t('card.customers')}
          value={cell('customers', customers.distinct)}
          sub={
            <span className="flex flex-col gap-0.5">
              <span>{t('card.customersSplit', { new: customers.new, returning: customers.returning })}</span>
              <span>{t('card.customersHelp')}</span>
            </span>
          }
        />
      </div>
    </section>
  );
}
