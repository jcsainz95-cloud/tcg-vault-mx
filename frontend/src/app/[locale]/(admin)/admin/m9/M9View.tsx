'use client';

import { useCallback, useRef, useState } from 'react';
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
import { cn } from '@/lib/cn';
import { SalesTab } from './SalesTab';
import { M9_TABS, SALES_DEFAULTS, type M9Tab, type SalesUrlState } from './salesParams';

type MetricKey = 'users' | 'salesSettled' | 'buylistPaid' | 'withdrawalsNoDispute';
type GoalKey = 'N' | 'X' | 'Y' | 'Z';

const METRICS: { metric: MetricKey; goal: GoalKey; icon: React.ReactNode }[] = [
  { metric: 'users', goal: 'N', icon: <Users size={18} /> },
  { metric: 'salesSettled', goal: 'X', icon: <ShoppingBag size={18} /> },
  { metric: 'buylistPaid', goal: 'Y', icon: <HandCoins size={18} /> },
  { metric: 'withdrawalsNoDispute', goal: 'Z', icon: <Truck size={18} /> },
];

/**
 * Reportes (M9) con dos pestañas de página (`DESIGN_SYSTEM §AN-UX.1`): **Ventas** (nueva, por defecto) y **Actividad**
 * (lo de antes, idéntico). `?tab=` en la URL; cada pestaña monta su consulta SOLO cuando está activa.
 */
export function M9View({
  initialTab = 'ventas',
  initialSales = SALES_DEFAULTS,
}: {
  initialTab?: M9Tab;
  initialSales?: SalesUrlState;
}) {
  const t = useTranslations('admin.m9');
  const tModules = useTranslations('admin.modules'); // §37.2: h1 = rótulo del menú
  const [tab, setTab] = useState<M9Tab>(initialTab);
  const refs = useRef<Record<M9Tab, HTMLButtonElement | null>>({ ventas: null, actividad: null });

  const selectTab = useCallback((next: M9Tab) => {
    setTab(next);
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (next === 'ventas') url.searchParams.delete('tab');
    else {
      // La pestaña «Actividad» no lleva los parámetros de «Ventas».
      url.search = '';
      url.searchParams.set('tab', next);
    }
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }, []);

  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, cur: M9Tab) {
    const i = M9_TABS.indexOf(cur);
    let next: M9Tab | null = null;
    if (e.key === 'ArrowRight') next = M9_TABS[(i + 1) % M9_TABS.length];
    else if (e.key === 'ArrowLeft') next = M9_TABS[(i - 1 + M9_TABS.length) % M9_TABS.length];
    else if (e.key === 'Home') next = M9_TABS[0];
    else if (e.key === 'End') next = M9_TABS[M9_TABS.length - 1];
    if (!next) return;
    e.preventDefault();
    selectTab(next);
    refs.current[next]?.focus();
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-h1 font-bold">{tModules('m9')}</h1>
      <div className="flex gap-5 overflow-x-auto border-b border-border" role="tablist" aria-label={tModules('m9')}>
        {M9_TABS.map((key) => {
          const active = tab === key;
          return (
            <button
              key={key}
              ref={(el) => {
                refs.current[key] = el;
              }}
              type="button"
              role="tab"
              id={`m9-tab-${key}`}
              aria-selected={active}
              aria-controls={`m9-panel-${key}`}
              tabIndex={active ? 0 : -1}
              onClick={() => selectTab(key)}
              onKeyDown={(e) => onKeyDown(e, key)}
              className={cn(
                '-mb-px inline-flex min-h-[44px] items-center whitespace-nowrap border-b-2 px-1 text-sm focus-visible:shadow-focus focus-visible:outline-none',
                active ? 'border-text text-text' : 'border-transparent text-muted hover:text-text',
              )}
            >
              {key === 'ventas' ? t('tabs.sales') : t('tabs.activity')}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`m9-panel-${tab}`} aria-labelledby={`m9-tab-${tab}`}>
        {tab === 'ventas' ? <SalesTab initial={initialSales} /> : <ActivityTab />}
      </div>
    </div>
  );
}

/** Pestaña «Actividad»: lo que M9 pintaba antes, SIN cambio (rango, metas, exportes). */
function ActivityTab() {
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
