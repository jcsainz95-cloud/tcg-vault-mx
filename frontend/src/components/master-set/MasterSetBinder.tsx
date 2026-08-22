'use client';

import { useEffect, useMemo, useState } from 'react';
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
  BuylistQuoteResponse,
  BuylistBatchQuoteResultDTO,
  CardProductDTO,
  Finish,
  MasterSetBinderResponse,
  MasterSetCardCellDTO,
  MasterSetSummaryDTO,
  MasterSetVariantDTO,
  SetPartDTO,
} from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { compareCardNumber, deriveNumberParts } from '@/lib/cardOrder';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { CardImage } from '@/components/ui/CardImage';
import { CardSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { QueryState } from '@/components/ui/QueryState';
import { FINISH_ORDER, displayFinishesOf, displayedVariants } from '@/lib/finish';
import { FinishBand } from '@/components/domain/FinishMark';
import { cn } from '@/lib/cn';
import { HuntMarkMicro } from '@/components/domain/LogoTcgHunt';
import { VariantPricingCompact } from './VariantPriceConsole';
import type { MasterSetViewMode } from './mode';

type PieceFilter = 'all' | 'with' | 'gaps';

/**
 * v1.29 (§4.27): la rejilla plana mezcla DOS clases de teja:
 * - `variant`: una impresión (carta+acabado) del set base (universo `variants[]`).
 * - `product`: un producto vendible SEPARADO (Deck Exclusive/promo) de la carta, con su PROPIO
 *   precio por acabado. NO se fusiona en la carta base; NO cuenta para la completitud del set.
 */
type BinderTileItem =
  | { kind: 'variant'; cell: MasterSetCardCellDTO; variant: MasterSetVariantDTO }
  | {
      kind: 'product';
      cell: MasterSetCardCellDTO;
      product: CardProductDTO;
      finish: Finish;
      priceCents: number | null;
      // v1.30 (§4.29, SOLO quoter): cotización de buylist de ESTE producto separado por su
      // `productId` (composición client-side, como variant.quote). `ok:false` ⇒ error por-línea
      // (PRODUCT_NOT_FOUND / PRODUCT_CARD_MISMATCH); undefined en modos no-quoter (presentación).
      quoteResult?: BuylistBatchQuoteResultDTO;
    };

/**
 * v1.30 (§4.29): el quoter compone las cotizaciones de los productos SEPARADOS (por `productId`)
 * 100% client-side, igual que `variant.quote`. Se guardan en un mapa por `${cardId}:${productId}:${finish}`
 * anexado a la respuesta del binder (campo client-only, NO viaja del backend en ningún endpoint).
 */
interface QuoterBinderResponse extends MasterSetBinderResponse {
  separateProductQuotes?: Record<string, BuylistBatchQuoteResultDTO>;
}
const separateQuoteKey = (cardId: string, productId: number, finish: Finish) =>
  `${cardId}:${productId}:${finish}`;

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
   * v1.30 (§4.29) · Solo modo `quoter`: clic en «Agregar» de un PRODUCTO SEPARADO
   * (deck_exclusive/promo) agrega ESE producto al carrito de venta como LÍNEA PROPIA por su
   * `productId` (precio propio, no fusionado con la carta base). `quote` es la cotización ya
   * resuelta server-side (eco de `productId`).
   */
  onAddProduct?: (
    cell: MasterSetCardCellDTO,
    product: CardProductDTO,
    finish: Finish,
    quote: BuylistQuoteResponse,
  ) => void;
  /**
   * v1.28 (P-17, solo M1): si viene, el clic en una casilla abre el DRILL-DOWN de ESA variante
   * (VariantDrawer) en lugar del drawer por-carta. El dueño (M1View) monta el panel.
   */
  onOpenVariant?: (cell: MasterSetCardCellDTO, variant: MasterSetVariantDTO) => void;
  /**
   * v1.33 (P-27, §4.31b.6): cuando el binder se pidió por un SUBSET de un master combinado, el backend
   * lo normaliza a su principal y devuelve `canonicalSetId`. El binder lo notifica para que el dueño
   * actualice la selección/URL al set canónico (evita el binder roto de 25 al abrir un subset).
   */
  onCanonicalResolved?: (canonical: { setId: string; name: string }) => void;
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
async function fetchQuoterBinder(set: MasterSetSummaryDTO): Promise<QuoterBinderResponse> {
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

  // v1.30 (§4.29): el lote incluye DOS clases de línea — el set_base por (carta, acabado) y CADA
  // producto SEPARADO por (carta, productId, acabado). El `index` del batch no basta para
  // correlacionar (base holofoil y producto holofoil de la MISMA carta comparten cardId+finish), así
  // que se lleva un arreglo PARALELO de llaves con el productId incluido.
  const items: BuylistQuoteItemDTO[] = [];
  const keys: string[] = [];
  for (const c of cards) {
    for (const f of FINISH_ORDER.filter((ff) => c.availableFinishes.includes(ff))) {
      items.push({ cardId: c.id, productType: 'raw', rawCondition: 'NM', finish: f });
      keys.push(`${c.id}:${f}`);
    }
    for (const p of c.separateProducts ?? []) {
      for (const f of FINISH_ORDER.filter((ff) => p.finishes.includes(ff))) {
        items.push({ cardId: c.id, productType: 'raw', rawCondition: 'NM', finish: f, productId: p.productId });
        keys.push(separateQuoteKey(c.id, p.productId, f));
      }
    }
  }
  const quoteByKey = new Map<string, BuylistBatchQuoteResultDTO>();
  for (let i = 0; i < items.length; i += BUYLIST_QUOTE_BATCH_MAX) {
    const chunk = items.slice(i, i + BUYLIST_QUOTE_BATCH_MAX);
    const chunkKeys = keys.slice(i, i + BUYLIST_QUOTE_BATCH_MAX);
    const res = await batchQuote(chunk);
    res.results.forEach((r) => {
      const key = chunkKeys[r.index];
      if (key) quoteByKey.set(key, r);
    });
  }

  // Mapa de cotizaciones de productos separados por (cardId:productId:finish) para el render de sus
  // tejas (precio propio + botón Agregar / error por-línea). Money-safe: sin precio ⇒ precio_pendiente.
  const separateProductQuotes: Record<string, BuylistBatchQuoteResultDTO> = {};
  for (const c of cards) {
    for (const p of c.separateProducts ?? []) {
      for (const f of FINISH_ORDER.filter((ff) => p.finishes.includes(ff))) {
        const key = separateQuoteKey(c.id, p.productId, f);
        const r = quoteByKey.get(key);
        if (r) separateProductQuotes[key] = r;
      }
    }
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
      // v1.29 (§4.27): productos vendibles SEPARADOS (Deck Exclusives/promo) — el cotizador los
      // propaga tal cual del CardDTO; se pintan como su propio producto con su propio precio.
      ...(c.separateProducts && c.separateProducts.length > 0
        ? { separateProducts: c.separateProducts }
        : {}),
    };
  });

  return {
    set: { id: set.setId, name: set.name, series: set.series, releaseDate: set.releaseDate },
    printedTotal: set.printedTotal ?? null,
    catalogCardCount: cells.length,
    cells,
    scope: 'platform',
    separateProductQuotes,
  };
}

