'use client';

import { useMemo, useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { DownloadCloud, Info, Printer } from 'lucide-react';
import { exportWishlistDemandCsv, getWishlistDemand } from '@/lib/api';
import { formatDateTimeMx, formatMoneyCents } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';
import {
  WISHLIST_DEMAND_SORTS,
  type WishlistDemandResponse,
  type WishlistDemandRowDTO,
  type WishlistDemandSort,
} from '@/types/contract';
import { Badge } from '@/components/ui/Badge';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { CardImage } from '@/components/ui/CardImage';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { useErrorMessage } from '@/components/ui/QueryState';
import { todayMx } from './salesParams';
import { toBuyListParams as toParams, type BuyListUrlState } from './buyListParams';

export type { BuyListUrlState };

function writeUrl(s: BuyListUrlState) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.set('tab', 'compra');
  if (s.sort) {
    url.searchParams.set('sort', s.sort);
    url.searchParams.set('dir', s.dir);
  } else {
    url.searchParams.delete('sort');
    url.searchParams.delete('dir');
  }
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
}

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

/**
 * Pestaña «Lista de compra» de Reportes (DESIGN_SYSTEM §WSH-UX.7 · API_CONTRACT §WSH.8 + v1.87.1).
 *
 * - **Sin datos personales (821, WSH-UX-8):** se pinta SOLO la lista blanca de `WishlistDemandRowDTO`, campo por campo.
 *   ⛔ Nunca se itera el objeto ni se vuelca: una clave de más en el DTO no llega al DOM.
 * - **`null` es «sin dato» (820, WSH-UX-9):** «—» con `sr-only`; ⛔ nunca `MX$0.00`.
 * - **Margen (WSH-UX-10):** el signo va en el TEXTO («pierdes», «−»), no solo en el color. `pct` llega en PUNTOS
 *   porcentuales (v1.87.1, Q-WSH-UX-8) y se pinta tal cual con un decimal.
 * - **Filtros en el navegador (Q-WSH-UX-7):** el contrato solo tiene `sort`/`dir`; el CSV es SIEMPRE la lista completa.
 * - ⛔ Ninguna cifra se calcula aquí (WSH-F7): todas salen del DTO.
 */
export function BuyListTab({ initial = { dir: 'desc' } }: { initial?: BuyListUrlState }) {
  const t = useTranslations('admin.m9.buyList');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const getMessage = useErrorMessage('operator');
  const [state, setState] = useState<BuyListUrlState>(initial);
  const [text, setText] = useState('');
  const [hideNoMarket, setHideNoMarket] = useState(false);

  const params = toParams(state);
  const query = useQuery({
    queryKey: ['wishlist-demand', params],
    queryFn: () => getWishlistDemand(params),
    placeholderData: keepPreviousData,
  });

  const lastGood = useRef<WishlistDemandResponse | undefined>(undefined);
  if (query.data && !query.isPlaceholderData) lastGood.current = query.data;
  const shown = query.data ?? lastGood.current;

  function update(next: BuyListUrlState) {
    setState(next);
    writeUrl(next);
  }

  const csv = useMutation({
    mutationFn: () => exportWishlistDemandCsv(params),
    onSuccess: ({ blob, filename }) => triggerBlobDownload(blob, filename ?? `lista-de-compra-${todayMx()}.csv`),
  });

  const needle = text.trim().toLowerCase();
  const filterActive = needle.length > 0 || hideNoMarket;
  const rows = useMemo(() => {
    const all = shown?.rows ?? [];
    return all.filter((r) => {
      if (hideNoMarket && r.marketCents == null) return false;
      if (!needle) return true;
      return [r.cardName, r.setName, r.number].some((v) => v.toLowerCase().includes(needle));
    });
  }, [shown, needle, hideNoMarket]);

  const sortChips: { key: WishlistDemandSort | 'default'; label: string }[] = [
    { key: 'default', label: t('sort.default') },
    ...WISHLIST_DEMAND_SORTS.map((s) => ({ key: s, label: t(`sort.${s}`) })),
  ];

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h2 className="text-h2 font-semibold">{t('title')}</h2>
        <p className="text-sm text-muted">{t('subtitle')}</p>
        {shown && (
          <>
            <p className="flex flex-wrap items-baseline justify-between gap-3 text-sm text-text">
              <span>
                {t('dials', {
                  margin: shown.dials.targetMarginPct,
                  basis: t(`basis.${shown.dials.marginBasis}`),
                  ivaMode: t(`ivaMode.${shown.dials.ivaMode}`),
                  rate: shown.dials.ivaRatePct,
                })}
              </span>
              <Link
                href="/admin/m10#wishlist"
                className="border-b border-accent pb-0.5 text-xs hover:border-text hover:text-text print:hidden"
              >
                {t('changeDials')} <span aria-hidden>→</span>
              </Link>
            </p>
            <p className="text-xs text-muted">{t('generatedAt', { date: formatDateTimeMx(shown.generatedAt, locale) })}</p>
          </>
        )}
      </header>

      <div className="flex flex-col gap-4 print:hidden">
        <div className="flex flex-col gap-2">
          <p className="eyebrow" id="buylist-sort-label">
            {t('sortLabel')}
          </p>
          <div role="group" aria-labelledby="buylist-sort-label" className="flex flex-wrap items-center gap-2">
            {sortChips.map((c) => {
              const active = (c.key === 'default' && !state.sort) || c.key === state.sort;
              return (
                <Button
                  key={c.key}
                  size="sm"
                  variant={active ? 'primary' : 'ghost'}
                  aria-pressed={active}
                  onClick={() =>
                    update(c.key === 'default' ? { dir: 'desc' } : { sort: c.key, dir: state.sort === c.key ? state.dir : 'desc' })
                  }
                >
                  {c.label}
                </Button>
              );
            })}
            {state.sort && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => update({ ...state, dir: state.dir === 'desc' ? 'asc' : 'desc' })}
              >
                {state.dir === 'desc' ? t('dir.desc') : t('dir.asc')}
              </Button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-full sm:w-72">
            <Input label={t('search')} type="search" value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          <label className="flex min-h-[44px] items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              checked={hideNoMarket}
              onChange={(e) => setHideNoMarket(e.target.checked)}
              className="h-4 w-4 accent-[color:var(--color-text)]"
            />
            {t('hideNoMarket')}
          </label>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" loading={csv.isPending} onClick={() => csv.mutate()} disabled={!shown}>
              <DownloadCloud size={16} aria-hidden /> {t('csv')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => window.print()} disabled={!shown}>
              <Printer size={16} aria-hidden /> {t('print')}
            </Button>
          </div>
        </div>
        {filterActive && shown && (
          <p className="text-sm text-muted">{t('filtered', { shown: rows.length, total: shown.rows.length })}</p>
        )}
        {csv.isError && (
          <Banner variant="danger" role="alert">
            {t('csvError')}
          </Banner>
        )}
      </div>

      {query.isError && !shown ? (
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
          {getMessage(query.error)}
        </Banner>
      ) : !shown ? (
        <div className="flex flex-col gap-4" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : (
        <div aria-busy={query.isFetching && query.isPlaceholderData} className="flex flex-col">
          {shown.rows.length === 0 ? (
            <EmptyState title={t('emptyTitle')} body={t('emptyBody')} />
          ) : (
            rows.map((r) => <DemandRow key={`${r.cardId}:${r.finish}`} row={r} />)
          )}
        </div>
      )}

      {shown && <SealedWaiting sealed={shown.sealed} />}
    </div>
  );
}

