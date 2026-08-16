'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Wallet, Lock } from 'lucide-react';
import { getHoldings } from '@/lib/api';
import type { AppLocale } from '@/i18n/routing';
import type { HoldingDTO } from '@/types/contract';
import { formatMoneyCents } from '@/lib/format';
import { Link } from '@/i18n/navigation';
import { CardImage } from '@/components/ui/CardImage';
import { ConditionBadge } from '@/components/ui/ConditionBadge';
import { FinishBadge } from '@/components/domain/FinishBadge';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PriceTag } from '@/components/ui/PriceTag';
import { StatCard } from '@/components/ui/StatCard';
import { Banner } from '@/components/ui/Banner';
import { EmptyState } from '@/components/ui/EmptyState';
import { QueryState } from '@/components/ui/QueryState';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { PortfolioTrendChart, PortfolioSparkline } from '@/components/domain/PortfolioTrendChart';

type SortKey = 'default' | 'set' | 'value_desc' | 'value_asc';

/**
 * Ordena los holdings en cliente. `set` usa `card.setName` (localeCompare, desempate
 * por nombre de carta). `value_*` usa el valor de referencia por carta
 * (`referenceValue.referenceMxnCents`); las cartas con precio pendiente (sin valor)
 * quedan SIEMPRE al final en ambos sentidos.
 */
function sortHoldings(rows: HoldingDTO[], key: SortKey, locale: string): HoldingDTO[] {
  if (key === 'default') return rows;
  const copy = [...rows];
  if (key === 'set') {
    copy.sort(
      (a, b) =>
        a.card.setName.localeCompare(b.card.setName, locale) ||
        a.card.name.localeCompare(b.card.name, locale),
    );
    return copy;
  }
  const val = (h: HoldingDTO) => h.referenceValue.referenceMxnCents ?? null;
  copy.sort((a, b) => {
    const av = val(a);
    const bv = val(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1; // pendientes al final
    if (bv == null) return -1;
    return key === 'value_desc' ? bv - av : av - bv;
  });
  return copy;
}

export function VaultView() {
  const t = useTranslations('vault');
  const tn = useTranslations('nav');
  const locale = useLocale() as AppLocale;
  const query = useQuery({ queryKey: ['holdings'], queryFn: getHoldings });
  const [sort, setSort] = useState<SortKey>('default');

  const sortedHoldings = useMemo(
    () => (query.data ? sortHoldings(query.data.data, sort, locale) : []),
    [query.data, sort, locale],
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-h1 font-bold">{t('title')}</h1>
        <Link
          href="/shipments"
          className="inline-flex min-h-[44px] items-center rounded-md border border-border-strong px-4 text-sm font-medium hover:bg-surface-2"
        >
          {t('withdraw')}
        </Link>
      </div>

      <QueryState
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={() => query.refetch()}
      >
        {query.data &&
          (query.data.data.length === 0 ? (
            <EmptyState
              title={t('emptyTitle')}
              body={t('emptyBody')}
              action={
                <Link
                  href="/catalog"
                  className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-fg"
                >
                  {t('emptyCta')}
                </Link>
              }
            />
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <StatCard
                  label={t('portfolioValue')}
                  value={formatMoneyCents(query.data.portfolio.totalValueMxnCents, locale)}
                  sub={
                    <div className="flex flex-col gap-2">
                      {/* Sparkline opcional del valor total (§7.8/§7.17) */}
                      <PortfolioSparkline />
                      <span>{t('portfolioHint')}</span>
                      {query.data.portfolio.pendingPriceCount > 0 && (
                        <span className="text-warning">
                          {t('pendingPrice', { count: query.data.portfolio.pendingPriceCount })}
                        </span>
                      )}
                    </div>
                  }
                  icon={<Wallet size={18} />}
                />
                <div className="flex items-center">
                  <Banner variant="trust">{t('trustBanner')}</Banner>
                </div>
              </div>

              {/* Gráfica de tendencia estilo acciones (§7.17) */}
              <PortfolioTrendChart
                currentValueFallbackCents={query.data.portfolio.totalValueMxnCents}
              />

              {/* Control de orden de la lista (cliente) */}
              <div className="flex flex-wrap items-end justify-end gap-3">
                <Select
                  label={t('sort.label')}
                  className="w-56"
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortKey)}
                  options={[
                    { value: 'default', label: t('sort.default') },
                    { value: 'set', label: t('sort.set') },
                    { value: 'value_desc', label: t('sort.valueDesc') },
                    { value: 'value_asc', label: t('sort.valueAsc') },
                  ]}
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {sortedHoldings.map((h) => {
                  const settled = h.ownershipStatus === 'settled';
                  return (
                    <div
                      key={h.inventoryItemId}
                      className="flex gap-3 rounded-lg border border-border bg-surface p-3"
                    >
                      <div className="w-20 shrink-0">
                        {/* imagen de catálogo remota (v1.2, sin fotos propias) */}
                        <CardImage src={h.card.imageSmallUrl} alt={h.card.name} />
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <p className="truncate text-sm font-semibold" lang="en">
                          {h.card.name}
                        </p>
                        <p className="tabular text-xs text-muted">{h.folio}</p>
                        <div className="flex flex-wrap gap-1.5">
                          <ConditionBadge
                            productType={h.productType}
                            rawCondition={h.rawCondition}
                            sealedSubtype={h.sealedSubtype}
                            gradingCompany={h.gradingCompany}
                            gradeValue={h.gradeValue}
                            certNumber={h.certNumber}
                            compact
                          />
                          {/* v1.6-finish: acabado del holding; el portafolio valúa contra ese acabado. */}
                          <FinishBadge finish={h.finish} productType={h.productType} compact />
                          <StatusBadge domain="ownership" value={h.ownershipStatus} />
                        </div>
                        <PriceTag reference={h.referenceValue} mode="reference" />
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={!settled}
                          className="mt-1 self-start"
                          title={settled ? undefined : t('onlySettled')}
                        >
                          {settled ? (
                            t('withdraw')
                          ) : (
                            <span className="flex items-center gap-1">
                              <Lock size={14} /> {t('withdraw')}
                            </span>
                          )}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-muted">{t('onlySettled')}</p>
              <Link href="/shipments" className="text-sm font-medium text-primary hover:underline">
                {tn('vault')} → {t('withdraw')}
              </Link>
            </>
          ))}
      </QueryState>
    </div>
  );
}
