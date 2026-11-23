'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getCustodyValue, getInventoryValue, getPnl, getSalesReport } from '@/lib/api';
import { usePickingSummary } from '@/hooks/usePickingSummary';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';
import { formatCount, formatMoneyCents } from '@/lib/format';
import { periodSearch, type ReportPeriod } from '@/lib/reports/period';
import { fmtRange, money } from '../m9/salesFormat';
import { Figure, Franja } from './Figure';
import { PeriodPicker } from './PeriodPicker';
import { usePeriodState } from './usePeriodState';

const DASH = '—';

/**
 * Reportes › Junta de dirección (§REPORTES-CEO F1, `API_CONTRACT_REPORTES §6`). Una franja por área con las cifras-titular que
 * HOY existen, todas del MISMO periodo (hora de México) y cada una enlazada a su informe. ⛔ El navegador no calcula nada:
 * dinero y variaciones salen tal cual de `/admin/finance/pnl`, `/admin/reports/sales` e inventario. Lo que aún no existe
 * (caja, dinero comprometido, inventario parado, clientes que regresan, alertas, metas) NO se pinta: llega en F2-F4.
 * Variación vs periodo anterior solo donde el servidor ya la da (Ventas); Finanzas, Compras y Operación sin ella (F2).
 */
export function BoardView({ initialPeriod }: { initialPeriod: ReportPeriod }) {
  const t = useTranslations('admin.reports.board');
  const tm = useTranslations('admin.modules');
  const locale = useLocale() as AppLocale;
  const [period, setPeriod] = usePeriodState(initialPeriod);
  const { from, to } = period;
  const search = periodSearch(period);

  const pnl = useQuery({ queryKey: ['finance-pnl', { from, to }], queryFn: () => getPnl({ from, to }) });
  const sales = useQuery({
    queryKey: ['board-sales', from, to],
    queryFn: () => getSalesReport({ preset: 'custom', from, to, groupBy: 'day' }),
  });
  const inv = useQuery({ queryKey: ['finance-inventory-value'], queryFn: getInventoryValue });
  const custody = useQuery({ queryKey: ['finance-custody-value'], queryFn: getCustodyValue });
  const picking = usePickingSummary();

  const own = fmtRange(from, to, locale);
  const prev = sales.data ? fmtRange(sales.data.previousPeriod.from, sales.data.previousPeriod.to, locale) : null;
  const st = sales.data?.totals;
  const sPrev = sales.data?.comparison;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <nav aria-label="breadcrumb" className="text-xs text-muted">
          <span>{t('breadcrumb')}</span>
        </nav>
        <h1 className="text-h1 font-bold">{tm('reportsBoard')}</h1>
        <p className="max-w-2xl text-sm text-muted">{t('intro')}</p>
      </div>

      <PeriodPicker value={period} onChange={setPeriod} />
      <p className="text-sm text-muted" data-testid="board-period">
        {prev ? t('comparedWith', { from: own.from, to: own.to, prevFrom: prev.from, prevTo: prev.to }) : t('rangeOnly', { from: own.from, to: own.to })}
      </p>

      <Franja id="finance" title={tm('m7')} ask={t('areas.finance.ask')} href={`/admin/m7${search}`} seeFull={t('seeFull')} queries={[pnl]}>
        {pnl.data && (
          <Figure
            label={t('areas.finance.profit')}
            value={money(pnl.data.profitCents, locale)}
            note={t('areas.finance.profitNote')}
          />
        )}
      </Franja>

      <Franja id="sales" title={tm('m9')} ask={t('areas.sales.ask')} href={`/admin/m9${search}`} seeFull={t('seeFull')} queries={[sales]}>
        {st && (
          <>
            <Figure label={t('areas.sales.orders')} value={formatCount(st.orders, locale)} delta={sPrev?.orders} />
            <Figure label={t('areas.sales.net')} value={formatMoneyCents(st.netSalesCents, locale)} delta={sPrev?.netSalesCents} note={t('areas.sales.netNote')} />
            <Figure
              label={t('areas.sales.ticket')}
              value={st.avgTicketCents != null ? formatMoneyCents(st.avgTicketCents, locale) : DASH}
              delta={sPrev?.avgTicketCents}
              note={t('areas.sales.ticketNote')}
            />
            <Figure
              label={t('areas.sales.customers')}
              value={t('areas.sales.customersValue', { new: sales.data!.customers.new, returning: sales.data!.customers.returning })}
            />
          </>
        )}
      </Franja>

      <Franja
        id="purchases"
        title={tm('reportsPurchases')}
        ask={t('areas.purchases.ask')}
        href={`/admin/reportes/compras${search}`}
        seeFull={t('seeFull')}
        queries={[sales, pnl]}
      >
        {st?.buylist && (
          <Figure
            label={t('areas.purchases.paid')}
            value={formatMoneyCents(st.buylist.paidNetCents, locale)}
            note={t('areas.purchases.paidCount', { count: st.buylist.paidCount })}
          />
        )}
        {pnl.data && (
          <>
            <Figure label={t('areas.purchases.fee')} value={formatMoneyCents(pnl.data.buylistShippingFeeRetainedCents, locale)} />
            <Figure label={t('areas.purchases.guides')} value={formatMoneyCents(pnl.data.buylistGuideCostCents, locale)} />
          </>
        )}
      </Franja>

      <Franja
        id="stock"
        title={tm('reportsStock')}
        ask={t('areas.stock.ask')}
        href="/admin/reportes/inventario"
        seeFull={t('seeFull')}
        queries={[inv, custody]}
      >
        {inv.data && (
          <Figure
            label={t('areas.stock.reference')}
            value={formatMoneyCents(inv.data.atReferenceCents, locale)}
            note={t('areas.stock.referenceNote', { cost: formatMoneyCents(inv.data.atCostCents, locale), pending: inv.data.pendingPriceCount })}
          />
        )}
        {custody.data && (
          <Figure label={t('areas.stock.custody')} value={formatMoneyCents(custody.data.totalCustodyValueCents, locale)} note={t('areas.stock.custodyNote')} />
        )}
      </Franja>

      <Franja
        id="ops"
        title={tm('reportsOps')}
        ask={t('areas.ops.ask')}
        href={`/admin/reportes/operacion${search}`}
        seeFull={t('seeFull')}
        queries={[picking, sales]}
      >
        {picking.data && (
          <>
            <Figure label={t('areas.ops.ship')} value={formatCount(picking.data.ship, locale)} />
            <Figure label={t('areas.ops.vault')} value={formatCount(picking.data.vault, locale)} />
            <Figure
              label={t('areas.ops.toReplace')}
              value={formatCount(picking.data.toReplace, locale)}
              note={picking.data.toReplaceOverdue > 0 ? t('areas.ops.overdue', { count: picking.data.toReplaceOverdue }) : undefined}
            />
          </>
        )}
        {st?.shipping?.resultNetCents !== undefined && (
          <Figure label={t('areas.ops.shippingResult')} value={money(st.shipping.resultNetCents, locale)} note={t('areas.ops.shippingResultNote')} />
        )}
      </Franja>

      <section aria-labelledby="franja-marketing" data-testid="franja-marketing" className="border border-border bg-surface px-5 py-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="franja-marketing" className="font-serif text-[22px] leading-tight">
            {tm('marketing')}
          </h2>
          <Link
            href="/admin/marketing"
            className="min-h-[24px] text-sm text-accent underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
          >
            {t('seeFull')} <span aria-hidden>→</span>
          </Link>
        </div>
        <p className="pt-1 text-sm italic text-muted">{t('areas.marketing.ask')}</p>
        <p className="pt-3 text-sm text-text">{t('areas.marketing.body')}</p>
      </section>
    </div>
  );
}
