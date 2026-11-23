'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getPnl, getSalesReport } from '@/lib/api';
import { SALES_MAX_DAYS, financeRange, periodSearch, type ReportPeriod } from '@/lib/reports/period';
import { salesParamsFor } from '@/lib/reports/sales-params';
import { PeriodSelector, useReportPeriod } from '@/components/domain/PeriodSelector';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { QueryState } from '@/components/ui/QueryState';
import { Link } from '@/i18n/navigation';
import { money } from '../m9/salesFormat';
import { SalesP2Totals } from '../m9/SalesP2';
import { Figure } from './Figure';

/**
 * Reportes › Compras a vendedores (§REPORTES-CEO F1): lo pagado a vendedores (`/admin/reports/sales` › `buylist`, antes en Ventas)
 * y la tarifa de envío descontada y las guías de compra (`/admin/finance/pnl`). Sin cifras nuevas; sin variación (F2).
 */
export function PurchasesView({ initialPeriod }: { initialPeriod: ReportPeriod }) {
  const t = useTranslations('admin.reports.purchases');
  const tm = useTranslations('admin.modules');
  const locale = useLocale() as AppLocale;
  const [period, setPeriod] = useReportPeriod(initialPeriod);
  const { from, to } = period;
  const range = financeRange(period);
  const pnl = useQuery({ queryKey: ['finance-pnl', range], queryFn: () => getPnl(range) });
  const sales = useQuery({ queryKey: ['board-sales', period.preset, from, to], queryFn: () => getSalesReport(salesParamsFor(period)) });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-h1 font-bold">{tm('reportsPurchases')}</h1>
      <p className="max-w-2xl text-sm text-muted">{t('intro')}</p>
      <PeriodSelector value={period} onChange={setPeriod} maxDays={SALES_MAX_DAYS} />

      <QueryState isLoading={sales.isLoading} isError={sales.isError} error={sales.error} onRetry={() => sales.refetch()}>
        {sales.data && (
          <div className="[&>section]:mx-0 [&>section]:border">
            <SalesP2Totals data={sales.data} only={['buylist']} />
          </div>
        )}
      </QueryState>

      <QueryState isLoading={pnl.isLoading} isError={pnl.isError} error={pnl.error} onRetry={() => pnl.refetch()}>
        {pnl.data && (
          <div className="grid divide-y divide-border border border-border bg-surface sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <Figure label={t('fee')} value={formatMoneyCents(pnl.data.buylistShippingFeeRetainedCents, locale)} note={t('feeNote')} />
            <Figure label={t('guides')} value={formatMoneyCents(pnl.data.buylistGuideCostCents, locale)} note={t('guidesNote')} />
            <Figure
              label={t('margin')}
              value={money(pnl.data.buylistGuideMarginCents, locale)}
              note={pnl.data.buylistGuideMarginCents < 0 ? t('marginNegative') : t('marginNote')}
            />
          </div>
        )}
      </QueryState>

      <p className="text-sm text-muted" data-testid="pnl-detail-link">
        {t.rich('pnlDetail', {
          link: (chunks) => (
            <Link href={`/admin/m7${periodSearch(period)}`} className="text-accent underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none">
              {chunks}
            </Link>
          ),
        })}
      </p>
      <p className="text-sm text-muted">
        {t.rich('queue', {
          link: (chunks) => (
            <Link href="/admin/m5" className="text-accent underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none">
              {chunks}
            </Link>
          ),
        })}
      </p>
    </div>
  );
}
