'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { batchQuote, BUYLIST_QUOTE_BATCH_MAX, listBuylistSets, searchBuylistCards } from '@/lib/api';
import type {
  ProductType,
  CardDTO,
  CardProductDTO,
  RawCondition,
  Finish,
  BuylistQuoteResponse,
  BuylistQuoteItemDTO,
  BuylistBatchQuoteResultDTO,
  MasterSetCardCellDTO,
  MasterSetVariantDTO,
  PublicBountyDTO,
} from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { CardImage } from '@/components/ui/CardImage';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { SafeShippingGuide } from '@/components/domain/SafeShippingGuide';
import { BuylistKycForm } from '@/components/domain/BuylistKycForm';
import { useSellRequirements } from '@/hooks/useSellRequirements';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { RarityLabel } from '@/components/domain/RarityLabel';
import { CardDetailModal, type CardDetailModalCard } from '@/components/domain/CardDetailModal';
import { EmptyState } from '@/components/ui/EmptyState';
import { QueryState } from '@/components/ui/QueryState';
import { CardSkeleton } from '@/components/ui/Skeleton';
import { FINISH_ORDER } from '@/lib/finish';
import { cn } from '@/lib/cn';
// v1.21-cotizador-master-set: en `raw` el grid es el binder COMPARTIDO de Master Set
// (§4.20f, mode="quoter") — casillas de imagen por acabado real de la carta, nunca un chip
// de texto ni una casilla para un acabado que la carta no tiene. graded/sealed (sin variantes
// por acabado: cotizan siempre en `normal`) conservan el grid plano existente.
import { MasterSetPanel } from '@/components/master-set/MasterSetPanel';
// v1.28 (P-22): vitrina «Top Bounties» arriba de la página Vender, antes del selector de set.
import { TopBountiesShelf } from '@/components/domain/TopBountiesShelf';
// v1.29 Stream C (P-16, §18.4): el carrito deja de ser columna lateral — FAB + drawer flotante.
import { SellCartFab } from '@/components/domain/SellCartFab';
import { SellCartDrawer } from '@/components/domain/SellCartDrawer';
// v1.29 Stream C (P-14, §18.5): las líneas del resumen usan el FinishMark compartido.
import { FinishMark } from '@/components/domain/FinishMark';
// TL-C3 (FE-13): el estado del carrito, el contenido del drawer y "Mis solicitudes" viven
// en módulos propios (extracción mecánica, sin cambio de comportamiento).
import { useSellCart } from './useSellCart';
import { SellCartContents } from './SellCartContents';
// v1.51.4 (D43): el mínimo de compra del cotizador. Se pide AL MONTAR esta vista (el cotizador),
// no se guarda en un store de vida larga: el contrato lo norma por la caché pública de 5 minutos.
import { useQuotePolicy } from './useQuotePolicy';
import { MyRequestsSection } from './MyRequestsSection';
import { EditorialLink } from '../_shared/EditorialLink';

const PRODUCT_TYPES: ProductType[] = ['raw', 'graded', 'sealed'];

const QUOTE_STALE_MS = 5 * 60_000;

/** Primer acabado disponible de la carta (normal va primero por convención del catálogo). */
function firstAvailableFinish(card: CardDTO): Finish {
  return FINISH_ORDER.find((f) => card.availableFinishes.includes(f)) ?? 'normal';
}

/** Llave del índice de cotizaciones del grid: una entrada por (carta, acabado). */
const quoteMapKey = (cardId: string, finish: Finish) => `${cardId}:${finish}`;

/**
 * Convierte un resultado batch `ok:true` en el `BuylistQuoteResponse` que consume el carrito.
 * (En el batch `rarity` es `string | null`; el carrito lo normaliza a string.)
 */
function batchResultToQuote(r: Extract<BuylistBatchQuoteResultDTO, { ok: true }>): BuylistQuoteResponse {
  return {
    rarity: r.rarity ?? '',
    finish: r.finish,
    priceBasis: r.priceBasis,
    quote: r.quote,
    referencePrice: r.referencePrice,
    paymentNotice: r.paymentNotice,
  };
}

/**
 * Estimado de compra de UNA fila de acabado del grid (SEC-A1: el monto viene SIEMPRE del
 * server vía `POST /buylist/quote/batch`; la UI no calcula nada). Tolerante a errores
 * por-ítem: un acabado `ok:false` (NOT_FOUND / FINISH_NOT_AVAILABLE) muestra su error
 * sin afectar a las demás filas.
 */
function FinishEstimate({
  result,
  loading,
}: {
  result?: BuylistBatchQuoteResultDTO;
  loading: boolean;
}) {
  const t = useTranslations('buylist');
  const locale = useLocale() as AppLocale;
  if (loading) return <span className="text-muted">…</span>;
  if (!result) return null;
  if (!result.ok) return <span className="text-accent">{t('gridQuoteError')}</span>;
  if (result.quote.status === 'precio_pendiente') {
    return <span className="text-accent">{t('linePending')}</span>;
  }
  return (
    <span className="tabular text-text">
      {formatMoneyCents(result.quote.quotedPriceCents ?? 0, locale)}
    </span>
  );
}

