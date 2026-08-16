'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { DownloadCloud, Users, ShoppingBag, HandCoins, Truck } from 'lucide-react';
import {
  getLaunchMetrics,
  exportFinanceCsv,
  type FinanceRange,
  type FinanceCsvReport,
} from '@/lib/api';
import type { LaunchMetricsDTO } from '@/types/contract';
import { downloadTextFile } from '@/lib/download';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { DateRangePresets } from '@/components/domain/DateRangePresets';
import { Banner } from '@/components/ui/Banner';
import { StatCard } from '@/components/ui/StatCard';
import { QueryState } from '@/components/ui/QueryState';

type MetricKey = 'users' | 'salesSettled' | 'buylistPaid' | 'withdrawalsNoDispute';
type GoalKey = 'N' | 'X' | 'Y' | 'Z';

const METRICS: { metric: MetricKey; goal: GoalKey; icon: React.ReactNode }[] = [
  { metric: 'users', goal: 'N', icon: <Users size={18} /> },
  { metric: 'salesSettled', goal: 'X', icon: <ShoppingBag size={18} /> },
  { metric: 'buylistPaid', goal: 'Y', icon: <HandCoins size={18} /> },
  { metric: 'withdrawalsNoDispute', goal: 'Z', icon: <Truck size={18} /> },
];

export function M9View() {
  const t = useTranslations('admin.m9');
  const tc = useTranslations('common');

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const range: FinanceRange = { from: from || undefined, to: to || undefined };

  const metrics = useQuery({ queryKey: ['launch-metrics', range], queryFn: () => getLaunchMetrics(range) });

  const exportMutation = useMutation({
    mutationFn: async (report: FinanceCsvReport) => {
      const csv = await exportFinanceCsv({ report, from: range.from, to: range.to, source: 'reports' });
      const suffix = [range.from, range.to].filter(Boolean).join('_') || 'all';
      downloadTextFile(`tcgvault_report_${report}_${suffix}.csv`, csv);
      return report;
    },
  });

  function goalSub(data: LaunchMetricsDTO, metric: MetricKey, goal: GoalKey): string {
    const target = data.goals?.[goal];
    if (target == null) return t('goalPending');
    const current = data[metric];
    const pct = target > 0 ? Math.round((current / target) * 100) : 0;
    return t('goalProgress', { current, target, pct });
  }

  return (
    <div className="flex flex-col gap-10">
      <h1 className="text-h1 font-bold">{t('title')}</h1>

      {/* Selector de rango de fechas */}
      <section className="flex flex-col gap-3">
        <h2 className="text-h2 font-semibold">{t('range.title')}</h2>
        <p className="text-sm text-muted">{t('range.subtitle')}</p>
        <DateRangePresets onSelect={({ from: f, to: tv }) => { setFrom(f); setTo(tv); }} />
        <div className="flex flex-wrap items-end gap-3">
          <Input label={t('range.from')} type="date" className="w-44" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input label={t('range.to')} type="date" className="w-44" value={to} onChange={(e) => setTo(e.target.value)} />
          {(from || to) && (
            <Button variant="ghost" onClick={() => { setFrom(''); setTo(''); }}>
              {t('range.clear')}
            </Button>
          )}
        </div>
      </section>

      {/* Métricas de lanzamiento vs metas N/X/Y/Z */}
      <section className="flex flex-col gap-3">
        <h2 className="text-h2 font-semibold">{t('metrics.title')}</h2>
        <p className="text-sm text-muted">{t('metrics.subtitle')}</p>
        <QueryState isLoading={metrics.isLoading} isError={metrics.isError} error={metrics.error} onRetry={() => metrics.refetch()}>
          {metrics.data && (
            <>
              {!metrics.data.goals && <Banner variant="info">{t('goalsUnset')}</Banner>}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {METRICS.map(({ metric, goal, icon }) => (
                  <StatCard
                    key={metric}
                    label={t(`metrics.${metric}`)}
                    value={metrics.data![metric]}
                    sub={goalSub(metrics.data!, metric, goal)}
                    icon={icon}
                  />
                ))}
              </div>
            </>
          )}
        </QueryState>
      </section>

      {/* Export */}
      <section className="flex flex-col gap-3">
        <h2 className="text-h2 font-semibold">{t('export.title')}</h2>
        <p className="text-sm text-muted">{t('export.subtitle')}</p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            loading={exportMutation.isPending && exportMutation.variables === 'pnl'}
            onClick={() => exportMutation.mutate('pnl')}
          >
            <DownloadCloud size={16} /> {t('export.pnl')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            loading={exportMutation.isPending && exportMutation.variables === 'iva'}
            onClick={() => exportMutation.mutate('iva')}
          >
            <DownloadCloud size={16} /> {t('export.iva')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            loading={exportMutation.isPending && exportMutation.variables === 'inventory'}
            onClick={() => exportMutation.mutate('inventory')}
          >
            <DownloadCloud size={16} /> {t('export.inventory')}
          </Button>
        </div>
        {exportMutation.isError && <Banner variant="danger" role="alert">{tc('errorGeneric')}</Banner>}
      </section>
    </div>
  );
}
