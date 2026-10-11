'use client';

import { useEffect, useId, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, Info } from 'lucide-react';
import { getSealedInventorySets, getSealedPriceSheet } from '@/lib/api';
import { formatDate, formatMoneyCents, formatSignedMoneyCents } from '@/lib/format';
import type { AppLocale } from '@/i18n/routing';
import type { SealedPriceSheetRowDTO, SealedPriceSheetScope } from '@/types/contract';
import { Badge } from '@/components/ui/Badge';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { CardImage } from '@/components/ui/CardImage';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { QueryState } from '@/components/ui/QueryState';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatBpsPct, formatSpreadPct } from '../../m1/sealed-final-price';
import { SealedProductPriceEditor, type SealedProductPriceSaved } from '../../m1/SealedProductPriceEditor';
import { SealedPriceSavedNotice } from '../../m1/SealedPriceSavedNotice';

const PAGE_SIZE = 50;

/**
 * 💰 **La hoja «Precios del sellado»** (`DESIGN_SYSTEM §70.2`, `API_CONTRACT §M11-SP.5 + 12.4 + 13.7`). Un precio por
 * PRODUCTO, con IVA: lo que escribe el dueño es lo que paga el cliente. Nueve columnas en un orden fijo (qué es → cuánto
 * hay → cuánto costó → lo que yo digo → lo que diría el sistema → lo que manda → sin IVA → contra qué → cuánto queda).
 *
 * - El lápiz se decide por **`canEdit` del servidor** (UX-SP-1), ⛔ no por el rol del cliente.
 * - ⛔ La UI no deriva `N`, `L` ni `P`: pinta lo que trae la fila. La única cuenta es el margen en vivo del editor.
 * - `pending` ⇒ «Sin precio: no se vende», ⛔ nunca MX$0.00 (§7.3). `0` sí es un costo válido.
 * - El margen negativo lleva «−» y «pérdida»: el signo y la palabra son el canal, el color el tercero (§10).
 */
