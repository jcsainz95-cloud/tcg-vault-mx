'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronLeft } from 'lucide-react';
import {
  getMasterSetBinder,
  getAdminVaultMasterSetBinder,
  getVaultMasterSetBinder,
  searchBuylistCards,
  batchQuote,
  BUYLIST_QUOTE_BATCH_MAX,
} from '@/lib/api';
import type {
  BuylistQuoteItemDTO,
  BuylistBatchQuoteResultDTO,
  Finish,
  MasterSetBinderResponse,
  MasterSetCardCellDTO,
  MasterSetSummaryDTO,
  MasterSetVariantDTO,
} from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { QueryState } from '@/components/ui/QueryState';
import { FINISH_ORDER } from '@/lib/finish';
import type { MasterSetViewMode } from './mode';

type PieceFilter = 'all' | 'with' | 'gaps';

interface Props {
  mode: MasterSetViewMode;
  /** Requerido en `user_vault_admin`. */
  userId?: string;
  set: MasterSetSummaryDTO;
  onBack: () => void;
  onOpenCell: (cell: MasterSetCardCellDTO) => void;
  /** Solo modo `quoter`: clic en una casilla de acabado agrega esa combinación al carrito de venta. */
  onAddVariant?: (cell: MasterSetCardCellDTO, variant: MasterSetVariantDTO) => void;
}

/**
 * mode="quoter" (cotizador): SIN endpoint de binder propio — se compone client-side con los
 * MISMOS endpoints públicos del cotizador (`GET /buylist/cards` + `POST /buylist/quote/batch`,
 * SIN cambio de contrato). `GET /buylist/cards` pagina a 20: se acumulan TODAS las páginas del
 * set (patrón de M1View "Cargar más") ANTES de resolver, para que el binder muestre el set
 * COMPLETO (bug P-4a del cotizador: sets >20 cartas quedaban cortados sin control). Cada
 * variante trae su cotización (`variants[].quote`, v. types/contract.ts) resuelta con
 * `POST /buylist/quote/batch` en TROCEADO de ≤`BUYLIST_QUOTE_BATCH_MAX` ítems.
 */
async function fetchQuoterBinder(set: MasterSetSummaryDTO): Promise<MasterSetBinderResponse> {
  const PAGE_SIZE = 50;
  const cards: import('@/types/contract').CardDTO[] = [];
  let page = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await searchBuylistCards({ setId: set.setId, page, pageSize: PAGE_SIZE });
    cards.push(...res.data);
    if (cards.length >= res.total || res.data.length === 0) break;
    page += 1;
  }

  const items: BuylistQuoteItemDTO[] = cards.flatMap((c) =>
    FINISH_ORDER.filter((f) => c.availableFinishes.includes(f)).map((f) => ({
      cardId: c.id,
      productType: 'raw' as const,
      rawCondition: 'NM' as const,
      finish: f,
    })),
  );
  const quoteByKey = new Map<string, BuylistBatchQuoteResultDTO>();
  for (let i = 0; i < items.length; i += BUYLIST_QUOTE_BATCH_MAX) {
    const chunk = items.slice(i, i + BUYLIST_QUOTE_BATCH_MAX);
    const res = await batchQuote(chunk);
    res.results.forEach((r) => {
      const requested = chunk[r.index];
      if (requested) quoteByKey.set(`${requested.cardId}:${requested.finish}`, r);
    });
  }

  const cells: MasterSetCardCellDTO[] = cards.map((c, idx) => {
    const availableFinishes = FINISH_ORDER.filter((f) => c.availableFinishes.includes(f));
    const variants: MasterSetVariantDTO[] = availableFinishes.map((f) => {
      const r = quoteByKey.get(`${c.id}:${f}`);
      const quote = r && r.ok
        ? {
            status: r.quote.status,
            quotedPriceCents: r.quote.quotedPriceCents,
            rarity: r.rarity,
            appliedRule: r.appliedRule,
            referencePrice: r.referencePrice,
          }
        : null;
      return { finish: f, count: 0, covered: quote != null, buyable: undefined, quote };
    });
    return {
      cardId: c.id,
      number: c.number,
      numberSort: idx,
      name: c.name,
      rarity: c.rarity,
      imageSmallUrl: c.imageSmallUrl,
      availableFinishes,
      countsByFinish: [],
      totalCount: 0,
      isSecretRare: false,
      expectedVariantCount: availableFinishes.length,
      coveredVariantCount: variants.filter((v) => v.covered).length,
      variants,
    };
  });

  return {
    set: { id: set.setId, name: set.name, series: set.series, releaseDate: set.releaseDate },
    printedTotal: set.printedTotal ?? null,
    catalogCardCount: cells.length,
    cells,
    scope: 'platform',
  };
}

