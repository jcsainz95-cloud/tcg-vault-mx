'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getCustodyValue, getInventoryValue, getLaunchMetrics, getPnl, getSalesReport } from '@/lib/api';
import { usePickingSummary } from '@/hooks/usePickingSummary';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';
import { formatCount, formatMoneyCents } from '@/lib/format';
import { bpsOf, fmtPct } from '@/lib/reports/comparison';
import { SALES_MAX_DAYS, financeRange, periodSearch, type PeriodNotice, type ReportPeriod } from '@/lib/reports/period';
import { salesParamsFor } from '@/lib/reports/sales-params';
import { PeriodNoticeBanner, PeriodSelector, useInvalidPeriodFallback, useReportPeriod } from '@/components/domain/PeriodSelector';
import type { LaunchMetricsDTO } from '@/types/contract';
import { ComparisonNote } from '@/components/domain/ComparisonNote';
import { money } from '../m9/salesFormat';
import { Figure, Franja } from './Figure';

const DASH = '—';

type LaunchMetric = 'users' | 'salesSettled' | 'buylistPaid' | 'withdrawalsNoDispute';
type GoalKey = 'N' | 'X' | 'Y' | 'Z';
const LAUNCH: { metric: LaunchMetric; goal: GoalKey }[] = [
  { metric: 'users', goal: 'N' },
  { metric: 'salesSettled', goal: 'X' },
  { metric: 'buylistPaid', goal: 'Y' },
  { metric: 'withdrawalsNoDispute', goal: 'Z' },
];

/**
 * Reportes › Junta de dirección (§REPORTES-CEO F1, `API_CONTRACT_REPORTES §6`). Una franja por área con las cifras-titular que
 * HOY existen, todas del MISMO periodo (hora de México) y cada una enlazada a su informe. ⛔ El navegador no calcula nada:
 * dinero y variaciones salen tal cual de `/admin/finance/pnl`, `/admin/reports/sales` e inventario. Lo que aún no existe
 * (caja, dinero comprometido, inventario parado, clientes que regresan, alertas, metas) NO se pinta: llega en F2-F4.
 * Variación contra el MISMO tramo del periodo anterior (F2a) en Ventas y en el resultado de Finanzas; Compras y Operación sin ella.
 */
export function BoardView({ initialPeriod, initialNotice = null }: { initialPeriod: ReportPeriod; initialNotice?: PeriodNotice | null }) {
  const t = useTranslations('admin.reports.board');
  const tm = useTranslations('admin.modules');
  const locale = useLocale() as AppLocale;
  const [period, setPeriod] = useReportPeriod(initialPeriod);
  const { from, to } = period;
  const search = periodSearch(period);
  const range = financeRange(period);

  const pnl = useQuery({ queryKey: ['finance-pnl', range], queryFn: () => getPnl(range) });
  const sales = useQuery({
    queryKey: ['board-sales', period.preset, from, to],
    queryFn: () => getSalesReport(salesParamsFor(period)),
  });
  const launch = useQuery({ queryKey: ['launch-metrics', range], queryFn: () => getLaunchMetrics({ from: range.from, to: range.to }) });
  const inv = useQuery({ queryKey: ['finance-inventory-value'], queryFn: getInventoryValue });
  const custody = useQuery({ queryKey: ['finance-custody-value'], queryFn: getCustodyValue });
  const picking = usePickingSummary();
  const fallback = useInvalidPeriodFallback([sales.error, pnl.error], period, setPeriod, initialNotice);

  const st = sales.data?.totals;
  /** Avance contra la meta, de los dos conteos del servidor (`bpsOf` + `fmtPct`, un decimal fijo; sin meta ⇒ «Meta sin fijar»). */
  function goalNote(d: LaunchMetricsDTO, metric: LaunchMetric, goal: GoalKey): string {
    const target = d.goals?.[goal];
    if (target == null) return t('launch.goalPending');
    return t('launch.goalProgress', { current: d[metric], target, pct: fmtPct(bpsOf(d[metric], target), locale, false) as string });
  }
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

      <PeriodSelector value={period} onChange={fallback.onChange} maxDays={SALES_MAX_DAYS} />
      <PeriodNoticeBanner notice={fallback.notice} maxDays={SALES_MAX_DAYS} />
      {/* §2 (F2a): contra qué se compara, de la RESPUESTA (mismo tramo, «contra lo que hay», «sin periodo anterior»). */}
      {sales.data && (
        <ComparisonNote period={sales.data.period} previous={sales.data.previousPeriod} comparison={sales.data.comparison} testId="board-period" />
      )}

      <Franja id="finance" title={tm('m7')} ask={t('areas.finance.ask')} href={`/admin/m7${search}`} seeFull={t('seeFull')} queries={[pnl]}>
        {pnl.data && (
          <Figure
            label={t('areas.finance.profit')}
            value={money(pnl.data.profitCents, locale)}
            money={pnl.data.comparison?.figures.netResultCents}
            basis={pnl.data.comparison?.basis}
            note={t('areas.finance.profitNote')}
          />
        )}
      </Franja>

      <Franja id="sales" title={tm('m9')} ask={t('areas.sales.ask')} href={`/admin/m9${search}`} seeFull={t('seeFull')} queries={[sales]}>
        {st && (
          <>
            <Figure label={t('areas.sales.orders')} value={formatCount(st.orders, locale)} delta={sPrev?.orders} basis={sPrev?.basis} />
            <Figure label={t('areas.sales.net')} value={formatMoneyCents(st.netSalesCents, locale)} delta={sPrev?.netSalesCents} basis={sPrev?.basis} note={t('areas.sales.netNote')} />
            <Figure
              label={t('areas.sales.ticket')}
              value={st.avgTicketCents != null ? formatMoneyCents(st.avgTicketCents, locale) : DASH}
              delta={sPrev?.avgTicketCents}
              basis={sPrev?.basis}
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
        href={`/admin/reportes/inventario${search}`}
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

      <Franja
        id="metas"
        title={t('launch.title')}
        ask={t('launch.ask')}
        href="/admin"
        seeFull={t('launch.seeTotal')}
        queries={[launch]}
      >
        {launch.data && (
          <>
            {LAUNCH.map(({ metric, goal }) => (
              <Figure
                key={metric}
                label={t(`launch.${metric}`)}
                value={formatCount(launch.data![metric], locale)}
                note={goalNote(launch.data!, metric, goal)}
              />
            ))}
            {!launch.data.goals && <p className="px-5 py-3 text-xs text-muted sm:col-span-2 lg:col-span-4">{t('launch.goalsUnset')}</p>}
          </>
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
