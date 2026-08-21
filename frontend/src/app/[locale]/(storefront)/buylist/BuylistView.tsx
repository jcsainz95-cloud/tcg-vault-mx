'use client';

import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import {
  batchQuote,
  BUYLIST_QUOTE_BATCH_MAX,
  getSellRequests,
  listBuylistSets,
  respondSellRequest,
  searchBuylistCards,
} from '@/lib/api';
import type {
  ProductType,
  CardDTO,
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
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PipelineStepper } from '@/components/ui/PipelineStepper';
import { SafeShippingGuide } from '@/components/domain/SafeShippingGuide';
import { BuylistKycForm, type BuylistRequestItem } from '@/components/domain/BuylistKycForm';
import { SellRequirementsPanel } from '@/components/domain/SellRequirementsPanel';
import { useSellRequirements } from '@/hooks/useSellRequirements';
import { Link } from '@/i18n/navigation';
import { EmptyState } from '@/components/ui/EmptyState';
import { QueryState } from '@/components/ui/QueryState';
import { CardSkeleton } from '@/components/ui/Skeleton';
import { useBuylistSteps } from '@/lib/pipelines';
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
// v1.29 Stream C (P-14, §18.5): las líneas del carrito y del resumen usan el FinishMark compartido.
import { FinishMark } from '@/components/domain/FinishMark';

const PRODUCT_TYPES: ProductType[] = ['raw', 'graded', 'sealed'];

const QUOTE_STALE_MS = 5 * 60_000;

/** Primer acabado disponible de la carta (normal va primero por convención del catálogo). */
function firstAvailableFinish(card: CardDTO): Finish {
  return FINISH_ORDER.find((f) => card.availableFinishes.includes(f)) ?? 'normal';
}

/** Llave del índice de cotizaciones del grid: una entrada por (carta, acabado). */
const quoteMapKey = (cardId: string, finish: Finish) => `${cardId}:${finish}`;

/**
 * Referencia mínima de carta que necesita el carrito (nombre + id para el submit). `raw`
 * la puebla desde `MasterSetCardCellDTO` (binder de Master Set, sin los campos de catálogo
 * que no usa el carrito: setName/rarity/subtypes/…); graded/sealed siguen viniendo del
 * `CardDTO` completo del picker plano — un `CardDTO` cumple esta forma sin cambios.
 */
interface QuoterCardRef {
  id: string;
  name: string;
  number: string;
  imageSmallUrl?: string;
}

/**
 * Una línea del carrito de venta. Snapshotea el ESTIMADO de la cotización
 * (`quote`) que se le muestra al usuario; el monto autoritativo lo re-deriva el
 * backend al crear la solicitud (SEC-A1). `quantity` se expande a N entradas de
 * `items` al enviar (el modelo es 1 item por carta física).
 *
 * v1.6-finish: la IDENTIDAD de línea es (cardId + productType + finish): la MISMA
 * carta en distinto acabado es una línea distinta; la MISMA (carta, tipo, acabado)
 * incrementa la cantidad en vez de duplicar (dedup — hallazgo menor de QA).
 */
interface CartLine {
  id: string;
  card: QuoterCardRef;
  productType: ProductType;
  rawCondition?: RawCondition;
  finish: Finish;
  quote: BuylistQuoteResponse;
  quantity: number;
}

let lineSeq = 0;

/**
 * Merge con dedup por (cardId + productType + finish): la misma línea suma cantidad,
 * una combinación nueva agrega línea. Reusado por el add por-acabado y por el bulk.
 */
function mergeCartLine(
  prev: CartLine[],
  line: Omit<CartLine, 'id' | 'quantity'>,
): CartLine[] {
  const idx = prev.findIndex(
    (l) => l.card.id === line.card.id && l.productType === line.productType && l.finish === line.finish,
  );
  if (idx >= 0) {
    return prev.map((l, i) => (i === idx ? { ...l, quantity: l.quantity + 1 } : l));
  }
  lineSeq += 1;
  return [...prev, { id: `line-${lineSeq}`, ...line, quantity: 1 }];
}

/**
 * Convierte un resultado batch `ok:true` en el `BuylistQuoteResponse` que consume el carrito.
 * (En el batch `rarity` es `string | null`; el carrito lo normaliza a string.)
 */