/** Endpoint por modo (contrato v1.20: mismo shape de binder, distinto scope). */
function fetchBinder(
  mode: MasterSetViewMode,
  userId: string | undefined,
  set: MasterSetSummaryDTO,
): Promise<MasterSetBinderResponse> {
  if (mode === 'quoter') return fetchQuoterBinder(set);
  if (mode === 'user_vault_self') return getVaultMasterSetBinder(set.setId);
  if (mode === 'user_vault_admin') return getAdminVaultMasterSetBinder(userId ?? '', set.setId);
  return getMasterSetBinder(set.setId);
}

/**
 * Binder COMPARTIDO del set (§4.20f): cuadrícula por número. Confía en el ORDEN NATURAL del
 * backend (numéricos primero, promos al final): NO re-ordena por número en cliente (contrato
 * §M1). Los filtros (acabado, con/sin huecos, secret rares) son LOCALES y preservan ese orden.
 * v1.20: cada celda muestra sus CASILLAS POR ACABADO (variants[], universo = availableFinishes)
 * y el contador «X/Y» cuenta variantes.
 */
export function MasterSetBinder({ mode, userId, set, onBack, onOpenCell, onAddVariant }: Props) {
  const t = useTranslations('masterSet');
  const tFinish = useTranslations('finish');
  const isQuoter = mode === 'quoter';
  const [finishFilter, setFinishFilter] = useState<'' | Finish>('');
  const [pieceFilter, setPieceFilter] = useState<PieceFilter>('all');
  const [onlySecret, setOnlySecret] = useState(false);
  // "Buscar carta" (SOLO quoter): el cotizador busca por nombre/número DENTRO del set elegido
  // (el índice de sets ya cubre "Filtrar por set"; ver mode.ts).
  const [nameFilter, setNameFilter] = useState('');

  const binder = useQuery({
    queryKey: ['master-set-binder', mode, userId ?? null, set.setId],
    queryFn: () => fetchBinder(mode, userId, set),
  });

  const cells = useMemo(() => {
    const all = binder.data?.cells ?? [];
    const name = nameFilter.trim().toLowerCase();
    // Filtros LOCALES sobre la respuesta completa; NO se re-ordena (se conserva el orden natural).
    return all.filter((c) => {
      if (finishFilter && !c.variants.some((v) => v.finish === finishFilter && v.covered)) return false;
      if (!isQuoter && pieceFilter === 'with' && c.coveredVariantCount === 0) return false;
      if (!isQuoter && pieceFilter === 'gaps' && c.coveredVariantCount >= c.expectedVariantCount) return false;
      if (!isQuoter && onlySecret && !c.isSecretRare) return false;
      if (name && !c.name.toLowerCase().includes(name) && !c.number.toLowerCase().includes(name)) return false;
      return true;
    });
  }, [binder.data, finishFilter, pieceFilter, onlySecret, isQuoter, nameFilter]);

  // v1.20: contador del set POR VARIANTE, derivado del binder (suma de expected/covered).
  const variantTotals = useMemo(() => {
    const all = binder.data?.cells ?? [];
    const expected = all.reduce((s, c) => s + c.expectedVariantCount, 0);
    const covered = all.reduce((s, c) => s + c.coveredVariantCount, 0);
    const pct = expected === 0 ? 0 : Math.round((covered / expected) * 1000) / 10;
    return { expected, covered, pct };
  }, [binder.data]);

  const owner = binder.data?.owner;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onBack} aria-label={t('backToIndex')}>
            <ChevronLeft size={18} /> {t('backToIndex')}
          </Button>
          <h2 lang="en" className="text-h2">
            {set.name}
          </h2>
        </div>
        {binder.data && !isQuoter && (
          <span className="font-mono tabular-nums text-xs text-muted">
            {t('completionValue', {
              owned: variantTotals.covered,
              total: variantTotals.expected,
              pct: variantTotals.pct,
            })}
          </span>
        )}
        {/* Quoter: sin completitud (no hay bóveda que agregar) — solo el total de cartas del set. */}
        {binder.data && isQuoter && (
          <span className="font-mono tabular-nums text-xs text-muted">
            {t('quoterCardCount', { count: binder.data.cells.length })}
          </span>
        )}
      </div>

      {/* Dueño de la bóveda (scope user_vault; email solo en la vista admin). */}
      {mode === 'user_vault_admin' && owner && (
        <p className="font-mono text-xs text-muted">
          {t('ownerVault', { name: owner.name })}
          {owner.email ? ` · ${owner.email}` : ''}
        </p>
      )}

      {/* Filtros LOCALES (no vuelven a pegarle al backend). */}
      <div className="flex flex-wrap items-end gap-3">
        {/* "Buscar carta" (quoter): nombre/número DENTRO de este set. */}
        {isQuoter && (
          <Input
            label={t('quoterSearchCard')}
            className="w-56"
            placeholder={t('quoterSearchCardPlaceholder')}
            value={nameFilter}
            onChange={(e) => setNameFilter(e.target.value)}
          />
        )}
        <Select
          label={t('filterFinish')}
          className="w-44"
          options={[
            { value: '', label: t('filterAll') },
            ...FINISH_ORDER.map((f) => ({ value: f, label: tFinish(f) })),
          ]}
          value={finishFilter}
          onChange={(e) => setFinishFilter(e.target.value as '' | Finish)}
        />
        {/* Con/sin huecos y secret rare son conceptos de INVENTARIO — no aplican en quoter
            (todas las variantes del universo son siempre cotizables). */}
        {!isQuoter && (
          <>
            <Select
              label={t('filterPieces')}
              className="w-48"
              options={[
                { value: 'all', label: t('filterAll') },
                { value: 'with', label: t('filterWithPieces') },
                { value: 'gaps', label: t('filterGaps') },
              ]}
              value={pieceFilter}
              onChange={(e) => setPieceFilter(e.target.value as PieceFilter)}
            />
            <label className="flex items-center gap-2 pb-3 text-sm">
              <input
                type="checkbox"
                checked={onlySecret}
                onChange={(e) => setOnlySecret(e.target.checked)}
                className="h-5 w-5 accent-[color:var(--color-accent)]"
              />
              {t('filterSecretRares')}
            </label>
          </>
        )}
      </div>

      <QueryState
        isLoading={binder.isLoading}
        isError={binder.isError}
        error={binder.error}
        onRetry={() => binder.refetch()}
      >
        {binder.data &&
          (cells.length === 0 ? (
            <EmptyState title={t('emptyBinderTitle')} body={t('emptyBinderBody')} />
          ) : (
            <ul
              className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
              aria-label={t('binderGridLabel')}
            >
              {cells.map((cell) => (
                <li key={cell.cardId}>
                  {isQuoter ? (
                    <QuoterCell cell={cell} onAddVariant={(v) => onAddVariant?.(cell, v)} />
                  ) : (
                    <BinderCell cell={cell} onOpen={() => onOpenCell(cell)} />
                  )}
                </li>
              ))}
            </ul>
          ))}
      </QueryState>
    </div>
  );
}

