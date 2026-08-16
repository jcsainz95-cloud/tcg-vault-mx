'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getHoldings } from '@/lib/api';
import type { AppLocale } from '@/i18n/routing';
import type { HoldingDTO } from '@/types/contract';
import { formatMoneyCents } from '@/lib/format';
import { Link } from '@/i18n/navigation';
import { CardImage } from '@/components/ui/CardImage';
import { ListingSpec } from '@/components/domain/ListingSpec';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { QueryState } from '@/components/ui/QueryState';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { PortfolioTrendChart } from '@/components/domain/PortfolioTrendChart';

type SortKey = 'default' | 'set' | 'value_desc' | 'value_asc';

/** Retícula del inventario: misma en la cabecera y en cada renglón. */
const ROW = 'grid grid-cols-[52px_1fr_auto] items-center gap-4 lg:grid-cols-[64px_2fr_1.2fr_1fr_1fr_140px] lg:gap-5';

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

/**
 * 6c — El portafolio manda: valor, tendencia y valor por set arriba; abajo el
 * inventario como renglones con folio, estado y valor de referencia, no como
 * tarjetas. Todo se separa con reglas de borde a borde.
 */
export function VaultView() {
  const t = useTranslations('vault');
  const tcat = useTranslations('catalog');
  const locale = useLocale() as AppLocale;
  const query = useQuery({ queryKey: ['holdings'], queryFn: getHoldings });
  const [sort, setSort] = useState<SortKey>('default');
  // Filtro por set (client-side). 'all' = todos los sets presentes en los holdings.
  const [setFilter, setSetFilter] = useState<string>('all');

  const sortedHoldings = useMemo(
    () => (query.data ? sortHoldings(query.data.data, sort, locale) : []),
    [query.data, sort, locale],
  );

  // Sets presentes en los holdings del usuario (distinct por setId → poblar el filtro).
  // HoldingDTO.card expone setId + setName, así que se agrupa por setId sin ambigüedad.
  const presentSets = useMemo(() => {
    const map = new Map<string, string>();
    for (const h of query.data?.data ?? []) {
      if (!map.has(h.card.setId)) map.set(h.card.setId, h.card.setName);
    }
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, locale));
  }, [query.data, locale]);

  // Holdings tras aplicar el filtro por set (respeta el orden ya calculado).
  const filteredHoldings = useMemo(
    () => (setFilter === 'all' ? sortedHoldings : sortedHoldings.filter((h) => h.card.setId === setFilter)),
    [sortedHoldings, setFilter],
  );

  // Agrupación por set: cada grupo lleva su valor (suma de referenceMxnCents; los
  // pendientes sin valor no aportan). Preserva el orden de aparición en filteredHoldings.
  const groups = useMemo(() => {
    const byId = new Map<string, { setId: string; setName: string; items: HoldingDTO[]; valueCents: number }>();
    for (const h of filteredHoldings) {
      let g = byId.get(h.card.setId);
      if (!g) {
        g = { setId: h.card.setId, setName: h.card.setName, items: [], valueCents: 0 };
        byId.set(h.card.setId, g);
      }
      g.items.push(h);
      g.valueCents += h.referenceValue.referenceMxnCents ?? 0;
    }
    return [...byId.values()];
  }, [filteredHoldings]);

  // Total del subconjunto filtrado (suma de todos los grupos visibles).
  const filteredTotalCents = useMemo(() => groups.reduce((sum, g) => sum + g.valueCents, 0), [groups]);

  return (
    <div>
      <div className="gutter flex flex-wrap items-end justify-between gap-4 pb-6 pt-10 lg:pt-[46px]">
        <h1 className="font-serif text-[30px] leading-[1.1] text-text lg:text-[40px]">{t('title')}</h1>
        <Link
          href="/shipments"
          className="inline-flex min-h-[44px] items-center border border-text px-6 text-[11px] font-medium uppercase tracking-label text-text hover:bg-text hover:text-primary-fg"
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
                  className="inline-flex min-h-[44px] items-center bg-primary px-6 text-[11px] font-medium uppercase tracking-label text-primary-fg"
                >
                  {t('emptyCta')}
                </Link>
              }
            />
          ) : (
            <>
              {/* Portafolio a la izquierda, custodia y valor por set a la derecha. */}
              <div className="grid border-y border-border lg:grid-cols-[1.2fr_1fr]">
                <div className="gutter border-b border-border py-8 lg:border-b-0 lg:border-r">
                  <PortfolioTrendChart
                    label={t('portfolioValue')}
                    currentValueFallbackCents={query.data.portfolio.totalValueMxnCents}
                    footnote={
                      <>
                        <p className="mt-2.5 text-xs leading-relaxed text-muted">{t('portfolioHint')}</p>
                        {query.data.portfolio.pendingPriceCount > 0 && (
                          <p className="mt-2 font-mono text-[11px] text-accent">
                            {t('pendingPrice', { count: query.data.portfolio.pendingPriceCount })}
                          </p>
                        )}
                      </>
                    }
                  />
                </div>

                <div className="gutter py-8">
                  <p className="rule-note text-sm leading-[1.7] text-text">{t('trustBanner')}</p>

                  {/* Valor por set: suma de referenceMxnCents por set del subconjunto filtrado. */}
                  {groups.length > 0 && (
                    <>
                      <h2 className="eyebrow mt-7">{t('valueBySet')}</h2>
                      <ul className="mt-4">
                        {groups.map((g) => (
                          <li
                            key={g.setId}
                            className="flex items-baseline justify-between gap-3 border-b border-border py-3 text-sm last:border-b-0"
                          >
                            <span className="min-w-0 truncate text-text">
                              <span lang="en">{g.setName}</span>
                              <span className="ml-2 font-mono text-[11px] text-muted">
                                {t('setCount', { count: g.items.length })}
                              </span>
                            </span>
                            <span className="tabular font-medium text-text">
                              {formatMoneyCents(g.valueCents, locale)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              </div>

              {/* Controles cliente: filtro por set + orden + total del subconjunto. */}
              <div className="gutter flex flex-wrap items-end gap-8 border-b border-border py-6">
                <div className="min-w-[200px]">
                  <Select
                    label={t('setFilter.label')}
                    value={setFilter}
                    onChange={(e) => setSetFilter(e.target.value)}
                    options={[
                      { value: 'all', label: t('setFilter.all') },
                      ...presentSets.map((s) => ({ value: s.id, label: s.name })),
                    ]}
                  />
                </div>
                <div className="min-w-[200px]">
                  <Select
                    label={t('sort.label')}
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
                <div className="ml-auto text-right">
                  <div className="eyebrow">{t('filteredTotal')}</div>
                  <div className="tabular mt-2.5 text-xl font-medium leading-none text-text">
                    {formatMoneyCents(filteredTotalCents, locale)}
                  </div>
                </div>
              </div>

              {/* Inventario como renglones con folio, estado y valor. */}
              <div className="gutter pb-14">
                <div className={`${ROW} hidden border-b border-border py-4 lg:grid`}>
                  <span />
                  <span className="eyebrow">{t('cardColumn')}</span>
                  <span className="eyebrow">{t('folio')}</span>
                  <span className="eyebrow">{t('statusColumn')}</span>
                  <span className="eyebrow">{tcat('marketValue')}</span>
                  <span />
                </div>

                {filteredHoldings.map((h) => {
                  const settled = h.ownershipStatus === 'settled';
                  return (
                    <div key={h.inventoryItemId} className={`${ROW} border-b border-border py-4`}>
                      {/* imagen de catálogo remota (v1.2, sin fotos propias) */}
                      <CardImage src={h.card.imageSmallUrl} alt={h.card.name} className="p-1" />

                      <div className="min-w-0">
                        <p className="truncate font-serif text-base font-medium leading-tight text-text" lang="en">
                          {h.card.name}
                        </p>
                        {/* v1.6-finish: acabado del holding; el portafolio valúa contra ese acabado. */}
                        <ListingSpec
                          productType={h.productType}
                          rawCondition={h.rawCondition}
                          sealedSubtype={h.sealedSubtype}
                          finish={h.finish}
                          gradingCompany={h.gradingCompany}
                          gradeValue={h.gradeValue}
                          certNumber={h.certNumber}
                          compact
                          className="mt-1.5 text-muted"
                        />
                        {/* En móvil el folio y el valor viajan bajo el nombre. */}
                        <p className="tabular mt-1.5 font-mono text-[11px] text-muted lg:hidden">
                          {h.folio}
                          {h.referenceValue.referenceMxnCents != null &&
                            ` · ${formatMoneyCents(h.referenceValue.referenceMxnCents, locale)}`}
                        </p>
                      </div>

                      <span className="tabular hidden font-mono text-xs text-muted lg:block">{h.folio}</span>

                      <span className="justify-self-end lg:justify-self-start">
                        <StatusBadge domain="ownership" value={h.ownershipStatus} />
                      </span>

                      <span className="tabular hidden text-base font-medium text-text lg:block">
                        {h.referenceValue.referenceMxnCents != null
                          ? formatMoneyCents(h.referenceValue.referenceMxnCents, locale)
                          : '—'}
                      </span>

                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={!settled}
                        className="col-span-3 w-full lg:col-span-1"
                        title={settled ? undefined : t('onlySettled')}
                      >
                        {t('withdraw')}
                      </Button>
                    </div>
                  );
                })}

                <p className="mt-5 font-mono text-xs text-muted">{t('onlySettled')}</p>
              </div>
            </>
          ))}
      </QueryState>
    </div>
  );
}
