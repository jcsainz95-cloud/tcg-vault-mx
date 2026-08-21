'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronLeft, Crosshair } from 'lucide-react';
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
import { compareCardNumber, deriveNumberParts } from '@/lib/cardOrder';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { CardImage } from '@/components/ui/CardImage';
import { EmptyState } from '@/components/ui/EmptyState';
import { QueryState } from '@/components/ui/QueryState';
import { FINISH_ORDER, displayFinishesOf, displayedVariants } from '@/lib/finish';
import { FinishBand } from '@/components/domain/FinishMark';
import { VariantPricingCompact } from './VariantPriceConsole';
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
  /**
   * v1.28 (P-17, solo M1): si viene, el clic en una casilla abre el DRILL-DOWN de ESA variante
   * (VariantDrawer) en lugar del drawer por-carta. El dueño (M1View) monta el panel.
   */
  onOpenVariant?: (cell: MasterSetCardCellDTO, variant: MasterSetVariantDTO) => void;
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

  const cells: MasterSetCardCellDTO[] = cards.map((c) => {
    // v1.22: `availableFinishes` YA llega en orden canónico y nunca vacío (garantía normativa del
    // contrato). Se filtra por FINISH_ORDER solo como red de seguridad ante datos históricos; NO
    // se rellena con acabados que la carta no tiene.
    const availableFinishes = FINISH_ORDER.filter((f) => c.availableFinishes.includes(f));
    // v1.22-2 (N-15): displayFinishes del CardDTO (o fallback a availableFinishes) manda QUÉ se pinta;
    // el render plano (N-16) usa `variant.displayed` para expandir la celda en una tarjeta por acabado.
    const display = displayFinishesOf(c);
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
      return { finish: f, count: 0, covered: quote != null, buyable: undefined, quote, displayed: display.includes(f) };
    });
    // v1.22: las claves de orden vienen del CardDTO (columnas de `Card`, M-26). Si el backend aún
    // no las expone, se derivan con la regla del contrato — NUNCA con el índice del arreglo.
    const orderKeys = deriveNumberParts(c.number);
    return {
      cardId: c.id,
      number: c.number,
      numberSort: typeof c.numberSort === 'number' ? c.numberSort : orderKeys.numberSort,
      numberPrefix: typeof c.numberPrefix === 'string' ? c.numberPrefix : orderKeys.numberPrefix,
      name: c.name,
      rarity: c.rarity,
      imageSmallUrl: c.imageSmallUrl,
      availableFinishes,
      displayFinishes: display,
      countsByFinish: [],
      totalCount: 0,
      isSecretRare: false,
      // Completitud: sobre availableFinishes (N-16: las variantes no mostradas SÍ cuentan).
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
 * Binder COMPARTIDO del set (§4.20f): cuadrícula por número. El ORDEN NATURAL lo da el backend
 * (numéricos primero, promos al final, ordenado en SQL antes de paginar); los filtros (acabado,
 * con/sin huecos, secret rares, nombre) son LOCALES y, tras filtrar, se re-ordena con las claves
 * del propio DTO `(numberPrefix, numberSort, number)` — contrato v1.22, `@/lib/cardOrder`.
 * v1.22: cada celda pinta UNA CASILLA DE IMAGEN POR VARIANTE REAL (variants[] = universo exacto
 * `availableFinishes`, orden canónico: normal a la izquierda, reverse holo a la derecha); el
 * contador «X/Y» cuenta variantes. Prohibida la casilla de relleno.
 */
export function MasterSetBinder({ mode, userId, set, onBack, onOpenCell, onAddVariant, onOpenVariant }: Props) {
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

  // N-16 REJILLA PLANA: el grid ya NO es una casilla por carta con sub-acabados, sino UNA TARJETA
  // por impresión (carta+acabado). Se expande cada celda con `displayedVariants` (una entrada por
  // `displayFinish`, orden FINISH_ORDER) y el resultado es un flujo plano de `{cell, variant}`.
  const tiles = useMemo(() => {
    const all = binder.data?.cells ?? [];
    const name = nameFilter.trim().toLowerCase();
    // El orden de CARTAS lo da el backend (SQL, antes de paginar); al filtrar en cliente se REPRODUCE
    // con las claves del DTO (numberPrefix, numberSort, number) — contrato v1.22. Dentro de una carta,
    // el orden de acabados lo fija FINISH_ORDER (garantizado por displayedVariants).
    const cellMatches = (c: MasterSetCardCellDTO) => {
      if (!isQuoter && onlySecret && !c.isSecretRare) return false;
      if (name && !c.name.toLowerCase().includes(name) && !c.number.toLowerCase().includes(name)) return false;
      return true;
    };
    const sortedCells = [...all.filter(cellMatches)].sort(compareCardNumber);
    const out: { cell: MasterSetCardCellDTO; variant: MasterSetVariantDTO }[] = [];
    for (const cell of sortedCells) {
      for (const variant of displayedVariants(cell)) {
        // Filtros por TARJETA (acabado): con/sin huecos y acabado ahora deciden a nivel impresión.
        if (finishFilter && variant.finish !== finishFilter) continue;
        if (!isQuoter && pieceFilter === 'with' && !variant.covered) continue;
        if (!isQuoter && pieceFilter === 'gaps' && variant.covered) continue;
        out.push({ cell, variant });
      }
    }
    return out;
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
          (tiles.length === 0 ? (
            <EmptyState title={t('emptyBinderTitle')} body={t('emptyBinderBody')} />
          ) : (
            <ul
              className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
              aria-label={t('binderGridLabel')}
            >
              {tiles.map(({ cell, variant }) => (
                <li key={`${cell.cardId}:${variant.finish}`} className="min-w-0">
                  {isQuoter ? (
                    <QuoterTile cell={cell} variant={variant} onAdd={() => onAddVariant?.(cell, variant)} />
                  ) : (
                    <BinderTile
                      cell={cell}
                      variant={variant}
                      onOpen={() =>
                        onOpenVariant ? onOpenVariant(cell, variant) : onOpenCell(cell)
                      }
                    />
                  )}
                </li>
              ))}
            </ul>
          ))}
      </QueryState>
    </div>
  );
}


/**
 * Cabecera COMPARTIDA de una tarjeta de impresión (N-16): arte de catálogo + nombre (serif) +
 * "#número · Acabado" (mono). Todas las tarjetas de una MISMA carta comparten la imagen
 * (`cell.imageSmallUrl`); lo que las distingue es el acabado. Reusa `CardImage` (el mismo
 * componente de arte de la tienda / `ListingCard`), no la casilla de master-set con sub-celdas.
 */
function TileHeader({
  cell,
  finishLabel,
  dimmed,
  dashed,
  showTotalCount,
}: {
  cell: MasterSetCardCellDTO;
  finishLabel: string;
  dimmed?: boolean;
  dashed?: boolean;
  /**
   * INV-2: pinta el TOTAL on-hand POR CARTA (`cell.totalCount`, suma de todas las impresiones) como
   * un badge discreto sobre el arte. Como TileHeader es COMPARTIDO por todas las tarjetas de una misma
   * carta (N-16: una tarjeta por impresión), la cifra se repite en cada impresión de esa carta y
   * responde "tengo N de esta carta". El on-hand no aplica al cotizador → allí NO se pasa este flag.
   */
  showTotalCount?: boolean;
}) {
  const t = useTranslations('masterSet');
  const hasTotal = !!showTotalCount && cell.totalCount > 0;
  return (
    <>
      <span className="relative block">
        <CardImage
          src={cell.imageSmallUrl}
          alt={`${cell.name} · ${finishLabel}`}
          className={`${dashed ? 'border border-dashed border-border-strong' : ''} ${dimmed ? 'opacity-40' : ''}`}
        />
        {/* Badge secret rare (solo display) con scrim de tinta (§7.2b). */}
        {cell.isSecretRare && (
          <span className="absolute right-1 top-1 bg-[color:var(--color-ink)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[color:var(--color-on-ink)]">
            {t('secretRare')}
          </span>
        )}
        {/* INV-2: total on-hand por carta ("tengo N de esta carta") — badge discreto arriba-izquierda,
            en la esquina opuesta al de secret rare para que ambos convivan. */}
        {hasTotal && (
          <span
            className="absolute left-1 top-1 bg-[color:var(--color-ink)] px-1.5 py-0.5 font-mono tabular-nums text-[10px] uppercase tracking-wide text-[color:var(--color-on-ink)]"
            title={t('cardTotalCountAria', { count: cell.totalCount })}
          >
            {t('cardTotalCount', { count: cell.totalCount })}
          </span>
        )}
      </span>
      <p lang="en" className="mt-2.5 line-clamp-2 font-serif text-[15px] leading-tight text-text">
        {cell.name}
      </p>
      {/* El acabado es el DISCRIMINADOR de la tarjeta: en mono, junto al número. */}
      <p className="mt-1 font-mono text-[10px] uppercase leading-snug tracking-wide text-muted">
        <span className="tabular-nums">#{cell.number}</span>
        <span aria-hidden> · </span>
        <span className="text-text">{finishLabel}</span>
      </p>
    </>
  );
}

/**
 * Tarjeta de impresión del BINDER (M1 / bóveda cliente / bóveda admin) — N-16: una tarjeta por
 * (carta, acabado a pintar). Muestra el conteo de ESE acabado (cubierto) o "HUECO"; el clic abre el
 * drawer de la carta (detalle por acabado, alta/publicación/ajuste en M1, compra de faltantes en la
 * bóveda del propio cliente). Los contadores de completitud «X/Y» del encabezado siguen contando
 * sobre availableFinishes (variantes no mostradas cuentan pero no se pintan).
 */
function BinderTile({
  cell,
  variant,
  onOpen,
}: {
  cell: MasterSetCardCellDTO;
  variant: MasterSetVariantDTO;
  onOpen: () => void;
}) {
  const t = useTranslations('masterSet');
  const tFinish = useTranslations('finish');
  const locale = useLocale() as AppLocale;
  const finishLabel = tFinish(variant.finish);
  const isGap = !variant.covered;
  // P-15 (v1.27): precio de MERCADO POR VARIANTE — cada tarjeta lee la referencia de SU acabado
  // (`variant.marketReferenceMxnCents`), no la de la celda (el bug P-15: Normal y Reverse pintaban
  // el mismo precio del acabado base). Fallback TEMPORAL al campo de celda DEPRECADO solo cuando la
  // variante NO trae el campo (`undefined` = backend rezagado durante el deploy); `null` explícito
  // de la variante = pending honesto → "—". NUNCA $0 inventado (money-safe, bug P-1).
  const marketRef =
    variant.marketReferenceMxnCents !== undefined
      ? variant.marketReferenceMxnCents
      : cell.marketReferenceMxnCents; // DEPRECATED v1.27: retirar junto con el campo de celda.
  const marketPrice = marketRef != null ? formatMoneyCents(marketRef, locale) : null;
  // v1.28 (P-18): con `pricing` (SOLO scope platform) la teja pinta la consola compacta de tres
  // precios (MERCADO/COMPRA/VENTA con marcador de origen) en lugar del renglón único P-15.
  const pricing = variant.pricing;
  const bountyOn = pricing?.bounty?.enabled === true;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      className="flex h-full w-full flex-col text-left transition-colors focus-visible:shadow-focus focus-visible:outline-none"
    >
      {/* FinishMark (§16.6): banda superior de 3px — canal de color; el texto lo porta la
          etiqueta de acabado del TileHeader (doble canal, nunca banda sin texto). */}
      <FinishBand finish={variant.finish} />
      <TileHeader cell={cell} finishLabel={finishLabel} dimmed={isGap} dashed={isGap} showTotalCount />
      {pricing ? (
        <VariantPricingCompact pricing={pricing} marketRefCents={marketRef} />
      ) : (
        /* P-15: precio de mercado de ESTA variante (subtitulado "Mercado"), o affordance de pendiente. */
        <span className="mt-2 flex items-baseline gap-1.5 font-mono text-[10px] uppercase tracking-wide text-muted">
          <span>{t('marketLabel')}</span>
          {marketPrice != null ? (
            <span className="tabular-nums normal-case tracking-normal text-text">{marketPrice}</span>
          ) : (
            <span className="text-accent" title={t('marketPending')}>
              {t('marketPendingShort')}
            </span>
          )}
        </span>
      )}
      <span className="mt-auto flex items-center gap-2 pt-2">
        {isGap ? (
          <span className="font-mono text-[10px] uppercase tracking-wide text-accent">{t('gap')}</span>
        ) : (
          <span className="font-mono tabular-nums text-xs text-text">
            {t('totalCount', { count: variant.count })}
          </span>
        )}
        {/* Badge bounty (P-22, §16.7b): mono bermellón + mira decorativa. */}
        {bountyOn && (
          <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.06em] text-accent">
            <Crosshair size={14} aria-hidden /> {t('bountyBadge')}
          </span>
        )}
      </span>
    </button>
  );
}

