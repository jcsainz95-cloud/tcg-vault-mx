'use client';

import { useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { DownloadCloud } from 'lucide-react';
import { exportSalesCsv, getSalesReport } from '@/lib/api';
import { asApiError } from '@/lib/api-client';
import type { SalesReportDTO, SalesReportParams } from '@/types/contract';
import { cn } from '@/lib/cn';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { SalesPeriodLabel, SalesPeriodPicker, type FieldError } from './SalesPeriodPicker';
import { SALES_GRID, SalesSummary } from './SalesSummary';
import { SalesBarChart } from './SalesBarChart';
import { SalesDailyTable } from './SalesDailyTable';
import { SalesTopLists } from './SalesTopLists';
import { SalesMix, SalesP2Totals, SalesWhen } from './SalesP2';
import { toReportParams, todayMx, validateRange, writeSalesUrl, type SalesUrlState } from './salesParams';

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Lo que exporta el CSV: el periodo y la agrupación QUE SE VEN (UX-AN-14), ⛔ nunca otro. */
function shownParams(d: SalesReportDTO): SalesReportParams {
  return d.period.preset === 'custom'
    ? { preset: 'custom', from: d.period.from, to: d.period.to, groupBy: d.groupBy }
    : { preset: d.period.preset, groupBy: d.groupBy };
}

/**
 * Pestaña «Ventas» de Reportes (`DESIGN_SYSTEM §AN-UX`, contrato §15, criterios 600–613 y 620–624).
 * ⛔ AN-1: todo número sale TAL CUAL del `SalesReportDTO`; esta vista no suma, no promedia, no resta, no reordena.
 */
export function SalesTab({ initial }: { initial: SalesUrlState }) {
  const t = useTranslations('admin.m9.sales');
  const tc = useTranslations('common');
  const [state, setState] = useState<SalesUrlState>(initial);
  const params = toReportParams(state);
  const today = todayMx();

  const query = useQuery({
    queryKey: ['sales-report', params],
    queryFn: () => getSalesReport(params),
    placeholderData: keepPreviousData,
    retry: false,
  });

  // Último informe bueno: si la consulta nueva falla, los datos previos se quedan visibles, atenuados (§AN-UX.10).
  const lastGood = useRef<SalesReportDTO | undefined>(undefined);
  if (query.data && !query.isPlaceholderData) lastGood.current = query.data;
  const shown = query.data ?? lastGood.current;

  function update(patch: Partial<SalesUrlState>) {
    setState((s) => {
      const next = { ...s, ...patch };
      writeSalesUrl(next);
      return next;
    });
  }

  const csv = useMutation({
    mutationFn: (p: SalesReportParams) => exportSalesCsv(p),
    onSuccess: ({ blob, filename }, p) => {
      triggerBlobDownload(blob, filename ?? `ventas_${p.from ?? p.preset}_${p.to ?? ''}_${p.groupBy}.csv`);
    },
  });

  const err = query.isError ? asApiError(query.error) : null;
  const forbidden = err?.status === 403;
  let fieldError: FieldError | null = null;
  let genericInvalid = false;
  if (err?.status === 400) {
    const field = err.details?.field;
    if (field === 'from' || field === 'to') {
      const local = state.from && state.to ? validateRange(state.from, state.to, today) : null;
      fieldError =
        local && local.field === field ? local : { field, key: field === 'to' ? 'toFuture' : 'fromAfterTo' };
    } else genericInvalid = true;
  }
  const otherError = query.isError && !forbidden && err?.status !== 400;
  const updating = query.isFetching && query.isPlaceholderData;

  const csvBlock = shown && (
    <div className="flex flex-col gap-2">
      <div>
        <Button
          variant="secondary"
          size="sm"
          loading={csv.isPending}
          onClick={() => csv.mutate(shownParams(shown))}
          data-testid="sales-csv"
        >
          <DownloadCloud size={16} aria-hidden /> {t('csv.button')}
        </Button>
      </div>
      <p className="text-xs text-muted">{t('csv.help', { unit: shown.groupBy })}</p>
      {csv.isError && (
        <Banner variant="danger" role="alert">
          {t('csv.error')}
        </Banner>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-3">
        <SalesPeriodPicker
          preset={state.preset}
          from={state.from}
          to={state.to}
          groupBy={state.groupBy}
          serverError={fieldError}
          onPreset={(p) => update({ preset: p, from: undefined, to: undefined })}
          onCustom={(from, to) => update({ preset: 'custom', from, to })}
          onGroupBy={(g) => update({ groupBy: g })}
        />
        {shown && <SalesPeriodLabel data={shown} />}
      </div>

      {forbidden && (
        <Banner variant="danger" role="alert">
          {t('state.forbidden')}
        </Banner>
      )}
      {genericInvalid && (
        <Banner variant="danger" role="alert">
          {t('range.invalid')}
        </Banner>
      )}
      {otherError && (
        <Banner
          variant="danger"
          role="alert"
          action={
            <Button size="sm" variant="secondary" onClick={() => query.refetch()}>
              {tc('retry')}
            </Button>
          }
        >
          {t('state.error')}
        </Banner>
      )}

      {!shown && query.isLoading && <SalesSkeleton />}

      {shown && !forbidden && (
        <div
          aria-busy={updating || undefined}
          data-testid="sales-region"
          className={cn('flex flex-col gap-10', (updating || query.isError) && 'opacity-60')}
        >
          {updating && <span className="sr-only">{t('state.updating')}</span>}
          {shown.totals.orders === 0 && shown.totals.refunds.count === 0 && (
            <div data-testid="sales-empty">
              <Banner variant="info">{t('state.empty')}</Banner>
            </div>
          )}
          <SalesSummary data={shown} />
          <SalesBarChart
            data={shown}
            metric={state.chart}
            today={today}
            onMetric={(m) => update({ chart: m })}
            onWeek={() => update({ groupBy: 'week' })}
          />
          <SalesDailyTable data={shown} cols={state.cols} today={today} onCols={(c) => update({ cols: c })} csv={csvBlock} />
          <SalesP2Totals data={shown} />
          <SalesTopLists top={shown.top} tab={state.top} onTab={(k) => update({ top: k })} onSort={(s) => update({ topSort: s })} />
          {shown.bestDays && <SalesWhen bestDays={shown.bestDays} totalOrders={shown.totals.orders} />}
          {shown.mix && <SalesMix mix={shown.mix} totalOrders={shown.totals.orders} totalPieces={shown.totals.pieces} />}
        </div>
      )}
    </div>
  );
}

function SalesSkeleton() {
  return (
    <div className="flex flex-col gap-10" data-testid="sales-skeleton">
      <div className={SALES_GRID}>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="px-6 py-7 sm:px-10">
            <Skeleton className="h-16" />
          </div>
        ))}
      </div>
      <Skeleton className="h-[200px] w-full md:h-[240px]" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    </div>
  );
}