function batchResultToQuote(r: Extract<BuylistBatchQuoteResultDTO, { ok: true }>): BuylistQuoteResponse {
  return {
    rarity: r.rarity ?? '',
    finish: r.finish,
    appliedRule: r.appliedRule,
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
 * Renglón de detalle: concepto a la izquierda, dato a la derecha.
 * `lang` va en el propio contenedor del dato (los nombres y rarezas de catálogo son EN).
 */
function QuoteRow({
  label,
  lang,
  children,
}: {
  label: string;
  lang?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-2.5 text-[12px] text-muted last:border-b-0">
      <span>{label}</span>
      <span lang={lang} className="text-right text-text">
        {children}
      </span>
    </div>
  );
}

/**
 * Rediseño "grid protagonista" (2026-08-17):
 * - El grid de resultados usa TODO el ancho/alto disponible (scroll natural de página,
 *   sin scroll interno artificial); los filtros (set + búsqueda + tipo) viven en una
 *   barra encima y el carrito de venta en una columna lateral colapsable.
 * - Ya NO hay panel "COTIZACIÓN" ni selección intermedia: cada carta lista sus ACABADOS
 *   (`availableFinishes`) con su estimado server-side, y el clic en un acabado la agrega
 *   DIRECTO al carrito. La transparencia vive en el detalle expandible de cada línea
 *   (valor de referencia / regla aplicada / acabado / pendiente).
 * - El bulk (multi-selección) se conserva: agrega las seleccionadas (acabado por defecto)
 *   reusando las cotizaciones ya cargadas del grid (cero requests extra).
 * - "Mis solicitudes" nunca muestra error sin sesión: sin sesión la sección invita a
 *   iniciar sesión en tono informativo (y no consulta el endpoint).
 */
export function BuylistView() {
  const t = useTranslations('buylist');
  const tCommon = useTranslations('common');
  const tFinish = useTranslations('finish');
  const locale = useLocale() as AppLocale;
  const buylistSteps = useBuylistSteps();
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
  // el foco regresa al FAB (returnFocusRef). ---
  const [cart, setCart] = useState<CartLine[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const fabRef = useRef<HTMLButtonElement>(null);
  const [expandedLines, setExpandedLines] = useState<Record<string, boolean>>({});
  const [lastAdded, setLastAdded] = useState<{ name: string; label: string } | null>(null);

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
    setCart((prev) =>
      mergeCartLine(prev, {
        card,
        productType,
        rawCondition: productType === 'raw' ? 'NM' : undefined,
        finish: result.finish,
        quote: batchResultToQuote(result),
      }),
    );
    setLastAdded({ name: card.name, label: rowLabel(finish) });
    setBulkNotice(null);
  }

  /**
   * Clic en una casilla del binder Master Set (mode="quoter", raw): la variante YA trae su
   * cotización resuelta (`variant.quote`, batch client-side de MasterSetBinder) — se agrega
   * DIRECTO al carrito, mismo patrón que `addFromGrid`. Casillas sin cotización resuelta
   * quedan deshabilitadas en el binder (nunca deberían disparar este handler).
   */
  function addFromMasterSet(cell: MasterSetCardCellDTO, variant: MasterSetVariantDTO) {
    if (!variant.quote) return;
    const quote: BuylistQuoteResponse = {
      rarity: variant.quote.rarity ?? '',
      finish: variant.finish,
      appliedRule: variant.quote.appliedRule,
      quote: { status: variant.quote.status, quotedPriceCents: variant.quote.quotedPriceCents, currency: 'MXN' },
      referencePrice: variant.quote.referencePrice,
      paymentNotice: 'PAY_AFTER_RECEIPT',
    };
    setCart((prev) =>
      mergeCartLine(prev, {
        card: { id: cell.cardId, name: cell.name, number: cell.number, imageSmallUrl: cell.imageSmallUrl },
        productType: 'raw',
        rawCondition: 'NM',
        finish: variant.finish,
        quote,
      }),
    );
    setLastAdded({ name: cell.name, label: tFinish(variant.finish) });
    setBulkNotice(null);
  }

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
      setCart((prev) =>
        mergeCartLine(prev, {
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
        }),
      );
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
    setCart((prev) =>
      okEntries.reduce(
        (acc, { card, result }) =>
          mergeCartLine(acc, {
            card,
            productType,
            rawCondition: productType === 'raw' ? 'NM' : undefined,
            finish: result.finish,
            quote: batchResultToQuote(result),
          }),
        prev,
      ),
    );
    setBulkAddedCount(okEntries.length);
    setBulkFailedCount(failed);
    setBulkNotice(failed === 0 ? 'added' : okEntries.length > 0 ? 'partial' : 'error');
    setBulkSelected({});
    setLastAdded(null);
  }

  function setQuantity(lineId: string, quantity: number) {
    const clean = Number.isFinite(quantity) ? Math.max(1, Math.floor(quantity)) : 1;
    setCart((prev) => prev.map((l) => (l.id === lineId ? { ...l, quantity: clean } : l)));
  }

  function removeLine(lineId: string) {
    setCart((prev) => prev.filter((l) => l.id !== lineId));
  }

  function toggleLineDetail(lineId: string) {
    setExpandedLines((prev) => ({ ...prev, [lineId]: !prev[lineId] }));
  }

  /** Regla aplicada legible ("40% de referencia" / "MX$1.50 fijo"), resuelta server-side. */
  function ruleText(rule: BuylistQuoteResponse['appliedRule']): string {
    return rule.mode === 'fixed'
      ? t('ruleFixed', { amount: formatMoneyCents(rule.value, locale) })
      : t('rulePct', { pct: rule.value });
  }

  // Total ESTIMADO: suma quotedPriceCents × cantidad. Las líneas en precio
  // pendiente no aportan (el backend fija su monto al recibir) y se EXPLICAN
  // debajo del total en vez de sumar MX$0.00 en silencio.
  const totalEstimatedCents = useMemo(
    () => cart.reduce((sum, l) => sum + (l.quote.quote.quotedPriceCents ?? 0) * l.quantity, 0),
    [cart],
  );
  const pendingCardCount = useMemo(
    () =>
      cart
        .filter((l) => l.quote.quote.status === 'precio_pendiente')
        .reduce((n, l) => n + l.quantity, 0),
    [cart],
  );

  const cartCount = cart.reduce((n, l) => n + l.quantity, 0);
  const bulkCount = Object.keys(bulkSelected).length;

  // Gating de cuenta ANTES de llenar todo (guards del contrato §6): sesión, correo
  // verificado, CLABE registrada e INE esperado por topes. El bloqueo real es server-side;
  // aquí solo se comunica temprano para que el 403 no sea la primera noticia.
  const sellReq = useSellRequirements(totalEstimatedCents);

  // Expansión cantidad → items: N entradas por línea (1 item por carta física).
  const requestItems: BuylistRequestItem[] = useMemo(
    () =>
      cart.flatMap((l) =>
        Array.from({ length: l.quantity }, () => ({
          cardId: l.card.id,
          productType: l.productType,
          rawCondition: l.rawCondition,
          // v1.6-finish: cada item lleva su acabado; el backend snapshotea SellRequestItem.finish.
          finish: l.finish,
        })),
      ),
    [cart],
  );

  // "Mis solicitudes" SOLO se consulta con sesión: sin sesión no hay request (y por
  // tanto nunca un estado de error) — la sección muestra una invitación neutra.
  const requestsEnabled = sellReq.ready && sellReq.isAuthenticated;
  const requests = useQuery({
    queryKey: ['sell-requests'],
    queryFn: getSellRequests,
    enabled: requestsEnabled,
  });

  // F5 · Responder un AJUSTE de venta (contrato §6 · POST /buylist/requests/:id/respond).
  // El cliente acepta/rechaza el precio ajustado por el admin; al éxito refresca la lista.
  const respondMutation = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'accept' | 'decline' }) =>
      respondSellRequest(id, decision),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sell-requests'] });
    },
  });

  return (
    <div className="grid lg:grid-cols-[40px_1fr]">
      {/* Etiqueta vertical al margen: marca la sección sin recurrir a un color de fondo. */}
      <div className="hidden justify-center border-r border-border py-9 lg:flex">
        <span aria-hidden className="vertical-label text-xs text-muted">
          BUYLIST
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
          <button
            type="button"
            onClick={() => setGuideOpen(true)}
            className="mt-5 border-b border-accent pb-1.5 text-xs font-medium text-accent hover:border-text hover:text-text"
          >
            {t('shippingGuideLink')}
          </button>
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
              <MasterSetPanel mode="quoter" onAddToSellCart={addFromMasterSet} />
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
                          {cardsResult.data.data.map((card) => (
                            <li key={card.id} className="relative min-w-0">
                              {/* Multi-selección (bulk): checkbox FUERA de las filas de acabado. */}
                              <input
                                type="checkbox"
                                aria-label={t('bulkSelect', { name: card.name })}
                                checked={!!bulkSelected[card.id]}
                                onChange={() => toggleBulk(card)}
                                className="absolute left-1.5 top-1.5 z-10 h-4 w-4 accent-accent focus-visible:shadow-focus"
                              />
                              <CardImage src={card.imageSmallUrl} alt={card.name} className="p-1.5" />
                              <p lang="en" className="mt-2.5 truncate text-[13px] text-text">
                                {card.name}
                              </p>
                              <p lang="en" className="mt-1 truncate font-mono text-[10px] text-muted">
                                {card.setName}
                                {card.number && ` · #${card.number}`}
                              </p>
                              {/* Una fila por acabado disponible: estimado propio y agregable
                                  por separado (clic = directo al carrito). */}
                              <ul className="mt-2.5">
                                {tileFinishes(card).map((finish) => {
                                  const result = quoteFor(card.id, finish);
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
                                        className="group flex w-full items-center justify-between gap-2 border-b border-border py-2 text-left disabled:cursor-not-allowed"
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
                                            +
                                          </span>
                                        </span>
                                      </button>
                                    </li>
                                  );
                                })}
                              </ul>
                            </li>
                          ))}
                        </ul>
                      ))}
                  </QueryState>
                </div>
              </>
            )}
        </main>

        {/* Carrito de venta = DRAWER flotante (P-16, §18.4b): el contenido del antiguo
            <aside> va tal cual dentro del drawer (el drawer solo es el contenedor). El
            encabezado (eyebrow + conteo + cerrar) lo pinta el propio drawer. */}
        <SellCartDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          ariaLabel={t('cartDrawer.ariaLabel', { count: cartCount })}
          title={t('cartTitle')}
          countLabel={cartCount > 0 ? t('cartCount', { count: cartCount }) : null}
          closeLabel={t('cartDrawer.close')}
          returnFocusRef={fabRef}
        >
          {/* Requisitos de cuenta SIEMPRE visibles (aun con carrito vacío — §18.6: el
              drawer vacío es útil): el usuario sabe QUÉ le falta antes de llenar todo
              (sesión / correo / CLABE / INE). */}
          <div>
            <SellRequirementsPanel req={sellReq} />
          </div>

              {cart.length === 0 ? (
                <p className="mt-5 text-[13px] leading-[1.7] text-muted">{t('cartEmpty')}</p>
              ) : (
                <>
                  <ul className="mt-4">
                    {cart.map((l) => {
                      const pending = l.quote.quote.status === 'precio_pendiente';
                      const unitCents = l.quote.quote.quotedPriceCents ?? 0;
                      const detailOpen = !!expandedLines[l.id];
                      return (
                        <li key={l.id} className="border-b border-border py-3">
                          <div className="flex items-baseline justify-between gap-3">
                            <p lang="en" className="min-w-0 truncate text-sm text-text">
                              {l.card.name}
                            </p>
                            <span className="tabular shrink-0 text-sm font-medium text-text">
                              {/* Honesto: una línea pendiente NO muestra MX$0.00. */}
                              {pending ? (
                                <span className="font-mono text-[11px] text-accent">{t('linePending')}</span>
                              ) : (
                                formatMoneyCents(unitCents * l.quantity, locale)
                              )}
                            </span>
                          </div>
                          <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5 font-mono text-[10px] text-muted">
                            <span className="text-muted">{t('cartItemEstimate')}:</span>
                            {pending ? (
                              <span className="text-accent">{t('linePending')}</span>
                            ) : (
                              <span className="tabular">{formatMoneyCents(unitCents, locale)}</span>
                            )}
                            <span aria-hidden>·</span>
                            {/* P-14 (§18.5): FinishMark compartido (banda 3px + etiqueta mono)
                                en vez del texto plano del acabado — mismo lenguaje que la teja. */}
                            <FinishMark finish={l.finish} className="translate-y-[1px]" />
                            <span aria-hidden>·</span>
                            <span>
                              ×<span className="tabular">{l.quantity}</span>
                            </span>
                          </p>
                          <div className="mt-2 flex items-center gap-4">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                aria-label={t('decreaseQty')}
                                disabled={l.quantity <= 1}
                                onClick={() => setQuantity(l.id, l.quantity - 1)}
                                className="font-mono text-sm text-muted hover:text-text disabled:opacity-40"
                              >
                                −
                              </button>
                              {/* Cantidad con input numérico: vender 20 iguales sin 20 clics. */}
                              <input
                                type="number"
                                min={1}
                                inputMode="numeric"
                                aria-label={t('quantityFor', { name: l.card.name })}
                                value={l.quantity}
                                onChange={(e) => setQuantity(l.id, Number.parseInt(e.target.value, 10))}
                                className="w-14 border-b border-border-strong bg-transparent py-0.5 text-center font-mono text-xs text-text outline-none focus-visible:shadow-focus"
                              />
                              <button
                                type="button"
                                aria-label={t('increaseQty')}
                                onClick={() => setQuantity(l.id, l.quantity + 1)}
                                className="font-mono text-sm text-muted hover:text-text"
                              >
                                +
                              </button>
                            </div>
                            {/* Detalle expandible: la transparencia de la cotización vive aquí
                                (valor de referencia / regla aplicada / acabado / pendiente). */}
                            <button
                              type="button"
                              aria-expanded={detailOpen}
                              onClick={() => toggleLineDetail(l.id)}
                              className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted hover:text-accent"
                            >
                              {detailOpen ? t('lineDetailHide') : t('lineDetailShow')}
                            </button>
                            <button
                              type="button"
                              onClick={() => removeLine(l.id)}
                              className="ml-auto font-mono text-[10px] uppercase tracking-[0.06em] text-muted hover:text-accent"
                            >
                              {t('removeLine')}
                            </button>
                          </div>
                          {detailOpen && (
                            <div className="mt-3 border-l border-border-strong pl-4">
                              {l.quote.rarity && (
                                <QuoteRow label={t('rarityLabel')} lang="en">
                                  {l.quote.rarity}
                                </QuoteRow>
                              )}
                              <QuoteRow label={tFinish('label')}>{tFinish(l.quote.finish)}</QuoteRow>
                              {l.quote.referencePrice.status === 'priced' && (
                                <QuoteRow label={t('referencePrice')}>
                                  <span className="tabular">
                                    {formatMoneyCents(l.quote.referencePrice.priceMxnCents ?? 0, locale)}
                                  </span>
                                </QuoteRow>
                              )}
                              {/* Regla aplicada, resuelta server-side por el acabado. */}
                              <QuoteRow label={t('appliedRuleLabel')}>{ruleText(l.quote.appliedRule)}</QuoteRow>
                              {pending && (
                                <p className="rule-note mt-3 text-[12px] leading-[1.7] text-muted">
                                  {t('pricePendingNotice')}
                                </p>
                              )}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>

                  <div className="flex items-baseline justify-between gap-3 py-4">
                    <span className="text-[13px] font-medium text-text">{t('totalEstimated')}</span>
                    {/* Si TODO el carrito está pendiente, el total no es MX$0.00: es pendiente. */}
                    {totalEstimatedCents === 0 && pendingCardCount > 0 ? (
                      <span className="font-mono text-[13px] text-accent">{t('linePending')}</span>
                    ) : (
                      <span className="tabular text-[22px] font-medium leading-none text-text">
                        {formatMoneyCents(totalEstimatedCents, locale)}
                      </span>
                    )}
                  </div>
                  {pendingCardCount > 0 && (
                    <p className="mb-3 font-mono text-[11px] leading-[1.6] text-muted">
                      {t('totalPendingNote', { count: pendingCardCount })}
                    </p>
                  )}

                  {/* SEC-A1: el total es un ESTIMADO; el backend confirma el monto al recibir. */}
                  <p className="font-mono text-[11px] leading-[1.6] text-muted">{t('estimateNote')}</p>

                  {sellReq.ready && !sellReq.isAuthenticated ? (
                    /* Sin sesión: el envío se sustituye por el CTA de entrar/crear cuenta
                       (el guard devolvería 401/403; mejor decirlo aquí). */
                    <div className="mt-5 flex flex-col gap-3">
                      <Link
                        href="/login"
                        className="inline-flex min-h-[44px] w-full items-center justify-center bg-primary px-6 text-[11px] font-medium uppercase tracking-label text-primary-fg"
                      >
                        {t('loginCta')}
                      </Link>
                      <Link
                        href="/register"
                        className="inline-flex min-h-[44px] w-full items-center justify-center border border-border-strong px-6 text-[11px] font-medium uppercase tracking-label text-text hover:border-text"
                      >
                        {t('registerCta')}
                      </Link>
                    </div>
                  ) : (
                    <>
                      <Button
                        variant="accent"
                        className="mt-5 w-full"
                        disabled={cart.length === 0 || !sellReq.canSubmit}
                        aria-describedby={sellReq.emailBlocked ? 'sell-blocked-reason' : undefined}
                        onClick={() => {
                          setCreatedId(null);
                          // Un solo focus trap activo (§18.4b): abrir el modal de solicitud
                          // cierra el drawer (el resumen del modal repite las líneas).
                          setDrawerOpen(false);
                          setRequestOpen(true);
                        }}
                      >
                        {t('sendRequestCta', { count: cartCount })}
                      </Button>
                      {sellReq.emailBlocked && (
                        /* Explica POR QUÉ el botón está deshabilitado (el reenvío vive en el panel). */
                        <p
                          id="sell-blocked-reason"
                          className="mt-3 font-mono text-[11px] leading-[1.6] text-accent"
                        >
                          {t('submitBlockedEmail')}
                        </p>
                      )}
                    </>
                  )}
                  <Button variant="ghost" size="sm" className="mt-3 w-full" onClick={() => setCart([])}>
                    {t('clearCart')}
                  </Button>
                </>
              )}
        </SellCartDrawer>

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
        </section>

        {createdId && (
          <p className="gutter rule-note py-5 text-sm text-text" role="status">
            {t('created')}
          </p>
        )}

        {/* Mis solicitudes: sin sesión NUNCA muestra error — invita a iniciar sesión
            en tono informativo (y no consulta el endpoint). */}
        <section className="gutter border-t border-border pb-14 pt-10">
          <h2 className="font-serif text-[22px] leading-tight text-text lg:text-[28px]">{t('myRequests')}</h2>
          <div className="mt-6">
            {!sellReq.ready ? null : !sellReq.isAuthenticated ? (
              <div className="max-w-[560px]">
                <p className="text-[13px] leading-[1.7] text-muted">{t('requestsLoginInvite')}</p>
                <Link
                  href="/login"
                  className="mt-4 inline-block border-b border-accent pb-1.5 text-xs font-medium text-accent hover:border-text hover:text-text"
                >
                  {t('loginCta')}
                </Link>
              </div>
            ) : (
              <QueryState
                isLoading={requests.isLoading}
                isError={requests.isError}
                error={requests.error}
                onRetry={() => requests.refetch()}
              >
                {(requests.data?.length ?? 0) === 0 ? (
                  <EmptyState title={t('noRequests')} />
                ) : (
                  requests.data!.map((r) => {
                    const hasPendingItems = r.items.some((it) => it.quotedPriceCents == null);
                    // F5: `ajustada` es item-level (no request-level) → se detecta por ítem.
                    const adjustedItems = r.items.filter((it) => it.itemStatus === 'ajustada');
                    const hasAdjustedItems = adjustedItems.length > 0;
                    const adjustedTotalCents = adjustedItems.reduce(
                      (s, it) => s + (it.approvedPriceCents ?? 0),
                      0,
                    );
                    const responding =
                      respondMutation.isPending && respondMutation.variables?.id === r.sellRequestId;
                    return (
                      <div key={r.sellRequestId} className="border-t border-border py-6">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <span className="flex items-center gap-3">
                            <span className="tabular font-mono text-[13px] text-text">{r.sellRequestId}</span>
                            <StatusBadge domain="sellRequest" value={r.status} />
                          </span>
                          <span className="tabular text-sm font-medium text-text">
                            {formatMoneyCents(r.quotedTotalCents, locale)}
                          </span>
                        </div>

                        <div className="mt-5">
                          <PipelineStepper
                            steps={buylistSteps}
                            current={r.status}
                            errored={r.status === 'rechazada' || r.status === 'abandonada'}
                          />
                        </div>

                        <div className="mt-5">
                          {r.items.map((it) => (
                            <div
                              key={it.id}
                              className="flex items-center justify-between gap-3 border-b border-border py-2.5 text-sm last:border-b-0"
                            >
                              <span lang="en" className="text-text">
                                {it.card.name}
                              </span>
                              <span className="flex items-center gap-4">
                                {/* Ajustada: el precio vigente es el ajustado (approvedPriceCents),
                                    con el original tachado para que el cliente compare. */}
                                {it.itemStatus === 'ajustada' && it.approvedPriceCents != null ? (
                                  <span className="flex items-center gap-2">
                                    {it.quotedPriceCents != null && (
                                      <span className="tabular text-[11px] text-muted line-through">
                                        {formatMoneyCents(it.quotedPriceCents, locale)}
                                      </span>
                                    )}
                                    <span className="tabular font-medium text-text">
                                      {formatMoneyCents(it.approvedPriceCents, locale)}
                                    </span>
                                  </span>
                                ) : it.quotedPriceCents == null ? (
                                  /* Honesto: sin cotización NO se muestra MX$0.00. */
                                  <span className="font-mono text-[11px] text-accent">{t('linePending')}</span>
                                ) : (
                                  <span className="tabular text-muted">
                                    {formatMoneyCents(it.quotedPriceCents, locale)}
                                  </span>
                                )}
                                <StatusBadge domain="sellItem" value={it.itemStatus} />
                              </span>
                            </div>
                          ))}
                        </div>

                        {/* F5: bloque de respuesta al AJUSTE — visible solo con ítems `ajustada`. */}
                        {hasAdjustedItems && (
                          <div className="mt-5 border border-accent/40 bg-accent/5 p-4">
                            <p className="eyebrow text-accent">{t('adjust.title')}</p>
                            <p className="mt-2 text-[13px] leading-[1.6] text-text">
                              {t('adjust.body')}
                            </p>
                            <p className="mt-3 flex items-baseline justify-between gap-3 text-sm">
                              <span className="text-muted">{t('adjust.newTotal')}</span>
                              <span className="tabular font-medium text-text">
                                {formatMoneyCents(adjustedTotalCents, locale)}
                              </span>
                            </p>
                            {respondMutation.isError &&
                              respondMutation.variables?.id === r.sellRequestId && (
                                <p role="alert" className="mt-3 font-mono text-[11px] text-accent">
                                  {t('adjust.error')}
                                </p>
                              )}
                            <div className="mt-4 flex gap-3">
                              <Button
                                size="sm"
                                loading={responding && respondMutation.variables?.decision === 'accept'}
                                disabled={responding}
                                onClick={() =>
                                  respondMutation.mutate({ id: r.sellRequestId, decision: 'accept' })
                                }
                              >
                                {t('adjust.accept')}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-accent"
                                loading={responding && respondMutation.variables?.decision === 'decline'}
                                disabled={responding}
                                onClick={() =>
                                  respondMutation.mutate({ id: r.sellRequestId, decision: 'decline' })
                                }
                              >
                                {t('adjust.decline')}
                              </Button>
                            </div>
                          </div>
                        )}

                        {hasPendingItems && (
                          <p className="mt-3 font-mono text-[11px] leading-[1.6] text-muted">
                            {t('requestPendingNote')}
                          </p>
                        )}
                      </div>
                    );
                  })
                )}
              </QueryState>
            )}
          </div>
        </section>

        {/* FAB del carrito (§18.4a): fijo abajo-derecha, en el flujo de tabulación DESPUÉS
            del contenido principal (§18.8, sin tabindex positivos). Siempre presente (vacío
            da acceso a los requisitos de venta); el badge se omite con carrito vacío. */}
        <SellCartFab ref={fabRef} count={cartCount} open={drawerOpen} onClick={() => setDrawerOpen(true)} />
      </div>

      <Modal open={guideOpen} onClose={() => setGuideOpen(false)} title={t('shippingGuideLink')}>
        <SafeShippingGuide onUnderstood={() => setGuideOpen(false)} />
      </Modal>

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
                <span className="text-[13px] font-medium text-text">{t('totalEstimated')}</span>
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
              // Heads-up de topes/CLABE derivado de GET /users/me/kyc; el backend re-decide (SEC-A1).
              ineExpected={sellReq.ineExpected}
              clabeMasked={sellReq.clabeMasked}
              // v1.15: atajo "usar mi CLABE" (omite `clabe`) e INE en archivo (oculta uploaders).
              clabeOnFile={sellReq.clabeOnFile}
              ineOnFile={sellReq.ineOnFile}
              onCreated={(sellRequestId) => {
                setCreatedId(sellRequestId);
                setRequestOpen(false);
                setCart([]);
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
