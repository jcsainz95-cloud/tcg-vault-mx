'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getSalesReport } from '@/lib/api';
import { usePickingSummary } from '@/hooks/usePickingSummary';
import { useRole } from '@/lib/role';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';
import { formatCount } from '@/lib/format';
import type { ReportPeriod } from '@/lib/reports/period';
import { QueryState } from '@/components/ui/QueryState';
import { SalesP2Totals } from '../m9/SalesP2';
import { Figure } from './Figure';
import { PeriodPicker } from './PeriodPicker';
import { usePeriodState } from './usePeriodState';

/**
 * Reportes › Operación (§REPORTES-CEO F1). Para todo el personal: las colas en UNIDADES (`/admin/picking-list/summary`).
 * Solo súper-admin y con el periodo único: envío cobrado, costo de guías, resultado del envío y contracargos (antes en Ventas).
 * El operador no pide `/admin/reports/sales` (⛔ ni máscara: la consulta no existe para él).
 */
export function OpsView({ initialPeriod }: { initialPeriod: ReportPeriod }) {
  const t = useTranslations('admin.reports.ops');
  const tm = useTranslations('admin.modules');
  const locale = useLocale() as AppLocale;
  const { isSuperAdmin } = useRole();
  const [period, setPeriod] = usePeriodState(initialPeriod);
  const { from, to } = period;
  const picking = usePickingSummary();
  const sales = useQuery({
    queryKey: ['board-sales', from, to],
    queryFn: () => getSalesReport({ preset: 'custom', from, to, groupBy: 'day' }),
    enabled: isSuperAdmin,
  });
  const link = 'text-accent underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none';

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-h1 font-bold">{tm('reportsOps')}</h1>
      <p className="max-w-2xl text-sm text-muted">{t('intro')}</p>

      <section aria-labelledby="ops-queues" className="flex flex-col gap-3">
        <h2 id="ops-queues" className="text-h2 font-semibold">{t('queues')}</h2>
        <QueryState isLoading={picking.isLoading} isError={picking.isError} error={picking.error} onRetry={() => picking.refetch()}>
          {picking.data && (
            <div className="grid divide-y divide-border border border-border bg-surface sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
              <Figure label={t('ship')} value={formatCount(picking.data.ship, locale)} />
              <Figure label={t('vault')} value={formatCount(picking.data.vault, locale)} />
              <Figure
                label={t('toReplace')}
                value={formatCount(picking.data.toReplace, locale)}
                note={picking.data.toReplaceOverdue > 0 ? t('overdue', { count: picking.data.toReplaceOverdue }) : undefined}
              />
              <Figure label={t('stuckRefunds')} value={formatCount(picking.data.stuckRefunds, locale)} />
            </div>
          )}
        </QueryState>
        <p className="text-sm text-muted">
          {t.rich('queueLink', { link: (c) => <Link href="/admin/m4" className={link}>{c}</Link> })}
        </p>
      </section>

      {isSuperAdmin && (
        <section aria-labelledby="ops-money" className="flex flex-col gap-3">
          <h2 id="ops-money" className="text-h2 font-semibold">{t('shipping')}</h2>
          <PeriodPicker value={period} onChange={setPeriod} />
          <QueryState isLoading={sales.isLoading} isError={sales.isError} error={sales.error} onRetry={() => sales.refetch()}>
            {sales.data && <SalesP2Totals data={sales.data} only={['shipping', 'chargebacks']} />}
          </QueryState>
        </section>
      )}
    </div>
  );
}