/**
 * Rediseño "grid protagonista" (2026-08-17):
 * - El grid de resultados usa TODO el ancho/alto disponible (scroll natural de página,
 *   sin scroll interno artificial); los filtros (set + búsqueda + tipo) viven en una
 *   barra encima y el carrito de venta en un drawer flotante (P-16, §18.4).
 * - Ya NO hay panel "COTIZACIÓN" ni selección intermedia: cada carta lista sus ACABADOS
 *   (`availableFinishes`) con su estimado server-side, y el clic en un acabado la agrega
 *   DIRECTO al carrito. La transparencia vive en el detalle expandible de cada línea
 *   (valor de referencia / regla aplicada / acabado / pendiente).
 * - El bulk (multi-selección) se conserva: agrega las seleccionadas (acabado por defecto)
 *   reusando las cotizaciones ya cargadas del grid (cero requests extra).
 * - "Mis solicitudes" nunca muestra error sin sesión: sin sesión la sección invita a
 *   iniciar sesión en tono informativo (y no consulta el endpoint) — ver MyRequestsSection.
 *
 * TL-C3 (FE-13): esta vista quedó como ORQUESTADOR — el estado del carrito vive en
 * `useSellCart`, el contenido del drawer en `SellCartContents` y "Mis solicitudes" en
 * `MyRequestsSection` (misma carpeta de la ruta; extracción mecánica sin cambio de
 * comportamiento, respaldada por los tests conductuales de BuylistView.test.tsx).
 */
