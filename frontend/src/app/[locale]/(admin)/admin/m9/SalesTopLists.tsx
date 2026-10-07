'use client';

import { useRef } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { AppLocale } from '@/i18n/routing';
import type { SalesReportDTO, SalesTopSort } from '@/types/contract';
import { cn } from '@/lib/cn';
import { formatMoneyCents } from '@/lib/format';
import { FinishMark } from '@/components/domain/FinishMark';
import { Badge } from '@/components/ui/Badge';
import { Segmented } from './SalesBarChart';
import { NoData } from './SalesSummary';
import type { SalesTopTab } from './salesParams';

const TABS: SalesTopTab[] = ['cards', 'sets', 'sealed'];

/**
 * Lo más vendido (`§AN-UX.6`). El ORDEN lo da el servidor (`topSort`): ⛔ se reordena en el navegador (UX-AN-8).
 * Dos acabados de la misma carta = dos renglones, cada uno con su `FinishMark` (UX-AN-9). ⛔ Sin datos de clientes.
 */
export function SalesTopLists({
  top,
  tab,
  onTab,
  onSort,
}: {
  top: SalesReportDTO['top'];
  tab: SalesTopTab;
  onTab: (t: SalesTopTab) => void;
  onSort: (s: SalesTopSort) => void;
}) {
  const t = useTranslations('admin.m9.sales.top');
  const locale = useLocale() as AppLocale;
  const fm = (n: number) => formatMoneyCents(n, locale);
  const refs = useRef<Record<SalesTopTab, HTMLButtonElement | null>>({ cards: null, sets: null, sealed: null });

  function onKey(e: React.KeyboardEvent<HTMLButtonElement>, cur: SalesTopTab) {
    const i = TABS.indexOf(cur);
    let next: SalesTopTab | null = null;
    if (e.key === 'ArrowRight') next = TABS[(i + 1) % TABS.length];
    else if (e.key === 'ArrowLeft') next = TABS[(i - 1 + TABS.length) % TABS.length];
    else if (e.key === 'Home') next = TABS[0];
    else if (e.key === 'End') next = TABS[TABS.length - 1];
    if (!next) return;
    e.preventDefault();
    onTab(next);
    refs.current[next]?.focus();
  }

  const sortNet = top.sort === 'net';
  const sortTh = (active: boolean) => cn('eyebrow py-3 text-right', active ? 'font-semibold text-text' : 'font-medium');
  const head = (nameCol: string) => (
    <tr className="border-y border-border">
      <th scope="col" className="eyebrow w-10 py-3 text-left font-medium">
        {t('colRank')}
      </th>
      <th scope="col" className="eyebrow py-3 text-left font-medium">
        {nameCol}
      </th>
      <th scope="col" aria-sort={!sortNet ? 'descending' : undefined} className={cn(sortTh(!sortNet), 'pr-5')}>
        {t('colPieces')}
      </th>
      <th scope="col" aria-sort={sortNet ? 'descending' : undefined} className={sortTh(sortNet)}>
        {t('colNet')}
      </th>
    </tr>
  );
  const nums = (pieces: number, net: number) => (
    <>
      <td className={cn('tabular py-3 pr-5 text-right text-sm', !sortNet && 'font-medium')}>{pieces}</td>
      <td className={cn('tabular py-3 text-right text-sm', sortNet && 'font-medium')}>{fm(net)}</td>
    </>
  );
  const empty = (key: 'emptyCards' | 'emptySets' | 'emptySealed') => <p className="py-4 text-sm text-muted">{t(key)}</p>;

  return (
    <section aria-labelledby="sales-top-h" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="sales-top-h" className="text-h2 font-semibold">
          {t('title')}
        </h2>
        <Segmented
          label={t('sortLabel')}
          value={top.sort}
          options={[
            { value: 'net', label: t('sortNet') },
            { value: 'pieces', label: t('sortPieces') },
          ]}
          onChange={onSort}
        />
      </div>
      <div role="tablist" aria-label={t('title')} className="flex gap-5 border-b border-border">
        {TABS.map((k) => (
          <button
            key={k}
            ref={(el) => {
              refs.current[k] = el;
            }}
            type="button"
            role="tab"
            id={`sales-top-tab-${k}`}
            aria-selected={tab === k}
            aria-controls="sales-top-panel"
            tabIndex={tab === k ? 0 : -1}
            onClick={() => onTab(k)}
            onKeyDown={(e) => onKey(e, k)}
            className={cn(
              '-mb-px min-h-[44px] border-b-2 px-1 text-sm focus-visible:shadow-focus focus-visible:outline-none',
              tab === k ? 'border-text text-text' : 'border-transparent text-muted hover:text-text',
            )}
          >
            {t(k)}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="sales-top-panel" aria-labelledby={`sales-top-tab-${tab}`} className="overflow-x-auto">
        {tab === 'cards' &&
          (top.cards.length === 0 ? (
            empty('emptyCards')
          ) : (
            <table className="w-full border-collapse">
              <thead>{head(t('colCard'))}</thead>
              <tbody>
                {top.cards.map((c, i) => (
                  <tr key={`${c.cardId}|${c.productType}|${c.finish}`} data-testid="sales-top-card" className="border-b border-border">
                    <td className="tabular py-3 text-sm text-muted">{i + 1}</td>
                    <td className="py-3 text-sm">
                      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span lang="en">
                          {c.name} · {c.number} · {c.setName}
                        </span>
                        <FinishMark finish={c.finish} band={false} />
                        {c.productType === 'graded' && (
                          <Badge tone="neutral" className="uppercase">
                            {t('graded')}
                          </Badge>
                        )}
                      </span>
                    </td>
                    {nums(c.pieces, c.netCents)}
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        {tab === 'sets' &&
          (top.sets.length === 0 ? (
            empty('emptySets')
          ) : (
            <table className="w-full border-collapse">
              <thead>{head(t('colSet'))}</thead>
              <tbody>
                {top.sets.map((s, i) => (
                  <tr key={s.setId} data-testid="sales-top-set" className="border-b border-border">
                    <td className="tabular py-3 text-sm text-muted">{i + 1}</td>
                    <td className="py-3 text-sm" lang="en">
                      {s.setName}
                    </td>
                    {nums(s.pieces, s.netCents)}
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        {tab === 'sealed' &&
          (top.sealed.length === 0 ? (
            empty('emptySealed')
          ) : (
            <table className="w-full border-collapse">
              <thead>{head(t('colSealed'))}</thead>
              <tbody>
                {top.sealed.map((s, i) => (
                  <tr key={s.sealedProductId ?? `name:${s.name}`} data-testid="sales-top-sealed" className="border-b border-border">
                    <td className="tabular py-3 text-sm text-muted">{i + 1}</td>
                    <td className="py-3 text-sm" lang="en">
                      {s.name} · {s.setName ?? <NoData />}
                    </td>
                    {nums(s.pieces, s.netCents)}
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
      </div>
      <p className="text-xs text-muted">{t('note')}</p>
    </section>
  );
}