/** Una carta (WSH-UX.7 b). ⛔ Lee SOLO las claves de la lista blanca (821). */
function DemandRow({ row }: { row: WishlistDemandRowDTO }) {
  const t = useTranslations('admin.m9.buyList');
  const tFinish = useTranslations('finish');
  const locale = useLocale() as AppLocale;
  const [helpOpen, setHelpOpen] = useState(false);
  const money = (c: number) => formatMoneyCents(c, locale);
  const pctText = (p: number) =>
    new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-MX', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(Math.abs(p));
  const titleId = `demand-${row.cardId}-${row.finish}`;
  const dash = (
    <>
      <span aria-hidden>—</span>
      <span className="sr-only">{t('noMarketSr')}</span>
    </>
  );
  const margin = row.marginAtMarket;

  return (
    <article aria-labelledby={titleId} className="flex gap-4 border-b border-border py-6 print:break-inside-avoid print:py-2">
      <CardImage src={row.imageSmallUrl} alt="" className="w-12 shrink-0 sm:w-14 print:hidden" />
      <div className="min-w-0 flex-1">
        <div className="min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 id={titleId} lang="en" className="text-[15px] font-medium text-text">
                {row.cardName}
              </h3>
              <p className="mt-1 font-mono text-[12px] text-muted">
                <span lang="en">{row.setName}</span> · #{row.number} · {tFinish(row.finish)}
              </p>
              <p className="mt-2 font-mono text-[11px] uppercase tracking-label text-text">
                {t('wanted', { n: row.wantedCount })}
              </p>
            </div>
            <div className="text-right">
              <Ceiling row={row} dash={dash} money={money} helpOpen={helpOpen} setHelpOpen={setHelpOpen} />
            </div>
          </div>

          {row.marketCents == null && (
            <p className="mt-3">
              <Badge tone="neutral" shape="outline">
                {t('noMarket')}
              </Badge>
            </p>
          )}

          <table className="mt-4 w-full max-w-xl border-collapse font-mono text-[12px] tabular">
            <caption className="sr-only">{t('tier.caption')}</caption>
            <thead>
              <tr className="border-b border-border text-left text-muted">
                <th scope="col" className="py-2 pr-3 font-normal">
                  {t('tier.level')}
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-normal">
                  {t('tier.accounts')}
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-normal">
                  {t('tier.max')}
                </th>
                <th scope="col" className="py-2 text-right font-normal">
                  {t('tier.ceiling')}
                </th>
              </tr>
            </thead>
            <tbody>
              {row.tiers.map((tier) => (
                <tr key={tier.maxPct} className="border-b border-border">
                  <th scope="row" className="py-2 pr-3 text-left font-normal text-text">
                    {t('tier.levelValue', { pct: tier.maxPct })}
                  </th>
                  <td className="py-2 pr-3 text-right text-text">{tier.accounts}</td>
                  <td className="py-2 pr-3 text-right text-text">
                    {tier.maxDisplayCents == null ? dash : money(tier.maxDisplayCents)}
                  </td>
                  <td className="py-2 text-right text-text">{tier.ceilingCents == null ? dash : money(tier.ceilingCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-3 flex flex-col gap-1 text-sm text-text">
            <p className="flex flex-wrap gap-x-3">
              {row.marketCents != null && <span>{t('market', { amount: money(row.marketCents) })}</span>}
              {row.normalPrice ? (
                <span>
                  {t('normal', { list: money(row.normalPrice.listCents), display: money(row.normalPrice.displayCents) })}
                </span>
              ) : (
                <span className="text-muted">{t('normalNone')}</span>
              )}
            </p>
            <p className="flex flex-wrap gap-x-3">
              {row.buyersAtNormalPrice != null && <span>{t('buyers', { n: row.buyersAtNormalPrice })}</span>}
              {margin && (
                <span className={cn(margin.cents < 0 && 'text-accent')}>
                  {margin.cents < 0
                    ? t('marginLoss', { amount: money(Math.abs(margin.cents)), pct: pctText(margin.pct) })
                    : t('marginGain', { amount: money(margin.cents), pct: pctText(margin.pct) })}
                </span>
              )}
              {row.buylistTodayCents != null ? (
                <span>{t('buylist', { amount: money(row.buylistTodayCents) })}</span>
              ) : (
                <span className="text-muted">{t('buylistNone')}</span>
              )}
            </p>
          </div>
        </div>

      </div>
    </article>
  );
}

function Ceiling({
  row,
  dash,
  money,
  helpOpen,
  setHelpOpen,
}: {
  row: WishlistDemandRowDTO;
  dash: React.ReactNode;
  money: (c: number) => string;
  helpOpen: boolean;
  setHelpOpen: (v: boolean) => void;
}) {
  const t = useTranslations('admin.m9.buyList');
  return (
    <div className="flex flex-col items-end gap-1">
      <p className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-label text-muted">
        {t('ceiling')}
        <button
          type="button"
          aria-label={t('ceilingHelpLabel')}
          aria-expanded={helpOpen}
          onClick={() => setHelpOpen(!helpOpen)}
          className="inline-flex h-11 w-11 items-center justify-center text-muted hover:text-text focus-visible:shadow-focus print:hidden"
        >
          <Info size={14} aria-hidden />
        </button>
      </p>
      <p data-testid="demand-ceiling" className="tabular text-[22px] font-medium leading-none text-text lg:text-[28px]">
        {row.mainCeilingCents == null ? dash : money(row.mainCeilingCents)}
      </p>
      {row.mainCeilingCents != null && <p className="text-xs text-muted">{t('withoutIva')}</p>}
      {helpOpen && <p className="max-w-[16rem] text-xs text-muted">{t('ceilingHelp')}</p>}
    </div>
  );
}

function SealedWaiting({ sealed }: { sealed: WishlistDemandResponse['sealed'] }) {
  const t = useTranslations('admin.m9.buyList');
  const ts = useTranslations('status');
  return (
    <section aria-labelledby="buylist-sealed-title" className="flex flex-col gap-3 border-t border-border pt-8">
      <h2 id="buylist-sealed-title" className="text-h2 font-semibold">
        {t('sealedTitle')}
      </h2>
      <p className="text-sm text-muted">{t('sealedSubtitle')}</p>
      {sealed.length === 0 ? (
        <p className="text-sm text-muted">{t('sealedEmpty')}</p>
      ) : (
        <table className="w-full max-w-2xl border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left font-mono text-[11px] uppercase tracking-label text-muted">
              <th scope="col" className="py-2 pr-3 font-normal">
                {t('sealedCols.product')}
              </th>
              <th scope="col" className="py-2 pr-3 font-normal">
                {t('sealedCols.type')}
              </th>
              <th scope="col" className="py-2 pr-3 font-normal">
                {t('sealedCols.condition')}
              </th>
              <th scope="col" className="py-2 text-right font-normal">
                {t('sealedCols.waiting')}
              </th>
            </tr>
          </thead>
          <tbody>
            {sealed.map((s, i) => (
              <tr key={`${s.productName}-${s.sealedSubtype ?? ''}-${s.sealedCondition}-${i}`} className="border-b border-border">
                <th scope="row" lang="en" className="py-2 pr-3 text-left font-normal text-text">
                  {s.productName}
                </th>
                <td className="py-2 pr-3 text-text">{s.sealedSubtype ? ts(`sealedSubtype.${s.sealedSubtype}`) : '—'}</td>
                <td className="py-2 pr-3 text-text">{ts(`sealedCondition.${s.sealedCondition}`)}</td>
                <td className="tabular py-2 text-right text-text">{s.waitingCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