function BinderCell({ cell, onOpen }: { cell: MasterSetCardCellDTO; onOpen: () => void }) {
  const t = useTranslations('masterSet');
  const tFinish = useTranslations('finish');
  // Hueco TOTAL = ninguna variante cubierta → imagen atenuada + borde punteado (grid visual).
  const isGap = cell.coveredVariantCount === 0;
  // Drift de catálogo (contrato v1.20): piezas con acabado FUERA del universo se VEN pero no
  // cuentan en expected/covered.
  const driftCounts = cell.countsByFinish.filter(
    (cf) => !cell.variants.some((v) => v.finish === cf.finish),
  );
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex w-full flex-col gap-2 border p-2 text-left transition-colors focus-visible:shadow-focus focus-visible:outline-none ${
        isGap ? 'border-dashed border-border-strong bg-surface' : 'border-border bg-surface hover:bg-surface-2'
      }`}
    >
      <div className="relative">
        {/* Imagen de catálogo remota: lazy + content-visibility para binders grandes. */}
        <div
          className="aspect-[5/7] w-full overflow-hidden bg-surface-2"
          style={{ contentVisibility: 'auto', containIntrinsicSize: '140px 196px' } as React.CSSProperties}
        >
          {cell.imageSmallUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={cell.imageSmallUrl}
              alt=""
              aria-hidden
              loading="lazy"
              className={`h-full w-full object-contain ${isGap ? 'opacity-30' : ''}`}
            />
          ) : null}
        </div>
        {/* Badge secret rare (solo display) con scrim de tinta (§7.2b). */}
        {cell.isSecretRare && (
          <span className="absolute right-1 top-1 bg-[color:var(--color-ink)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[color:var(--color-on-ink)]">
            {t('secretRare')}
          </span>
        )}
      </div>
      <div className="flex items-baseline justify-between gap-1">
        <span className="font-mono tabular-nums text-xs text-muted">#{cell.number}</span>
        {isGap ? (
          <span className="font-mono text-[10px] uppercase tracking-wide text-accent">{t('gap')}</span>
        ) : (
          /* v1.20: el contador de la celda cuenta VARIANTES cubiertas del universo. */
          <span className="font-mono tabular-nums text-xs">
            {t('variantCount', { covered: cell.coveredVariantCount, expected: cell.expectedVariantCount })}
          </span>
        )}
      </div>
      <span lang="en" className="line-clamp-1 text-sm">
        {cell.name}
      </span>
      {/* v1.20: CASILLAS POR ACABADO — una por variante del universo; «HUECO» por acabado. */}
      <div className="flex flex-wrap gap-1">
        {cell.variants.map((v) =>
          v.covered ? (
            <span
              key={v.finish}
              className="border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide"
              aria-label={t('finishChipAria', { finish: tFinish(v.finish), count: v.count })}
            >
              {tFinish(v.finish)} · <span className="tabular-nums">{v.count}</span>
            </span>
          ) : (
            <span
              key={v.finish}
              className="border border-dashed border-border-strong px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-accent"
              aria-label={t('finishGapAria', { finish: tFinish(v.finish) })}
            >
              {tFinish(v.finish)} · {t('gap')}
            </span>
          ),
        )}
        {driftCounts.map((cf) => (
          <span
            key={`drift-${cf.finish}`}
            className="border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted"
            aria-label={t('driftChipAria', { finish: tFinish(cf.finish), count: cf.count })}
            title={t('driftNote')}
          >
            {tFinish(cf.finish)} · <span className="tabular-nums">{cf.count}</span> ⚠
          </span>
        ))}
      </div>
    </button>
  );
}

/**
 * Celda del cotizador (mode="quoter"): la imagen y el nombre son informativos (sin acción);
 * cada CASILLA de acabado es su propia acción — un clic agrega esa combinación (carta,
 * acabado) al carrito de venta con el precio ya cotizado (nunca un chip de texto, nunca una
 * casilla para un acabado que la carta no tiene: `cell.variants` viene 1:1 de
 * `availableFinishes`).
 */
function QuoterCell({
  cell,
  onAddVariant,
}: {
  cell: MasterSetCardCellDTO;
  onAddVariant: (variant: MasterSetVariantDTO) => void;
}) {
  const t = useTranslations('masterSet');
  const tFinish = useTranslations('finish');
  const locale = useLocale() as AppLocale;
  return (
    <div className="flex w-full flex-col gap-2 border border-border bg-surface p-2">
      <div className="aspect-[5/7] w-full overflow-hidden bg-surface-2">
        {cell.imageSmallUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cell.imageSmallUrl}
            alt=""
            aria-hidden
            loading="lazy"
            className="h-full w-full object-contain"
          />
        ) : null}
      </div>
      <div className="flex items-baseline justify-between gap-1">
        <span className="font-mono tabular-nums text-xs text-muted">#{cell.number}</span>
      </div>
      <span lang="en" className="line-clamp-1 text-sm">
        {cell.name}
      </span>
      {/* Una casilla POR ACABADO real de la carta; cada una es su propio botón de venta. */}
      <div className="flex flex-wrap gap-1">
        {cell.variants.map((v) => {
          const pending = v.quote?.status === 'precio_pendiente';
          const price =
            v.quote?.quotedPriceCents != null ? formatMoneyCents(v.quote.quotedPriceCents, locale) : null;
          return (
            <button
              key={v.finish}
              type="button"
              disabled={!v.quote}
              onClick={() => onAddVariant(v)}
              aria-label={t('quoterAddAria', {
                name: cell.name,
                finish: tFinish(v.finish),
                price: price ?? t('quoterPending'),
              })}
              className="flex flex-col items-start gap-0.5 border border-border px-1.5 py-1 text-left font-mono text-[10px] uppercase tracking-wide hover:border-text disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span>{tFinish(v.finish)}</span>
              <span className="tabular-nums normal-case tracking-normal">
                {pending ? t('quoterPending') : (price ?? t('quoterUnavailable'))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