/**
 * Tarjeta de impresión del COTIZADOR (mode="quoter") — N-16: una tarjeta por (carta, acabado a
 * pintar) con su propio precio cotizado y su propio botón "Agregar" (agrega esa combinación al
 * carrito de venta con el precio ya cotizado server-side). Una variante SIN precio se SIGUE
 * mostrando en "precio pendiente" (el universo de acabados sale de displayFinishes, no de los precios).
 */
function QuoterTile({
  cell,
  variant,
  onAdd,
}: {
  cell: MasterSetCardCellDTO;
  variant: MasterSetVariantDTO;
  onAdd: () => void;
}) {
  const t = useTranslations('masterSet');
  const tFinish = useTranslations('finish');
  const locale = useLocale() as AppLocale;
  const finishLabel = tFinish(variant.finish);
  const pending = variant.quote?.status === 'precio_pendiente';
  const price =
    variant.quote?.quotedPriceCents != null ? formatMoneyCents(variant.quote.quotedPriceCents, locale) : null;
  return (
    <div className="flex h-full flex-col">
      <TileHeader cell={cell} finishLabel={finishLabel} />
      <p className="mt-2 font-mono tabular-nums text-[13px] text-text">
        {pending ? (
          <span className="text-accent">{t('quoterPending')}</span>
        ) : (
          price ?? <span className="text-accent">{t('quoterUnavailable')}</span>
        )}
      </p>
      <div className="mt-auto pt-2.5">
        <Button
          variant="secondary"
          size="sm"
          className="w-full"
          disabled={!variant.quote}
          onClick={onAdd}
          aria-label={t('quoterAddAria', {
            name: cell.name,
            finish: finishLabel,
            price: price ?? t('quoterPending'),
          })}
        >
          {t('quoterAdd')}
        </Button>
      </div>
    </div>
  );
}