export function BuylistView() {
  const t = useTranslations('buylist');
  const tCommon = useTranslations('common');
  const tFinish = useTranslations('finish');
  const locale = useLocale() as AppLocale;
  const queryClient = useQueryClient();

  // --- Barra de filtros: búsqueda real sobre TODO el catálogo (contrato §6, v1.3) ---
  const [setId, setSetId] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [productType, setProductType] = useState<ProductType>('raw');

  const [guideOpen, setGuideOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);

  // --- Carrito de venta: varias cartas en UNA sola solicitud. P-16 (§18.4): vive en un
  // DRAWER flotante disparado por el FAB (cerrado por defecto; agregar desde la grilla NO
  // lo abre — solo el CTA de bounty, intención explícita de vender ESA carta). Al cerrar,
  // el foco regresa al FAB (returnFocusRef). Estado y totales: useSellCart (TL-C3). ---
  const {
    cart,
    expandedLines,
    addLine,
    addLines,
    setQuantity,
    removeLine,
    clearCart,
    toggleLineDetail,
    totalEstimatedCents,
    pendingCardCount,
    cartCount,
    isInCart,
    requestItems,
  } = useSellCart();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const fabRef = useRef<HTMLButtonElement>(null);
  const [lastAdded, setLastAdded] = useState<{ name: string; label: string } | null>(null);

  // P-42 · en DESKTOP (≥lg) el carrito es un PANEL FIJO a la par del grid (2 columnas persistentes),
  // no un drawer que abre/cierra: siempre se ve lo que metes y el total. En móvil se conserva el
  // sheet (FAB + drawer). Un solo render (JS-driven, no CSS duplicado) evita DOM/foco duplicado. En
  // jsdom `matchMedia` devuelve `matches:false` → los tests corren la variante MÓVIL por defecto.
  const isDesktopCart = useMediaQuery('(min-width: 1024px)');

  // P-43 · carta seleccionada para el pop-up de detalle del GRID PLANO (graded/sealed). El grid del
  // cotizador raw (binder Master Set) maneja su propio modal por teja (QuoterTile).
  const [detailCard, setDetailCard] = useState<
    { card: CardDetailModalCard; finish?: Finish; priceCents?: number | null; pending?: boolean } | null
  >(null);

  // P-42 · sombreado del grid raw (binder): la identidad del carrito es (cardId, 'raw', finish, productId).
  const isInCartRaw = useCallback(
    (cardId: string, finish: Finish, productId?: number) => isInCart(cardId, 'raw', finish, productId),
    [isInCart],
  );

  // --- Bulk: multi-selección en los resultados de búsqueda ---
  const [bulkSelected, setBulkSelected] = useState<Record<string, CardDTO>>({});
  const [bulkNotice, setBulkNotice] = useState<'added' | 'partial' | 'error' | null>(null);
  const [bulkAddedCount, setBulkAddedCount] = useState(0);
  const [bulkFailedCount, setBulkFailedCount] = useState(0);

  const sets = useQuery({ queryKey: ['buylist-sets'], queryFn: listBuylistSets });

  // Solo se busca cuando hay set o texto (evita traer todo el catálogo sin filtro).
  const hasSearch = setId !== '' || searchQuery.trim() !== '';
  const cardsResult = useQuery({
    queryKey: ['buylist-cards', setId, searchQuery],
    queryFn: () => searchBuylistCards({ setId: setId || undefined, q: searchQuery || undefined }),
    enabled: hasSearch,
  });

  /**
   * Ítems del batch del grid: en raw, UNA entrada por (carta × acabado disponible) — así
   * cada acabado del grid tiene su propio estimado; en graded/sealed una entrada por carta
   * (cotizan siempre en `normal`, contrato §I).
   */
  const gridBatchItems: BuylistQuoteItemDTO[] = useMemo(() => {
    const cards = cardsResult.data?.data ?? [];
    if (productType !== 'raw') {
      return cards.map((c) => ({ cardId: c.id, productType, finish: 'normal' as Finish }));
    }
    return cards.flatMap((c) =>
      FINISH_ORDER.filter((f) => c.availableFinishes.includes(f)).map((f) => ({
        cardId: c.id,
        productType: 'raw' as ProductType,
        rawCondition: 'NM' as RawCondition,
        finish: f,
      })),
    );
  }, [cardsResult.data, productType]);

  /**
   * Cotización del grid POR ACABADO en el mínimo de llamadas. Restricción no obvia:
   * `POST /buylist/quote/batch` acepta máx 50 ítems y tiene throttle 12/min, y una página
   * de 20 cartas × hasta 4 acabados puede llegar a 80 ítems → se TROCEA en llamadas de ≤50
   * (típico: 1 llamada; peor caso de página: 2) y react-query cachea 5 min por
   * (búsqueda × tipo), así que navegar de vuelta no re-consume el throttle.
   */
  const gridQuotes = useQuery({
    queryKey: [
      'buylist-quote-batch',
      productType,
      gridBatchItems.map((i) => `${i.cardId}:${i.finish}`).join('|'),
    ],
    queryFn: async () => {
      const chunks: BuylistQuoteItemDTO[][] = [];
      for (let i = 0; i < gridBatchItems.length; i += BUYLIST_QUOTE_BATCH_MAX) {
        chunks.push(gridBatchItems.slice(i, i + BUYLIST_QUOTE_BATCH_MAX));
      }
      const responses = await Promise.all(chunks.map((items) => batchQuote(items)));
      // `index` es 0-based DENTRO de cada chunk → se re-mapea al (cardId, finish) pedido.
      const byKey: Record<string, BuylistBatchQuoteResultDTO> = {};
      responses.forEach((res, ci) => {
        for (const r of res.results) {
          const requested = chunks[ci][r.index];
          if (requested) byKey[quoteMapKey(requested.cardId, requested.finish ?? 'normal')] = r;
        }
      });
      return byKey;
    },
    enabled: gridBatchItems.length > 0,
    staleTime: QUOTE_STALE_MS,
  });

  const quoteFor = (cardId: string, finish: Finish): BuylistBatchQuoteResultDTO | undefined =>
    gridQuotes.data?.[quoteMapKey(cardId, finish)];

  function runSearch() {
    setSearchQuery(searchInput.trim());
  }

  /** Acabados a listar por carta: en raw, todos los disponibles; en graded/sealed, normal. */
  function tileFinishes(card: CardDTO): Finish[] {
    if (productType !== 'raw') return ['normal'];
    const rows = FINISH_ORDER.filter((f) => card.availableFinishes.includes(f));
    return rows.length > 0 ? rows : ['normal'];
  }

  /** Etiqueta de la fila: el acabado en raw; el tipo de producto en graded/sealed. */
  function rowLabel(finish: Finish): string {
    return productType === 'raw' ? tFinish(finish) : t(`productType.${productType}`);
  }

  /**
   * Clic en un acabado del grid → agrega DIRECTO al carrito con el estimado que ya
   * cotizó el batch (una sola cotización; sin panel intermedio). El acabado autoritativo
   * es el que ecoa el server en el resultado.
   */
  function addFromGrid(card: CardDTO, finish: Finish) {
    const result = quoteFor(card.id, finish);
    if (!result?.ok) return;
    addLine({
      card,
      productType,
      rawCondition: productType === 'raw' ? 'NM' : undefined,
      finish: result.finish,
      quote: batchResultToQuote(result),
    });
    setLastAdded({ name: card.name, label: rowLabel(finish) });
    setBulkNotice(null);
  }

  /**
   * Clic en una casilla del binder Master Set (mode="quoter", raw): la variante YA trae su
   * cotización resuelta (`variant.quote`, batch client-side de MasterSetBinder) — se agrega
   * DIRECTO al carrito, mismo patrón que `addFromGrid`. Casillas sin cotización resuelta
   * quedan deshabilitadas en el binder (nunca deberían disparar este handler).
   * SC-D3: `useCallback` (los handlers del hook ya son estables) para no regalarle al binder
   * una identidad nueva por render — prepara el `memo` de tiles si algún día hace falta.
   */
  const addFromMasterSet = useCallback(
    (cell: MasterSetCardCellDTO, variant: MasterSetVariantDTO) => {
      if (!variant.quote) return;
      const quote: BuylistQuoteResponse = {
        rarity: variant.quote.rarity ?? '',
        finish: variant.finish,
        priceBasis: variant.quote.priceBasis,
        quote: { status: variant.quote.status, quotedPriceCents: variant.quote.quotedPriceCents, currency: 'MXN' },
        referencePrice: variant.quote.referencePrice,
        paymentNotice: 'PAY_AFTER_RECEIPT',
      };
      addLine({
        card: { id: cell.cardId, name: cell.name, number: cell.number, imageSmallUrl: cell.imageSmallUrl },
        productType: 'raw',
        rawCondition: 'NM',
        finish: variant.finish,
        quote,
      });
      setLastAdded({ name: cell.name, label: tFinish(variant.finish) });
      setBulkNotice(null);
    },
    [addLine, tFinish],
  );

  /**
   * v1.30 (§4.29) · Clic en «Agregar» de un PRODUCTO SEPARADO (deck_exclusive/promo) del binder:
   * lo agrega al carrito como LÍNEA PROPIA por su `productId` (precio propio, cotizado server-side).
   * Dos líneas con el mismo (cardId, finish) y distinto productId son DISTINTAS (dedup por productId
   * en useSellCart). El nombre de la línea es el del PRODUCTO (p. ej. «Charizard (Deck Exclusive)»).
   */
  const addFromMasterSetProduct = useCallback(
    (cell: MasterSetCardCellDTO, product: CardProductDTO, finish: Finish, quote: BuylistQuoteResponse) => {
      addLine({
        card: { id: cell.cardId, name: product.name, number: cell.number, imageSmallUrl: cell.imageSmallUrl },
        productType: 'raw',
        rawCondition: 'NM',
        finish,
        productId: quote.productId ?? product.productId,
        quote,
      });
      setLastAdded({ name: product.name, label: tFinish(finish) });
      setBulkNotice(null);
    },
    [addLine, tFinish],
  );

  /**
   * v1.28 (P-22) · CTA «Cotizar esta carta» de un BountyCard: cotiza ESA (carta, acabado)
   * server-side (SEC-A1 — el monto autoritativo lo deriva el quote, no el card de la vitrina)
   * y la agrega al carrito de venta con el cotizador en `raw` y el carrito abierto. Si el
   * quote falla, no agrega nada (el flujo normal del cotizador sigue disponible).
   */
  const bountyQuote = useMutation({
    mutationFn: async (b: PublicBountyDTO) => {
      const res = await batchQuote([
        { cardId: b.cardId, productType: 'raw', rawCondition: 'NM', finish: b.finish },
      ]);
      return { bounty: b, result: res.results[0] };
    },
    onSuccess: ({ bounty, result }) => {
      if (!result?.ok) return;
      setProductType('raw');
      addLine({
        card: {
          id: bounty.cardId,
          name: bounty.name,
          number: bounty.number,
          imageSmallUrl: bounty.imageSmallUrl,
        },
        productType: 'raw',
        rawCondition: 'NM',
        finish: result.finish,
        quote: batchResultToQuote(result),
      });
      // Excepción de §18.4a: el CTA de bounty SÍ abre el drawer (intención explícita).
      setDrawerOpen(true);
      setLastAdded({ name: bounty.name, label: tFinish(bounty.finish) });
      setBulkNotice(null);
    },
  });

  function toggleBulk(card: CardDTO) {
    setBulkNotice(null);
    setBulkSelected((prev) => {
      const next = { ...prev };
      if (next[card.id]) delete next[card.id];
      else next[card.id] = card;
      return next;
    });
  }

  /**
   * Bulk: agrega TODAS las seleccionadas de golpe (acabado por defecto) REUSANDO las
   * cotizaciones ya cargadas del grid — cero requests extra (el batch del grid ya cotizó
   * cada acabado). Tolerante por-ítem: las `ok:false` se cuentan aparte sin bloquear.
   */
  function addSelectedToCart() {
    const cards = Object.values(bulkSelected);
    const quotes = gridQuotes.data;
    if (cards.length === 0 || !quotes) return;
    const okEntries: { card: CardDTO; result: Extract<BuylistBatchQuoteResultDTO, { ok: true }> }[] = [];
    let failed = 0;
    for (const card of cards) {
      const defaultFinish = productType === 'raw' ? firstAvailableFinish(card) : 'normal';
      const r = quotes[quoteMapKey(card.id, defaultFinish)];
      if (r?.ok) okEntries.push({ card, result: r });
      else failed += 1;
    }
    addLines(
      okEntries.map(({ card, result }) => ({
        card,
        productType,
        rawCondition: productType === 'raw' ? ('NM' as RawCondition) : undefined,
        finish: result.finish,
        quote: batchResultToQuote(result),
      })),
    );
    setBulkAddedCount(okEntries.length);
    setBulkFailedCount(failed);
    setBulkNotice(failed === 0 ? 'added' : okEntries.length > 0 ? 'partial' : 'error');
    setBulkSelected({});
    setLastAdded(null);
  }

  const bulkCount = Object.keys(bulkSelected).length;

  // Gating de cuenta ANTES de llenar todo (guards del contrato §6): sesión, correo
  // verificado, CLABE registrada e INE esperado por topes. El bloqueo real es server-side;
  // aquí solo se comunica temprano para que el 403 no sea la primera noticia.
  const sellReq = useSellRequirements(totalEstimatedCents);
  // `minimumRequestCents` queda undefined mientras carga Y si la llamada falla: la degradación es
  // fail-OPEN (sin faltante y con el CTA vivo), porque la puerta real es el 422 del servidor.
  const { minimumRequestCents } = useQuotePolicy();

  return (
    <div className="grid lg:grid-cols-[40px_1fr]">
      {/* Etiqueta vertical al margen: marca la sección sin recurrir a un color de fondo.
          Decorativa (aria-hidden); el uppercase lo pone la clase, no el string (§20.15). */}
      <div className="hidden justify-center border-r border-border py-9 lg:flex">
        <span aria-hidden className="vertical-label text-xs uppercase text-muted">
          {t('verticalLabel')}
        </span>
      </div>

      <div className="min-w-0">
        <div className="gutter border-b border-border pb-7 pt-10 lg:pt-[46px]">
          <h1 className="font-serif text-[30px] leading-[1.1] text-text lg:text-[40px]">{t('title')}</h1>
          <p className="mt-3 max-w-[560px] text-[15px] leading-[1.65] text-muted">{t('subtitle')}</p>
          {/* PAY_AFTER_RECEIPT (PROJECT AC 33, DESIGN §7.5), visible desde el inicio. */}
          <p className="rule-note mt-5 max-w-[640px] text-[13px] leading-[1.7] text-muted">
            {t('payAfterReceipt')}
          </p>
          {/* R3: link editorial canónico (§20.0) — era la variante divergida a mano. */}
          <EditorialLink onClick={() => setGuideOpen(true)} className="mt-5">
            {t('shippingGuideLink')}
          </EditorialLink>
        </div>

        {/* v1.28 (P-22): Top Bounties ARRIBA, antes del selector de set. Se oculta sola si
            no hay bounties activos o el endpoint falla (vitrina, no bloquea la venta). */}
        <TopBountiesShelf onQuote={(b) => bountyQuote.mutate(b)} />

        {/* Barra de filtros ADELGAZADA (P-16, §18.1.3): el toggle textual del carrito
            desaparece (lo sustituye el FAB §18.4). En `raw` el binder Master Set
            (mode="quoter") trae SU PROPIO "Buscar set" (índice) y "Buscar carta" (dentro
            del set elegido) — ver MasterSetIndex/MasterSetBinder; este filtro plano de
            set+texto queda para graded/sealed (sin variantes por acabado, fuera del modelo
            de casillas de Master Set). */}
        <div className="gutter flex flex-wrap items-end gap-x-8 gap-y-6 border-b border-border pb-7 pt-6">
          {productType !== 'raw' && (
            <>
              <div className="w-full sm:w-64">
                <Select
                  label={t('filterBySet')}
                  placeholder={t('allSets')}
                  options={(sets.data ?? []).map((s) => ({
                    value: s.id,
                    label: s.year ? `${s.name} (${s.year})` : s.name,
                  }))}
                  value={setId}
                  onChange={(e) => {
                    setSetId(e.target.value);
                    // Filtrar por set dispara la búsqueda aunque no haya texto.
                  }}
                />
              </div>
              <div className="flex min-w-[240px] flex-1 items-end gap-4">
                <div className="min-w-0 flex-1">
                  <Input
                    label={t('searchCards')}
                    placeholder={t('searchPlaceholder')}
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') runSearch();
                    }}
                  />
                </div>
                <button
                  type="button"
                  onClick={runSearch}
                  className="shrink-0 pb-3 text-xs font-medium text-accent hover:text-text"
                >
                  {t('searchAction')}
                </button>
              </div>
            </>
          )}
          <div className="w-full sm:w-44">
            <Select
              label={t('selectType')}
              options={PRODUCT_TYPES.map((p) => ({ value: p, label: t(`productType.${p}`) }))}
              value={productType}
              onChange={(e) => {
                setProductType(e.target.value as ProductType);
                setBulkNotice(null);
                setLastAdded(null);
              }}
            />
          </div>
        </div>

        {/* P-42 · en DESKTOP el grid y el carrito conviven en 2 columnas persistentes (el carrito
            fijo a la derecha, a la par del grid); en móvil el grid ocupa todo el ancho y el carrito
            vive en el sheet (FAB + drawer, abajo).
            H1 (anti-flash): la ESTRUCTURA de 2 columnas se declara por CSS (`lg:grid` = ≥1024px, el
            MISMO umbral que `isDesktopCart`), NO por JS. Así el track de 360px queda RESERVADO desde
            el first-paint en desktop y la columna del grid (main) nace con su ancho final — se elimina
            el layout shift de main (antes: móvil full-width → salto a 2 columnas tras hidratar).
            Trade-off (documentado en FRONTEND_NOTES): el CONTENIDO del carrito (`<aside>`) sigue siendo
            un ÚNICO render JS-driven (`isDesktopCart`) para no duplicar estado/foco ni el focus-trap;
            por eso, en desktop, el aside aparece al hidratar DENTRO de la columna ya reservada (rellena
            hueco, sin reflujo de main). El FAB móvil es `fixed` (fuera del flujo del grid), así que su
            breve aparición pre-hidratación tampoco desplaza el layout. */}
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        {/* P-16 (§18.1.4): la grilla es la única columna, a TODO el ancho. `pb-24` para que
            el FAB fijo nunca tape la última fila de tejas. */}
        <main className="gutter min-w-0 pb-24 pt-8">
            {lastAdded && (
              <p role="status" className="mb-3 font-mono text-[11px] text-success">
                {t('addedLine', { name: lastAdded.name, finish: lastAdded.label })}
              </p>
            )}
            {productType === 'raw' ? (
              // v1.21: binder COMPARTIDO de Master Set — casillas de imagen por acabado real
              // de la carta (nunca chip de texto/casilla vacía), con "Cargar más" propio para
              // sets >20 cartas (fetchQuoterBinder en MasterSetBinder.tsx pagina internamente).
              <MasterSetPanel
                mode="quoter"
                onAddToSellCart={addFromMasterSet}
                onAddProductToSellCart={addFromMasterSetProduct}
                isInCart={isInCartRaw}
              />
            ) : !hasSearch ? (
              <EmptyState title={t('searchHint')} />
            ) : (
              <>
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <p className="eyebrow">{t('searchResults')}</p>
                  <p className="font-mono text-[11px] text-muted">{t('gridEstimateLegend')}</p>
                </div>

                {/* Barra de bulk: agrega todas las seleccionadas en un clic (acabado por
                    defecto), reusando las cotizaciones del grid. */}
                {bulkCount > 0 && (
                  <div className="mt-4 flex flex-wrap items-center gap-5">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={gridQuotes.isLoading}
                      onClick={addSelectedToCart}
                    >
                      {t('bulkAddCta', { count: bulkCount })}
                    </Button>
                    <button
                      type="button"
                      onClick={() => setBulkSelected({})}
                      className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted hover:text-accent"
                    >
                      {t('bulkClear')}
                    </button>
                  </div>
                )}
                {bulkNotice === 'added' && (
                  <p role="status" className="mt-3 font-mono text-[11px] text-success">
                    {t('bulkAdded', { count: bulkAddedCount })}
                  </p>
                )}
                {bulkNotice === 'partial' && (
                  /* Tolerante por-ítem: algunas entraron, otras no (errores por-ítem del batch). */
                  <p role="status" className="mt-3 font-mono text-[11px] text-accent">
                    {t('bulkAddedPartial', { added: bulkAddedCount, failed: bulkFailedCount })}
                  </p>
                )}
                {bulkNotice === 'error' && (
                  <p role="alert" className="mt-3 font-mono text-[11px] text-accent">
                    {t('bulkAddError')}
                  </p>
                )}

                {/* Falla del batch de estimados: aviso con reintento, sin tumbar el grid. */}
                {gridQuotes.isError && (
                  <p role="alert" className="mt-3 font-mono text-[11px] text-accent">
                    {t('gridQuotesFailed')}{' '}
                    <button
                      type="button"
                      onClick={() => gridQuotes.refetch()}
                      className="underline hover:text-text"
                    >
                      {tCommon('retry')}
                    </button>
                  </p>
                )}

                <div className="mt-6">
                  <QueryState
                    isLoading={cardsResult.isLoading}
                    isError={cardsResult.isError}
                    error={cardsResult.error}
                    onRetry={() => cardsResult.refetch()}
                    /* §18.6: skeletons con la MISMA retícula final; sin spinner de página. */
                    loading={
                      <div className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                        {Array.from({ length: 10 }, (_, i) => (
                          <CardSkeleton key={i} />
                        ))}
                      </div>
                    }
                  >
                    {cardsResult.data &&
                      (cardsResult.data.data.length === 0 ? (
                        <EmptyState title={t('noResults')} />
                      ) : (
                        <ul
                          aria-label={t('searchResults')}
                          /* §18.2: el grid plano de graded/sealed se ALINEA a la escala del
                             binder M1 (2→3→4→5); se retira el 2xl:6 y md:4/xl:5 pasa a
                             lg:4/xl:5 — la teja grande ES el objetivo, no meter columnas. */
                          className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
                        >
                          {cardsResult.data.data.map((card) => {
                            const finishes = tileFinishes(card);
                            // P-42: la teja se destaca si CUALQUIER acabado de esta carta ya está en el carro.
                            const anyInCart = finishes.some((f) => isInCart(card.id, productType, f));
                            // P-43: al clicar el arte, el detalle muestra el acabado/precio SOLO cuando la
                            // carta tiene un único acabado (graded/sealed cotizan siempre en `normal`); con
                            // varios acabados el detalle queda a nivel carta (los precios ya están en las filas).
                            const soleFinish = finishes.length === 1 ? finishes[0] : undefined;
                            const soleResult = soleFinish ? quoteFor(card.id, soleFinish) : undefined;
                            return (
                            <li
                              key={card.id}
                              data-in-cart={anyInCart ? 'true' : undefined}
                              className={cn(
                                'relative min-w-0',
                                anyInCart && 'bg-surface-2 shadow-[inset_0_0_0_1px_var(--color-border-strong)]',
                              )}
                            >
                              {/* Multi-selección (bulk): checkbox FUERA de las filas de acabado. */}
                              <input
                                type="checkbox"
                                aria-label={t('bulkSelect', { name: card.name })}
                                checked={!!bulkSelected[card.id]}
                                onChange={() => toggleBulk(card)}
                                className="absolute left-1.5 top-1.5 z-10 h-4 w-4 accent-accent focus-visible:shadow-focus"
                              />
                              {/* P-43: el arte abre el pop-up de detalle (imagen grande + datos);
                                  AGREGAR sigue siendo su propia acción (las filas de abajo). */}
                              <button
                                type="button"
                                onClick={() =>
                                  setDetailCard({
                                    card: {
                                      name: card.name,
                                      setName: card.setName,
                                      number: card.number,
                                      rarity: card.rarity,
                                      productType,
                                      imageLargeUrl: card.imageLargeUrl,
                                      imageSmallUrl: card.imageSmallUrl,
                                    },
                                    finish: soleFinish,
                                    priceCents:
                                      soleResult?.ok && soleResult.quote.status !== 'precio_pendiente'
                                        ? soleResult.quote.quotedPriceCents
                                        : undefined,
                                    pending: soleResult?.ok
                                      ? soleResult.quote.status === 'precio_pendiente'
                                      : undefined,
                                  })
                                }
                                aria-label={t('viewDetailAria', { name: card.name })}
                                className="block w-full focus-visible:shadow-focus focus-visible:outline-none"
                              >
                                <CardImage src={card.imageSmallUrl} alt={card.name} className="p-1.5" />
                              </button>
                              <p lang="en" className="mt-2.5 truncate text-[13px] text-text">
                                {card.name}
                              </p>
                              <p lang="en" className="mt-1 truncate font-mono text-[10px] text-muted">
                                {card.setName}
                                {card.number && ` · #${card.number}`}
                              </p>
                              {/* P-44: rareza junto al acabado (se omite sola en sellado o sin rareza). */}
                              <RarityLabel rarity={card.rarity} productType={productType} className="mt-1 block" />
                              {anyInCart && (
                                <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.06em] text-success">
                                  {t('tileInCart')}
                                </p>
                              )}
                              {/* Una fila por acabado disponible: estimado propio y agregable
                                  por separado (clic = directo al carrito). */}
                              <ul className="mt-2.5">
                                {finishes.map((finish) => {
                                  const result = quoteFor(card.id, finish);
                                  const finishInCart = isInCart(card.id, productType, finish);
                                  return (
                                    <li key={finish}>
                                      <button
                                        type="button"
                                        disabled={!result?.ok}
                                        onClick={() => addFromGrid(card, finish)}
                                        aria-label={t('addFinishAria', {
                                          name: card.name,
                                          finish: rowLabel(finish),
                                        })}
                                        className={cn(
                                          'group flex w-full items-center justify-between gap-2 border-b border-border py-2 text-left disabled:cursor-not-allowed',
                                          finishInCart && 'bg-surface-2',
                                        )}
                                      >
                                        <span className="truncate font-mono text-[10px] uppercase tracking-[0.06em] text-muted group-hover:text-text">
                                          {rowLabel(finish)}
                                        </span>
                                        <span className="flex shrink-0 items-center gap-2 font-mono text-[11px]">
                                          <FinishEstimate result={result} loading={gridQuotes.isLoading} />
                                          <span
                                            aria-hidden
                                            className={cn('text-accent', !result?.ok && 'opacity-40')}
                                          >
                                            {finishInCart ? '✓' : '+'}
                                          </span>
                                        </span>
                                      </button>
                                    </li>
                                  );
                                })}
                              </ul>
                            </li>
                            );
                          })}
                        </ul>
                      ))}
                  </QueryState>
                </div>
              </>
            )}
        </main>

        {/* P-42 · DESKTOP: carrito de venta como PANEL FIJO a la derecha, pegajoso, a la par del
            grid (siempre visible: lo que metes y el total). Reusa EXACTAMENTE el mismo
            SellCartContents que el drawer móvil. */}
        {isDesktopCart && (
          <aside
            aria-label={t('cartDrawer.ariaLabel', { count: cartCount })}
            className="sticky top-4 max-h-[calc(100vh-2rem)] self-start overflow-y-auto border-l border-border px-5 pb-8"
          >
            <div className="flex items-baseline gap-3 border-b border-border py-3">
              <h2 className="eyebrow">{t('cartTitle')}</h2>
              {cartCount > 0 && <span className="eyebrow">{t('cartCount', { count: cartCount })}</span>}
            </div>
            <div className="pt-4">
              <SellCartContents
                cart={cart}
                sellReq={sellReq}
                expandedLines={expandedLines}
                totalEstimatedCents={totalEstimatedCents}
                pendingCardCount={pendingCardCount}
                cartCount={cartCount}
                minimumRequestCents={minimumRequestCents}
                onSetQuantity={setQuantity}
                onRemoveLine={removeLine}
                onToggleLineDetail={toggleLineDetail}
                onClearCart={clearCart}
                onSubmit={() => {
                  setCreatedId(null);
                  setRequestOpen(true);
                }}
              />
            </div>
          </aside>
        )}
        </div>

        {/* Carrito de venta = DRAWER flotante (P-16, §18.4b): el contenido (requisitos →
            líneas → total → CTA → vaciar) vive en SellCartContents (TL-C3). El encabezado
            (eyebrow + conteo + cerrar) lo pinta el propio drawer. En DESKTOP el carrito es el
            panel fijo de arriba, así que el drawer (y su FAB) SOLO se montan en móvil. */}
        {!isDesktopCart && (
        <SellCartDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          ariaLabel={t('cartDrawer.ariaLabel', { count: cartCount })}
          title={t('cartTitle')}
          countLabel={cartCount > 0 ? t('cartCount', { count: cartCount }) : null}
          closeLabel={t('cartDrawer.close')}
          returnFocusRef={fabRef}
        >
          <SellCartContents
            cart={cart}
            sellReq={sellReq}
            expandedLines={expandedLines}
            totalEstimatedCents={totalEstimatedCents}
            pendingCardCount={pendingCardCount}
            cartCount={cartCount}
            minimumRequestCents={minimumRequestCents}
            onSetQuantity={setQuantity}
            onRemoveLine={removeLine}
            onToggleLineDetail={toggleLineDetail}
            onClearCart={clearCart}
            onSubmit={() => {
              setCreatedId(null);
              // Un solo focus trap activo (§18.4b): abrir el modal de solicitud
              // cierra el drawer (el resumen del modal repite las líneas).
              setDrawerOpen(false);
              setRequestOpen(true);
            }}
          />
        </SellCartDrawer>
        )}

        {/* Política NM-only (PROJECT §E/H, AC 3d) + copy de confianza (EDITABLE): quién paga
            el envío, tiempos de verificación/pago SPEI y vigencia (ver FRONTEND_NOTES). */}
        <section className="gutter border-t border-border pb-10 pt-8">
          <p className="rule-note max-w-[640px] text-[13px] leading-[1.7] text-muted">
            <span className="font-medium text-text">{t('nmOnlyTitle')}.</span> {t('nmOnlyBody')}
          </p>
          <div className="mt-6 max-w-[640px] text-[13px] leading-[1.7] text-muted">
            <p>{t('trustShipping')}</p>
            <p className="mt-2">{t('trustPayment')}</p>
            <p className="mt-2">{t('trustValidity')}</p>
          </div>

          {/* Makeover 1a (artboard 2b): la guía de envío seguro también vive INLINE al pie
              de la página (retícula 01–04 a cuatro columnas), además del modal del hero. */}
          <div className="mt-8">
            <h2 className="eyebrow">{t('shippingGuideLink')}</h2>
            <SafeShippingGuide columns={4} className="mt-4" />
          </div>
        </section>

        {createdId && (
          <p className="gutter rule-note py-5 text-sm text-text" role="status">
            {t('created')}
          </p>
        )}

        {/* Mis solicitudes (extraída en TL-C3): sin sesión NUNCA muestra error — invita a
            iniciar sesión en tono informativo (y no consulta el endpoint). */}
        <MyRequestsSection ready={sellReq.ready} isAuthenticated={sellReq.isAuthenticated} />

        {/* FAB del carrito (§18.4a): fijo abajo-derecha, en el flujo de tabulación DESPUÉS
            del contenido principal (§18.8, sin tabindex positivos). Siempre presente (vacío
            da acceso a los requisitos de venta); el badge se omite con carrito vacío. P-42: en
            DESKTOP el carrito es el panel fijo lateral, así que el FAB SOLO se monta en móvil. */}
        {!isDesktopCart && (
          <SellCartFab ref={fabRef} count={cartCount} open={drawerOpen} onClick={() => setDrawerOpen(true)} />
        )}
      </div>

      <Modal open={guideOpen} onClose={() => setGuideOpen(false)} title={t('shippingGuideLink')}>
        <SafeShippingGuide onUnderstood={() => setGuideOpen(false)} />
      </Modal>

      {/* P-43 · pop-up de detalle del GRID PLANO (graded/sealed): imagen grande + datos. Cierra
          por backdrop/Esc (Modal §7.6). El grid raw (binder) tiene su propio modal por teja. */}
      <CardDetailModal
        open={detailCard != null}
        onClose={() => setDetailCard(null)}
        card={detailCard?.card ?? null}
        finish={detailCard?.finish}
        priceCents={detailCard?.priceCents}
        pricePending={detailCard?.pending}
      />

      <Modal open={requestOpen} onClose={() => setRequestOpen(false)} title={t('requestTitle')}>
        {requestItems.length > 0 && (
          <>
            {/* Resumen de la venta ANTES de confirmar: qué cartas, cuánto (estimado) y
                la vigencia del estimado. Evita enviar "a ciegas" desde el modal. */}
            <div className="mb-6">
              <p className="eyebrow">{t('summaryTitle')}</p>
              <ul className="mt-3">
                {cart.map((l) => {
                  const pending = l.quote.quote.status === 'precio_pendiente';
                  const unitCents = l.quote.quote.quotedPriceCents ?? 0;
                  return (
                    <li
                      key={l.id}
                      className="flex items-baseline justify-between gap-3 border-b border-border py-2 text-sm"
                    >
                      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-text">
                        <span lang="en" className="min-w-0 truncate">
                          {l.card.name}
                        </span>
                        <span className="font-mono text-[10px] text-muted">
                          ×{l.quantity}
                        </span>
                        {/* P-14 (§18.5): mismo FinishMark que en el carrito — la decisión de
                            venta se confirma viendo la variante con el mismo lenguaje. */}
                        <FinishMark finish={l.finish} className="translate-y-[1px]" />
                      </span>
                      <span className="tabular shrink-0">
                        {pending ? (
                          <span className="font-mono text-[11px] text-accent">{t('linePending')}</span>
                        ) : (
                          formatMoneyCents(unitCents * l.quantity, locale)
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <div className="flex items-baseline justify-between gap-3 pt-3">
                <span className="text-[13px] font-medium text-text">{t('quote.money.cardsValue')}</span>
                {totalEstimatedCents === 0 && pendingCardCount > 0 ? (
                  <span className="font-mono text-[13px] text-accent">{t('linePending')}</span>
                ) : (
                  <span className="tabular text-[18px] font-medium text-text">
                    {formatMoneyCents(totalEstimatedCents, locale)}
                  </span>
                )}
              </div>
              {pendingCardCount > 0 && (
                <p className="mt-2 font-mono text-[11px] leading-[1.6] text-muted">
                  {t('totalPendingNote', { count: pendingCardCount })}
                </p>
              )}
              {/* Vigencia del estimado (copy editable de confianza). */}
              <p className="mt-3 font-mono text-[11px] leading-[1.6] text-muted">{t('trustValidity')}</p>
            </div>

            <BuylistKycForm
              items={requestItems}
              // El mismo mínimo del cotizador: el paso de crear no vuelve a pedirlo (una sola
              // llamada por montaje) y el `422` del servidor manda sobre él si difieren.
              minimumRequestCents={minimumRequestCents}
              totalEstimatedCents={totalEstimatedCents}
              // Heads-up de topes/CLABE derivado de GET /users/me/kyc; el backend re-decide (SEC-A1).
              ineExpected={sellReq.ineExpected}
              clabeMasked={sellReq.clabeMasked}
              // v1.15: atajo "usar mi CLABE" (omite `clabe`) e INE en archivo (oculta uploaders).
              clabeOnFile={sellReq.clabeOnFile}
              ineOnFile={sellReq.ineOnFile}
              onCreated={(sellRequestId) => {
                setCreatedId(sellRequestId);
                setRequestOpen(false);
                clearCart();
                setLastAdded(null);
                void queryClient.invalidateQueries({ queryKey: ['sell-requests'] });
                // La solicitud pudo registrar la CLABE en KYC → refresca el checklist.
                void queryClient.invalidateQueries({ queryKey: ['kyc'] });
              }}
            />
          </>
        )}
      </Modal>
    </div>
  );
}
