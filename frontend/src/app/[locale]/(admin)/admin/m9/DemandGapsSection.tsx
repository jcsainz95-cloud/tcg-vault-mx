'use client';

import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { DownloadCloud } from 'lucide-react';
import { DEMAND_SORTS, exportDemandGapsCsv, getDemandGaps, type DemandGapRowDTO, type DemandSort } from '@/lib/api/demand';
import { ApiClientError } from '@/lib/api-client';
import { formatMoneyCents } from '@/lib/format';
import type { AppLocale } from '@/i18n/routing';
import { Badge } from '@/components/ui/Badge';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { todayMx } from './salesParams';
import { triggerBlobDownload } from './BuyListTab';

const STALE_DAYS = 2;

/**
 * §DEMANDA F1 (API_CONTRACT_DEMANDA §1, §6) — «Demanda sin stock» en la lista de compra de M9 (`super_admin`).
 * - Pinta SOLO la lista blanca del DTO. ⛔ Ninguna cifra se calcula aquí (score, mercado y buylist vienen del servidor).
 * - `null` es «sin dato» (nunca `$0`). Filas `term`: solo lectura, SIN acciones. Sin botón a tienda aliada.
 * - `403` ⇒ la sección no se pinta.
 */
export function DemandGapsSection() {
  const t = useTranslations('admin.m9.demand');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const [sort, setSort] = useState<DemandSort>('score');
  const params = { sort, dir: 'desc' as const, limit: 200 };

  const query = useQuery({
    queryKey: ['demand-gaps', params],
    queryFn: () => getDemandGaps(params),
    placeholderData: keepPreviousData,
    retry: (n, e) => !(e instanceof ApiClientError && e.status === 403) && n < 1,
  });
  const csv = useMutation({
    mutationFn: () => exportDemandGapsCsv(params),
    onSuccess: ({ blob, filename }) => triggerBlobDownload(blob, filename ?? `demanda-sin-stock-${todayMx()}.csv`),
  });

  if (query.error instanceof ApiClientError && query.error.status === 403) return null;
  const data = query.data;
  const staleDays =
    data?.sources.matchedAt != null
      ? Math.floor((Date.now() - new Date(data.sources.matchedAt).getTime()) / 86_400_000)
      : null;

  return (
    <section aria-labelledby="demand-title" data-testid="demand-gaps" className="flex flex-col gap-4 border-t border-border pt-8">
      <header className="flex flex-col gap-1">
        <h2 id="demand-title" className="text-h2 font-semibold">
          {t('title')}
        </h2>
        <p className="text-sm text-muted">{t('subtitle')}</p>
        {staleDays != null && staleDays > STALE_DAYS && (
          <p data-testid="demand-stale" className="text-xs text-muted">
            {t('staleData', { days: staleDays })}
          </p>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <span className="eyebrow" id="demand-sort-label">
          {t('sortLabel')}
        </span>
        <div role="group" aria-labelledby="demand-sort-label" className="flex flex-wrap gap-2">
          {DEMAND_SORTS.map((s) => (
            <Button key={s} size="sm" variant={sort === s ? 'primary' : 'ghost'} aria-pressed={sort === s} onClick={() => setSort(s)}>
              {t(`sort.${s}`)}
            </Button>
          ))}
        </div>
        <Button
          className="ml-auto"
          variant="secondary"
          size="sm"
          loading={csv.isPending}
          onClick={() => csv.mutate()}
          disabled={!data}
        >
          <DownloadCloud size={16} aria-hidden /> {t('exportCsv')}
        </Button>
      </div>
      {csv.isError && (
        <Banner variant="danger" role="alert">
          {t('csvError')}
        </Banner>
      )}

      {query.isError && !data ? (
        <Banner
          variant="danger"
          role="alert"
          title={tc('errorTitle')}
          action={
            <Button size="sm" variant="secondary" onClick={() => query.refetch()}>
              {tc('retry')}
            </Button>
          }
        >
          {t('loadError')}
        </Banner>
      ) : !data ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : (
        <>
          {data.sources.search === 'off' && <Banner variant="info">{t('searchOff')}</Banner>}
          {(data.sources.wishlist === 'error' || data.sources.search === 'error') && (
            <Banner variant="warning" role="status">
              {t('sourceError')}
            </Banner>
          )}
          {data.rows.length === 0 ? (
            <EmptyState title={t('title')} body={t('empty')} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-left font-mono text-[11px] uppercase tracking-label text-muted">
                    <th scope="col" className="py-2 pr-3 font-normal">{t('colCard')}</th>
                    <th scope="col" className="py-2 pr-3 font-normal">{t('colSet')}</th>
                    <th scope="col" className="py-2 pr-3 font-normal">{t('colFinish')}</th>
                    <th scope="col" className="py-2 pr-3 font-normal">{t('colWishlist')}</th>
                    <th scope="col" className="py-2 pr-3 font-normal">{t('colSearch')}</th>
                    <th scope="col" className="py-2 pr-3 text-right font-normal">{t('colScore')}</th>
                    <th scope="col" className="py-2 pr-3 text-right font-normal">{t('colMarket')}</th>
                    <th scope="col" className="py-2 text-right font-normal">{t('colBuylist')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <GapRow key={r.key} row={r} locale={locale} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** Una fila. ⛔ Lee SOLO claves de la lista blanca; sin botones ni enlaces de acción (ni en «término»). */
function GapRow({ row, locale }: { row: DemandGapRowDTO; locale: AppLocale }) {
  const t = useTranslations('admin.m9.demand');
  const tFinish = useTranslations('finish');
  const wl = row.signals.find((s) => s.kind === 'wishlist');
  const se = row.signals.find((s) => s.kind === 'search');
  const none = (
    <>
      <span aria-hidden>—</span>
      <span className="sr-only">{t('noData')}</span>
    </>
  );
  const money = (c: number | null) => (c == null ? none : formatMoneyCents(c, locale));
  const isTerm = row.kind === 'term';
  return (
    <tr data-testid={isTerm ? 'demand-term-row' : 'demand-card-row'} className="border-b border-border align-top">
      <th scope="row" className="py-2 pr-3 text-left font-normal text-text">
        <span lang={isTerm ? undefined : 'en'}>{row.cardName}</span>
        {isTerm && (
          <span className="mt-1 flex flex-col gap-1">
            <Badge>{t('termBadge')}</Badge>
            <span className="text-xs text-muted">{t('termHint')}</span>
          </span>
        )}
      </th>
      <td className="py-2 pr-3 text-text">{row.setName ? <span lang="en">{row.setName}</span> : none}</td>
      <td className="py-2 pr-3 text-text">{row.finish ? tFinish(row.finish) : none}</td>
      <td className="tabular py-2 pr-3 text-text">{wl ? t('unitClients', { count: wl.count }) : none}</td>
      <td className="tabular py-2 pr-3 text-text">
        {se ? (
          <>
            {t('unitPeople', { count: se.count })}
            {se.days != null && <span className="block text-xs text-muted">{t('daysFmt', { days: se.days })}</span>}
          </>
        ) : (
          none
        )}
      </td>
      <td className="tabular py-2 pr-3 text-right text-text">{row.score}</td>
      <td className="tabular py-2 pr-3 text-right text-text">{money(row.marketCents)}</td>
      <td className="tabular py-2 text-right text-text">{money(row.buylistTodayCents)}</td>
    </tr>
  );
}