export function SealedPriceSheet() {
  const t = useTranslations('admin.m11.priceSheet');
  const locale = useLocale() as AppLocale;
  const scopeName = useId();

  const [setId, setSetId] = useState('');
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [scope, setScope] = useState<SealedPriceSheetScope>('on_hand');
  const [page, setPage] = useState(1);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saved, setSaved] = useState<SealedProductPriceSaved | null>(null);
  const [savedSeq, setSavedSeq] = useState(0);

  // Buscar con espera de 300 ms; vuelve a la página 1.
  useEffect(() => {
    const h = setTimeout(() => {
      setQ(qInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(h);
  }, [qInput]);

  const sets = useQuery({
    queryKey: ['sealed-sets', 'price-sheet-filter'],
    queryFn: () => getSealedInventorySets({ pageSize: 100 }),
  });

  const query = useQuery({
    queryKey: ['sealed-price-sheet', { setId: setId || undefined, q, scope, page }],
    queryFn: () => getSealedPriceSheet({ setId: setId || undefined, q: q || undefined, scope, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  const data = query.data;
  const canEdit = data?.canEdit === true;
  const filtered = setId !== '' || q !== '';

  function clearFilters() {
    setSetId('');
    setQInput('');
    setQ('');
    setPage(1);
  }
  function changeScope(next: SealedPriceSheetScope) {
    setScope(next);
    setPage(1);
  }

  const from = data && data.total > 0 ? (data.page - 1) * data.pageSize + 1 : 0;
  const to = data ? Math.min(data.page * data.pageSize, data.total) : 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-[minmax(10rem,14rem)_minmax(12rem,1fr)_auto] md:items-end">
        <Select
          label={t('filters.set')}
          options={[
            { value: '', label: t('filters.allSets') },
            ...(sets.data?.data ?? []).map((s) => ({ value: s.set.id, label: s.set.name })),
          ]}
          value={setId}
          onChange={(e) => {
            setSetId(e.target.value);
            setPage(1);
          }}
        />
        <Input
          label={t('filters.search')}
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
        />
        <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
          <legend className="eyebrow mb-2">{t('filters.scopeLegend')}</legend>
          {(['on_hand', 'all'] as const).map((value) => (
            <label key={value} className="flex items-center gap-2 text-sm text-text">
              <input
                type="radio"
                name={scopeName}
                value={value}
                checked={scope === value}
                onChange={() => changeScope(value)}
                className="h-4 w-4 accent-[color:var(--color-accent)]"
              />
              {value === 'on_hand' ? t('filters.onHand') : t('filters.all')}
            </label>
          ))}
        </fieldset>
      </div>

      {data && data.unlinkedCount > 0 && (
        <Banner variant="info" role="status">
          <span role="note">{t('unlinked', { n: data.unlinkedCount })}</span>
        </Banner>
      )}

      {saved && <SealedPriceSavedNotice key={savedSeq} saved={saved} />}

      {query.isLoading ? (
        <SheetTable canEdit={false} rows={[]} loading locale={locale} />
      ) : (
        <QueryState isLoading={false} isError={query.isError} error={query.error} onRetry={() => query.refetch()}>
          {data &&
            (data.data.length === 0 ? (
              filtered ? (
                <EmptyState
                  title={t('emptyFiltered')}
                  action={
                    <Button variant="secondary" size="sm" onClick={clearFilters}>
                      {t('clearFilters')}
                    </Button>
                  }
                />
              ) : scope === 'on_hand' ? (
                <EmptyState
                  title={t('empty')}
                  action={
                    <Button variant="secondary" size="sm" onClick={() => changeScope('all')}>
                      {t('emptyCta')}
                    </Button>
                  }
                />
              ) : (
                <EmptyState title={t('emptyFiltered')} />
              )
            ) : (
              <>
                <SheetTable
                  canEdit={canEdit}
                  rows={data.data}
                  locale={locale}
                  ivaRatePct={data.iva?.ratePct ?? null}
                  editingId={editingId}
                  onEditingChange={setEditingId}
                  onSaved={(s) => {
                    setSaved(s);
                    setSavedSeq((n) => n + 1);
                  }}
                />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="tabular font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
                    {t('pageInfo', { from, to, total: data.total })}
                  </span>
                  <span className="flex gap-2">
                    <Button size="sm" variant="secondary" disabled={data.page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                      {t('prev')}
                    </Button>
                    <Button size="sm" variant="secondary" disabled={to >= data.total} onClick={() => setPage((p) => p + 1)}>
                      {t('next')}
                    </Button>
                  </span>
                </div>
              </>
            ))}
        </QueryState>
      )}

      {data && !canEdit && <p className="font-mono text-[11px] text-muted">{t('footOwner')}</p>}
    </div>
  );
}

function HelpIcon({ text }: { text: string }) {
  return (
    <span title={text} className="ml-1 inline-flex cursor-help align-middle text-muted" tabIndex={0}>
      <Info size={12} aria-hidden />
      <span className="sr-only">{text}</span>
    </span>
  );
}

function SheetTable({
  rows,
  canEdit,
  loading,
  locale,
  ivaRatePct,
  editingId,
  onEditingChange,
  onSaved,
}: {
  rows: SealedPriceSheetRowDTO[];
  canEdit: boolean;
  loading?: boolean;
  locale: AppLocale;
  ivaRatePct?: number | null;
  editingId?: string | null;
  onEditingChange?: (id: string | null) => void;
  onSaved?: (s: SealedProductPriceSaved) => void;
}) {
  const t = useTranslations('admin.m11.priceSheet');
  const th = 'eyebrow px-3 py-2 font-normal';
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[64rem] border-collapse">
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className={`${th} sticky left-0 bg-bg text-left`}>
              {t('col.product')}
            </th>
            <th scope="col" className={`${th} text-right`}>
              {t('col.pieces')}
            </th>
            <th scope="col" className={`${th} text-right`}>
              {t('col.cost')}
            </th>
            <th scope="col" className={`${th} text-right`}>
              {t('col.owner')}
            </th>
            <th scope="col" className={`${th} text-right`}>
              {t('col.automatic')}
            </th>
            <th scope="col" className={`${th} text-right`}>
              {t('col.effective')}
            </th>
            <th scope="col" className={`${th} text-right`}>
              {t('col.net')}
              <HelpIcon text={t('col.netHelp')} />
            </th>
            <th scope="col" className={`${th} text-right`}>
              {t('col.market')}
            </th>
            <th scope="col" className={`${th} text-right`}>
              {t('col.margin')}
              <HelpIcon text={t('col.marginHelp')} />
            </th>
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: 5 }, (_, i) => (
                <tr key={i} className="border-b border-border">
                  {Array.from({ length: 9 }, (__, j) => (
                    <td key={j} className="px-3 py-3">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  ))}
                </tr>
              ))
            : rows.map((r) => (
                <SheetRow
                  key={r.sealedProductId}
                  row={r}
                  canEdit={canEdit}
                  locale={locale}
                  ivaRatePct={ivaRatePct ?? null}
                  editing={editingId === r.sealedProductId}
                  onEditingChange={(open) => onEditingChange?.(open ? r.sealedProductId : null)}
                  onSaved={(s) => onSaved?.(s)}
                />
              ))}
        </tbody>
      </table>
    </div>
  );
}

function SheetRow({
  row: r,
  canEdit,
  locale,
  ivaRatePct,
  editing,
  onEditingChange,
  onSaved,
}: {
  row: SealedPriceSheetRowDTO;
  canEdit: boolean;
  locale: AppLocale;
  ivaRatePct: number | null;
  editing: boolean;
  onEditingChange: (open: boolean) => void;
  onSaved: (s: SealedProductPriceSaved) => void;
}) {
  const t = useTranslations('admin.m11.priceSheet');
  const tSub = useTranslations('status.sealedSubtype');
  const money = (c: number) => formatMoneyCents(c, locale);
  const td = 'px-3 py-3 align-top text-right';
  const sub = 'block text-xs text-muted';
  const total = r.pieces.inStock + r.pieces.listed + r.pieces.reserved;
  const legacy = r.legacyPiecePrices;
  const range =
    legacy.minDisplayCents != null && legacy.maxDisplayCents != null
      ? legacy.minDisplayCents === legacy.maxDisplayCents
        ? money(legacy.minDisplayCents)
        : `${money(legacy.minDisplayCents)}–${money(legacy.maxDisplayCents)}`
      : null;
  const id = r.sealedProductId;

  return (
    <>
      <tr className={`${legacy.count > 0 ? '' : 'border-b'} border-border`} data-testid={`sheet-row-${id}`}>
        {/* Producto */}
        <td className="sticky left-0 bg-bg px-3 py-3 align-top">
          <span className="flex items-start gap-3">
            <span className="h-10 w-10 shrink-0">
              <CardImage src={r.imageUrl} alt="" className="h-10 w-10 object-contain" />
            </span>
            <span className="flex flex-col">
              <span lang="en" className="text-sm font-medium text-text">
                {r.name}
              </span>
              <span className="text-xs text-muted">
                <span lang="en">{r.set.name}</span> · {tSub(r.subtype)}
              </span>
              {!r.active && (
                <span className="mt-1">
                  <Badge tone="neutral" shape="outline">
                    {t('inactive')}
                  </Badge>
                </span>
              )}
            </span>
          </span>
        </td>
        {/* Piezas */}
        <td className={td}>
          <span className="tabular font-mono text-sm text-text">{total}</span>
          {total === 0 ? (
            <span className={sub}>{t('pieces.none')}</span>
          ) : (
            <>
              {r.pieces.inStock > 0 && <span className={sub}>{t('pieces.inStock', { n: r.pieces.inStock })}</span>}
              {r.pieces.listed > 0 && <span className={sub}>{t('pieces.listed', { n: r.pieces.listed })}</span>}
              {r.pieces.reserved > 0 && <span className={sub}>{t('pieces.reserved', { n: r.pieces.reserved })}</span>}
            </>
          )}
        </td>
        {/* Costo promedio */}
        <td className={td} data-testid={`sheet-cost-${id}`}>
          {r.cost.avgCents != null ? (
            <>
              <span className="tabular font-mono text-sm text-text">{money(r.cost.avgCents)}</span>
              {r.cost.minCents != null && r.cost.maxCents != null && r.cost.minCents !== r.cost.maxCents && (
                <span className={`${sub} tabular font-mono`}>
                  {t('cost.range', { min: money(r.cost.minCents), max: money(r.cost.maxCents) })}
                </span>
              )}
            </>
          ) : (
            <>
              <span className="text-sm text-text">—</span>
              <span className={sub}>{t('cost.none')}</span>
            </>
          )}
          {r.cost.withoutCost > 0 && r.cost.avgCents != null && (
            <span className="block text-xs text-accent">{t('cost.without', { n: r.cost.withoutCost })}</span>
          )}
        </td>
        {/* Tu precio (con IVA) */}
        <td className={td} data-testid={`sheet-owner-${id}`}>
          {!editing && (
            <>
              {r.ownerDisplayPriceCents != null ? (
                <span className="tabular font-mono text-sm text-text">{money(r.ownerDisplayPriceCents)}</span>
              ) : (
                <>
                  <span className="text-sm text-text">—</span>
                  <span className={sub}>{t('owner.none')}</span>
                </>
              )}
            </>
          )}
          {canEdit && (
            <span className="mt-1 flex justify-end text-left">
              <SealedProductPriceEditor
                product={{
                  id,
                  name: r.name,
                  ownerDisplayPriceCents: r.ownerDisplayPriceCents,
                  displayPriceCents: r.displayPriceCents,
                  effectiveOrigin: r.effectiveOrigin,
                  pieces: r.pieces,
                  legacy: { count: legacy.count, shadowed: legacy.shadowed },
                  avgCostCents: r.cost.avgCents,
                }}
                ivaRatePct={ivaRatePct}
                editing={editing}
                onEditingChange={onEditingChange}
                onDone={onSaved}
              />
            </span>
          )}
        </td>
        {/* Automático (con IVA) */}
        <td className={td}>
          {r.automaticDisplayPriceCents != null ? (
            <>
              <span className="tabular font-mono text-sm text-text">{money(r.automaticDisplayPriceCents)}</span>
              {r.automaticSource != null && r.appliedSpreadPct != null && (
                <span className={sub}>
                  {t(r.automaticSource === 'subtype_spread' ? 'automatic.subtype' : 'automatic.global', {
                    pct: formatSpreadPct(r.appliedSpreadPct, locale),
                  })}
                </span>
              )}
            </>
          ) : (
            <>
              <span className="text-sm text-text">—</span>
              <span className={sub}>{t('automatic.none')}</span>
            </>
          )}
        </td>
        {/* Se vende a (con IVA) */}
        <td className={td}>
          {r.effectiveOrigin === 'pending' || r.displayPriceCents == null ? (
            <span className="text-sm text-accent">{t('origin.pending')}</span>
          ) : (
            <>
              <span className="tabular font-mono text-sm font-medium text-text">{money(r.displayPriceCents)}</span>
              <span className={sub}>{r.effectiveOrigin === 'product' ? t('origin.product') : t('origin.automatic')}</span>
            </>
          )}
        </td>
        {/* Sin IVA */}
        <td className={td} data-testid={`sheet-net-${id}`}>
          {r.netPriceCents != null ? (
            <span className="tabular font-mono text-sm text-text">{money(r.netPriceCents)}</span>
          ) : (
            <span className="text-sm text-text">—</span>
          )}
          {r.netPriceCents != null && <span className={sub}>{t('net.rate', { rate: ivaRatePct ?? '—' })}</span>}
        </td>
        {/* Mercado */}
        <td className={td}>
          {r.market?.status === 'priced' && r.market.referenceMxnCents != null ? (
            <>
              <span className="tabular font-mono text-sm text-text">{money(r.market.referenceMxnCents)}</span>
              {r.market.capturedDate && (
                <span className={sub}>{t('market.asOf', { date: formatDate(r.market.capturedDate, locale) })}</span>
              )}
            </>
          ) : (
            <span className="text-sm text-text">—</span>
          )}
        </td>
        {/* Margen */}
        <td className={td} data-testid={`sheet-margin-${id}`}>
          {r.margin ? (
            r.margin.cents < 0 ? (
              <>
                <span className="tabular font-mono text-sm text-danger">{formatSignedMoneyCents(r.margin.cents, locale)}</span>
                <span className="block text-xs text-danger">{t('margin.loss', { pct: formatBpsPct(r.margin.bps, locale) })}</span>
              </>
            ) : (
              <>
                <span className="tabular font-mono text-sm text-text">{money(r.margin.cents)}</span>
                <span className={`${sub} tabular font-mono`}>{formatBpsPct(r.margin.bps, locale)}</span>
              </>
            )
          ) : (
            <>
              <span className="text-sm text-text">—</span>
              <span className={sub}>{r.displayPriceCents == null ? t('margin.noPrice') : t('margin.noCost')}</span>
            </>
          )}
        </td>
      </tr>
      {legacy.count > 0 && (
        <tr className="border-b border-border">
          <td colSpan={9} className="px-3 pb-3 pt-0 text-right">
            <span
              data-testid={`sheet-legacy-${id}`}
              className={legacy.shadowed ? 'text-xs text-muted' : 'inline-flex items-start gap-1 text-xs text-accent'}
            >
              {!legacy.shadowed && <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />}
              <span>
                {legacy.shadowed
                  ? range != null
                    ? t('legacy.shadowed', { count: legacy.count, range })
                    : t('legacy.shadowedNoRange', { count: legacy.count })
                  : range != null
                    ? t('legacy.active', { count: legacy.count, range })
                    : t('legacy.activeNoRange', { count: legacy.count })}
                {!legacy.shadowed && canEdit && <> {t('legacy.fix')}</>}
              </span>
            </span>
          </td>
        </tr>
      )}
    </>
  );
}