/** Endpoint por modo (contrato v1.20: mismo shape de binder, distinto scope). */
function fetchBinder(
  mode: MasterSetViewMode,
  userId: string | undefined,
  set: MasterSetSummaryDTO,
): Promise<QuoterBinderResponse> {
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
export function MasterSetBinder({ mode, userId, set, onBack, onOpenCell, onAddVariant, onAddProduct, onOpenVariant, onCanonicalResolved }: Props) {
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
  // v1.33 (P-27): orden de bloque de un master combinado (partSetId → order del `parts`).
  const partOrder = useMemo(() => {
    const m = new Map<string, number>();
    (binder.data?.parts ?? []).forEach((p) => m.set(p.setId, p.order));
    return m;
  }, [binder.data]);

  const tiles = useMemo(() => {
    const all = binder.data?.cells ?? [];
    // v1.30 (§4.29, solo quoter): cotizaciones de productos separados por (cardId:productId:finish).
    const quoteMap = binder.data?.separateProductQuotes;
    const name = nameFilter.trim().toLowerCase();
    // El orden de CARTAS lo da el backend (SQL, antes de paginar); al filtrar en cliente se REPRODUCE
    // con las claves del DTO (numberPrefix, numberSort, number) — contrato v1.22. Dentro de una carta,
    // el orden de acabados lo fija FINISH_ORDER (garantizado por displayedVariants).
    const cellMatches = (c: MasterSetCardCellDTO) => {
      if (!isQuoter && onlySecret && !c.isSecretRare) return false;
      if (name && !c.name.toLowerCase().includes(name) && !c.number.toLowerCase().includes(name)) return false;
      return true;
    };
    // v1.33 (P-27, §4.31b.3): en un master combinado se ordena por (parte, orden natural) para que los
    // bloques NO se intercalen al re-ordenar en cliente (la colisión de numeración entre partes queda
    // separada por bloque). En un set normal (sin `parts`) es el orden natural de siempre.
    const byPartThenNumber = (a: MasterSetCardCellDTO, b: MasterSetCardCellDTO) => {
      if (partOrder.size > 0) {
        const oa = partOrder.get(a.partSetId ?? '') ?? 0;
        const ob = partOrder.get(b.partSetId ?? '') ?? 0;
        if (oa !== ob) return oa - ob;
      }
      return compareCardNumber(a, b);
    };
    const sortedCells = [...all.filter(cellMatches)].sort(byPartThenNumber);
    const out: BinderTileItem[] = [];
    for (const cell of sortedCells) {
      for (const variant of displayedVariants(cell)) {
        // Filtros por TARJETA (acabado): con/sin huecos y acabado ahora deciden a nivel impresión.
        if (finishFilter && variant.finish !== finishFilter) continue;
        if (!isQuoter && pieceFilter === 'with' && !variant.covered) continue;
        if (!isQuoter && pieceFilter === 'gaps' && variant.covered) continue;
        out.push({ kind: 'variant', cell, variant });
      }
      // v1.29 (§4.27): los productos SEPARADOS (Deck Exclusives/promo) de la carta son productos
      // vendibles PROPIOS (NO se fusionan en la carta base). Se pintan como tejas aparte, una por
      // (producto, acabado), con su propio precio. No participan de la completitud (expected/covered)
      // ni del filtro con/sin huecos (no son variantes de inventario), así que solo se listan cuando
      // el filtro de piezas es "todos"; el filtro de acabado SÍ aplica.
      for (const product of cell.separateProducts ?? []) {
        if (!isQuoter && pieceFilter !== 'all') continue;
        for (const finish of FINISH_ORDER.filter((f) => product.finishes.includes(f))) {
          if (finishFilter && finish !== finishFilter) continue;
          const priceCents =
            product.prices.find((p) => p.finish === finish)?.marketReferenceMxnCents ?? null;
          // v1.30 (§4.29, solo quoter): adjunta la cotización de buylist del producto (por productId)
          // para que su teja pinte el estimado propio + botón Agregar / error por-línea.
          const quoteResult = quoteMap?.[separateQuoteKey(cell.cardId, product.productId, finish)];
          out.push({ kind: 'product', cell, product, finish, priceCents, quoteResult });
        }
      }
    }
    return out;
  }, [binder.data, partOrder, finishFilter, pieceFilter, onlySecret, isQuoter, nameFilter]);

  // v1.33 (P-27, §4.31b.4): agrupa las tejas por PARTE para pintar el separador/etiqueta por bloque.
  // Un set de una sola parte (sin `parts`) es UNA sección sin encabezado (render idéntico a hoy).
  const sections = useMemo(() => {
    const parts = binder.data?.parts;
    if (!parts || parts.length === 0) return [{ part: null as SetPartDTO | null, tiles }];
    return parts
      .map((part) => ({ part, tiles: tiles.filter((tl) => tl.cell.partSetId === part.setId) }))
      .filter((sec) => sec.tiles.length > 0);
  }, [binder.data, tiles]);

  // v1.20: contador del set POR VARIANTE, derivado del binder (suma de expected/covered).
  const variantTotals = useMemo(() => {
    const all = binder.data?.cells ?? [];
    const expected = all.reduce((s, c) => s + c.expectedVariantCount, 0);
    const covered = all.reduce((s, c) => s + c.coveredVariantCount, 0);
    const pct = expected === 0 ? 0 : Math.round((covered / expected) * 1000) / 10;
    return { expected, covered, pct };
  }, [binder.data]);

  const owner = binder.data?.owner;

  // v1.33 (P-27, §4.31b.6): si el binder se pidió por un subset, el backend normaliza al principal y
  // devuelve `canonicalSetId`; notifica al dueño para canonizar la selección/URL (no más binder de 25).
  const canonicalSetId = binder.data?.canonicalSetId;
  const canonicalName = binder.data?.set.name;
  useEffect(() => {
    if (canonicalSetId && canonicalSetId !== set.setId) {
      onCanonicalResolved?.({ setId: canonicalSetId, name: canonicalName ?? set.name });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canonicalSetId, set.setId]);

  // Título del master: el NOMBRE del principal (SetRefDTO de la respuesta) manda sobre el del prop,
  // así abrir un subset ya muestra "Celebrations" y no la etiqueta del subset.
  const title = canonicalName ?? set.name;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onBack} aria-label={t('backToIndex')}>
            <ChevronLeft size={18} /> {t('backToIndex')}
          </Button>
          <h2 lang="en" className="text-h2">
            {title}
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

      {/* Filtros LOCALES (no vuelven a pegarle al backend). En quoter se vuelven STICKY en
          ≥lg (§18.1, P-16): en sets de 200+ tejas grandes el usuario no debe scrollear de
          vuelta para filtrar. Fondo papel + regla inferior; z-10 por debajo del drawer del
          carrito (z-50) y del FAB (z-40). En <lg scroll natural (sticky + teclado móvil
          estorban más de lo que ayudan).
          TL-C1: el offset sale de `--app-header-h` (altura REAL del header sticky del
          layout, expuesta por StorefrontHeader) con fallback 0px — nunca un top-[72px]
          hardcodeado aquí: este componente es compartido y no sabe qué shell lo monta. */}
      <div
        className={cn(
          'flex flex-wrap items-end gap-3',
          isQuoter &&
            'lg:sticky lg:top-[var(--app-header-h,0px)] lg:z-10 lg:border-b lg:border-border lg:bg-bg lg:pb-3',
        )}
      >
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
        /* §18.6: skeletons con la MISMA retícula final (teja 5:7 + 2 líneas + botón),
           sin spinner de página. Misma escala de columnas que el grid real. */
        loading={
          <div className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {Array.from({ length: 10 }, (_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        }
      >
        {binder.data &&
          (tiles.length === 0 ? (
            <EmptyState title={t('emptyBinderTitle')} body={t('emptyBinderBody')} />
          ) : (
            /* v1.33 (P-27): un master combinado se pinta como bloques (principal primero, luego cada
               subset etiquetado); un set de una sola parte es UNA sección sin encabezado (idéntico a hoy). */
            sections.map((section) => (
              <div key={section.part?.setId ?? '__single__'} className="flex flex-col gap-4">
                {section.part && (
                  <PartSeparator part={section.part} tileCount={section.tiles.length} />
                )}
                <ul
                  className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
                  aria-label={
                    section.part
                      ? t('partGridLabel', { part: section.part.label ?? section.part.name })
                      : t('binderGridLabel')
                  }
                >
                  {section.tiles.map((tile) =>
                    tile.kind === 'product' ? (
                      <li
                        key={`${tile.cell.cardId}:sp:${tile.product.productId}:${tile.finish}`}
                        className="min-w-0"
                      >
                        <SeparateProductTile
                          cell={tile.cell}
                          product={tile.product}
                          finish={tile.finish}
                          priceCents={tile.priceCents}
                          isQuoter={isQuoter}
                          quoteResult={tile.quoteResult}
                          onAdd={
                            onAddProduct
                              ? (quote) => onAddProduct(tile.cell, tile.product, tile.finish, quote)
                              : undefined
                          }
                        />
                      </li>
                    ) : (
                      <li key={`${tile.cell.cardId}:${tile.variant.finish}`} className="min-w-0">
                        {isQuoter ? (
                          <QuoterTile
                            cell={tile.cell}
                            variant={tile.variant}
                            onAdd={() => onAddVariant?.(tile.cell, tile.variant)}
                          />
                        ) : (
                          <BinderTile
                            cell={tile.cell}
                            variant={tile.variant}
                            onOpen={() =>
                              onOpenVariant
                                ? onOpenVariant(tile.cell, tile.variant)
                                : onOpenCell(tile.cell)
                            }
                          />
                        )}
                      </li>
                    ),
                  )}
                </ul>
              </div>
            ))
          ))}
      </QueryState>
    </div>
  );
}


/**
 * v1.33 (P-27, §4.31b.4): separador/etiqueta de un BLOQUE de un master combinado. Sobre papel, un
 * único canal visual: etiqueta mono en versalitas + la regla del sistema (§2.2, `--rule`, el único
 * separador permitido) + el subtotal de cartas del bloque. El bloque del principal lleva el nombre del
 * master ("Celebrations"); cada subset lleva su etiqueta ("Classic Collection").
 */
function PartSeparator({ part, tileCount }: { part: SetPartDTO; tileCount: number }) {
  const t = useTranslations('masterSet');
  return (
    <div className="flex items-center gap-3">
      <h3
        lang="en"
        className="font-mono text-xs uppercase tracking-wide text-muted"
        data-part-set-id={part.setId}
      >
        {part.label ?? part.name}
      </h3>
      <span className="h-px flex-1 bg-border" aria-hidden />
      <span className="font-mono tabular-nums text-[10px] uppercase tracking-wide text-muted">
        {t('partCardCount', { count: part.catalogCardCount })}
      </span>
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
        {/* Badge bounty (P-22, §16.7b): mono en accent + glifo micro oficial de la
            mira TCG HUNT (§17.1d, sustituye al crosshair de lucide). */}
        {bountyOn && (
          <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.06em] text-accent">
            <HuntMarkMicro size={14} /> {t('bountyBadge')}
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
      {/* P-14 (§18.3): el quoter adopta el FinishMark/FinishBand de §16.6 EXACTAMENTE como
          BinderTile — banda de 3px (canal color, decorativa); el texto lo porta la etiqueta
          de acabado del TileHeader (doble canal, nunca banda sin texto). */}
      <FinishBand finish={variant.finish} />
      {/* §18.2: precio estimado como héroe secundario (15px, mono, TINTA — el verde
          «Pagamos» queda exclusivo del BountyCard §16.7c: esto es estimado, no promesa). */}
      <TileHeader cell={cell} finishLabel={finishLabel} />
      <p className="mt-2 font-mono tabular-nums text-[15px] text-text">
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

/**
 * v1.29 (§4.27) / v1.30 (§4.29) — teja de un PRODUCTO SEPARADO (Deck Exclusive/promo) de la carta.
 * Es un producto vendible PROPIO con su propio `productId` y su propio precio por acabado: NO se
 * fusiona en la carta base ni cuenta para la completitud del set. Comparte la imagen de la carta
 * pero se rotula con su tipo de producto (Deck Exclusive / Promo). Money-safe: precio ausente → "—"
 * (nunca $0).
 *
 * - Modos de INVENTARIO (M1 / bóveda): PRESENTACIÓN — pinta el precio de MERCADO propio del producto.
 * - Modo COTIZADOR (`isQuoter`): v1.30 (§4.29) el producto es COTIZABLE como línea propia — pinta el
 *   ESTIMADO de buylist (cotizado server-side por `productId`) y un botón «Agregar» que lo manda al
 *   carrito de venta como su propia línea. Errores del contrato (`PRODUCT_NOT_FOUND`,
 *   `PRODUCT_CARD_MISMATCH`, `FINISH_NOT_AVAILABLE`) se muestran por-línea sin romper el binder.
 */
function SeparateProductTile({
  cell,
  product,
  finish,
  priceCents,
  isQuoter,
  quoteResult,
  onAdd,
}: {
  cell: MasterSetCardCellDTO;
  product: CardProductDTO;
  finish: Finish;
  priceCents: number | null;
  isQuoter?: boolean;
  quoteResult?: BuylistBatchQuoteResultDTO;
  onAdd?: (quote: BuylistQuoteResponse) => void;
}) {
  const t = useTranslations('masterSet');
  const tFinish = useTranslations('finish');
  const locale = useLocale() as AppLocale;
  const finishLabel = tFinish(finish);
  const kindLabel = t(`productKind.${product.kind}`);
  const marketPrice = priceCents != null ? formatMoneyCents(priceCents, locale) : null;

  // v1.30 (§4.29): en el cotizador el ESTIMADO de buylist manda (cotizado server-side por productId).
  const quoteOk = quoteResult?.ok ? quoteResult : null;
  const quoteError = quoteResult && !quoteResult.ok ? quoteResult.error.code : null;
  const pending = quoteOk?.quote.status === 'precio_pendiente';
  const quotedPrice =
    quoteOk?.quote.quotedPriceCents != null ? formatMoneyCents(quoteOk.quote.quotedPriceCents, locale) : null;

  return (
    <div
      className="flex h-full flex-col"
      aria-label={t('separateProductAria', {
        name: product.name,
        kind: kindLabel,
        finish: finishLabel,
        price: marketPrice ?? t('marketPending'),
      })}
    >
      {/* FinishBand (§16.6): banda superior de 3px — canal de color; el texto lo porta la etiqueta. */}
      <FinishBand finish={finish} />
      <span className="relative block">
        <CardImage src={cell.imageSmallUrl} alt={`${product.name} · ${finishLabel}`} />
        {/* Distintivo de PRODUCTO APARTE con scrim de tinta (§7.2b): separa visualmente del set base. */}
        <span className="absolute left-1 top-1 bg-[color:var(--color-ink)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[color:var(--color-on-ink)]">
          {kindLabel}
        </span>
      </span>
      <p lang="en" className="mt-2.5 line-clamp-2 font-serif text-[15px] leading-tight text-text">
        {product.name}
      </p>
      <p className="mt-1 font-mono text-[10px] uppercase leading-snug tracking-wide text-muted">
        <span className="tabular-nums">#{cell.number}</span>
        <span aria-hidden> · </span>
        <span className="text-text">{kindLabel}</span>
        <span aria-hidden> · </span>
        <span className="text-text">{finishLabel}</span>
      </p>

      {isQuoter ? (
        // COTIZADOR (§4.29): estimado de buylist PROPIO del producto + botón Agregar / error por-línea.
        <>
          <p className="mt-2 font-mono tabular-nums text-[15px] text-text">
            {quoteError ? (
              <span className="text-accent">{t('separateProductError')}</span>
            ) : pending ? (
              <span className="text-accent">{t('quoterPending')}</span>
            ) : (
              quotedPrice ?? <span className="text-accent">{t('quoterUnavailable')}</span>
            )}
          </p>
          {/* Error legible del contrato (productId inexistente / no cuelga del cardId) — no rompe el lote. */}
          {quoteError && (
            <p role="alert" className="mt-1 font-mono text-[10px] leading-snug text-accent">
              {t(`separateProductErrorCode.${quoteError}`)}
            </p>
          )}
          <div className="mt-auto pt-2.5">
            <Button
              variant="secondary"
              size="sm"
              className="w-full"
              // Money-safe: sin cotización OK no se puede agregar como línea pagable (nunca $0). Una
              // línea en precio_pendiente SÍ es agregable (el backend fija su monto al recibir).
              disabled={!quoteOk || !onAdd}
              onClick={() => {
                if (!quoteOk || !onAdd) return;
                onAdd({
                  rarity: quoteOk.rarity ?? '',
                  finish: quoteOk.finish,
                  productId: quoteOk.productId ?? product.productId,
                  appliedRule: quoteOk.appliedRule,
                  quote: quoteOk.quote,
                  referencePrice: quoteOk.referencePrice,
                  paymentNotice: 'PAY_AFTER_RECEIPT',
                });
              }}
              aria-label={t('separateProductAddAria', {
                name: product.name,
                kind: kindLabel,
                finish: finishLabel,
                price: quotedPrice ?? t('quoterPending'),
              })}
            >
              {t('quoterAdd')}
            </Button>
          </div>
        </>
      ) : (
        // INVENTARIO/BÓVEDA: presentación del precio de MERCADO propio (money-safe: "—" sin precio).
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
    </div>
  );
}
