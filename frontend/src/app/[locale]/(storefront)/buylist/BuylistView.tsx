'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import {
  batchQuote,
  getBuylistQuote,
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
import { useBuylistSteps } from '@/lib/pipelines';
import { cn } from '@/lib/cn';

const PRODUCT_TYPES: ProductType[] = ['raw', 'graded', 'sealed'];
// v1.6-finish: acabados en el orden de despliegue del selector; la etiqueta legible viene de i18n `finish`.
const FINISH_ORDER: Finish[] = ['normal', 'reverse_holo', 'holofoil', 'first_edition_holofoil'];

/** Primer acabado disponible de la carta (normal va primero por convención del catálogo). */
function firstAvailableFinish(card: CardDTO): Finish {
  return FINISH_ORDER.find((f) => card.availableFinishes.includes(f)) ?? 'normal';
}

/**
 * queryKey ÚNICO de cotización por (carta, tipo, acabado). Lo comparten la cotización
 * principal, el precio estimado del grid y el bulk: cotizar en un sitio cachea para
 * los demás (0 requests repetidos dentro del staleTime).
 */
const quoteKeyFor = (cardId: string, productType: ProductType, finish: Finish) =>
  ['buylist-quote', cardId, productType, finish] as const;
const QUOTE_STALE_MS = 5 * 60_000;

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
  card: CardDTO;
  productType: ProductType;
  rawCondition?: RawCondition;
  finish: Finish;
  quote: BuylistQuoteResponse;
  quantity: number;
}

let lineSeq = 0;

/**
 * Merge con dedup por (cardId + productType + finish): la misma línea suma cantidad,
 * una combinación nueva agrega línea. Reusado por el add unitario y por el bulk.
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

/** Ítem de cotización en lote para una carta del grid: raw NM, primer acabado disponible. */
const gridQuoteItem = (card: CardDTO): BuylistQuoteItemDTO => ({
  cardId: card.id,
  productType: 'raw',
  rawCondition: 'NM',
  finish: firstAvailableFinish(card),
});

/**
 * Convierte un resultado batch `ok:true` en el `BuylistQuoteResponse` que consume el carrito.
 * (En el batch `rarity` es `string | null`; el carrito solo usa quote/finish, así que se normaliza.)
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
 * Precio de compra ESTIMADO por resultado del grid: convierte la búsqueda en una "buylist
 * navegable". Fase 3b: el estimado ya NO se pide por-carta (fan-out FE-12); llega del RESULTADO
 * de UNA sola llamada `POST /buylist/quote/batch` hecha a nivel del grid. Presentacional y tolerante
 * a errores por-ítem: si ESE ítem salió `ok:false`, muestra su error sin afectar a las demás filas.
 */
function ResultQuote({
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
 * Renglón de la cotización: concepto a la izquierda, dato a la derecha, regla debajo.
 * `lang` va en el propio contenedor del dato (los nombres y rarezas de catálogo son
 * EN) para no envolver el valor en un segundo elemento con idéntico texto.
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
    <div className="flex items-center justify-between gap-4 border-b border-border py-3.5 text-[13px] text-muted">
      <span>{label}</span>
      <span lang={lang} className="text-right text-text">
        {children}
      </span>
    </div>
  );
}

/**
 * 6d — El cotizador como formulario de una sola columna con la cotización a la
 * derecha, y el carrito de venta debajo. Las advertencias (solo NM, pago tras
 * verificar) llevan la regla bermellón en vez de un banner de color, y la sección
 * se marca con la etiqueta vertical BUYLIST al margen.
 *
 * Rediseño "menos clics" (2026-08-17):
 * - La cotización es AUTOMÁTICA al elegir carta/tipo/acabado (useQuery, sin botón "Cotizar").
 * - El grid de resultados muestra el precio de compra estimado por carta (ResultQuote).
 * - Multi-selección en resultados + "Agregar seleccionadas (N)" para bulk.
 * - Cantidad por línea con input numérico (además de −/+).
 */
export function BuylistView() {
  const t = useTranslations('buylist');
  const tFinish = useTranslations('finish');
  const locale = useLocale() as AppLocale;
  const buylistSteps = useBuylistSteps();
  const queryClient = useQueryClient();

  // --- Búsqueda real sobre TODO el catálogo (contrato §6, v1.3) ---
  const [setId, setSetId] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCard, setSelectedCard] = useState<CardDTO | null>(null);

  const [productType, setProductType] = useState<ProductType>('raw');
  // v1.6-finish: acabado elegido para cotizar (default normal). Se puebla de card.availableFinishes.
  const [finish, setFinish] = useState<Finish>('normal');
  const [guideOpen, setGuideOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);

  // --- Carrito de venta: varias cartas en UNA sola solicitud ---
  const [cart, setCart] = useState<CartLine[]>([]);
  const [justAdded, setJustAdded] = useState(false);

  // --- Bulk: multi-selección en los resultados de búsqueda ---
  const [bulkSelected, setBulkSelected] = useState<Record<string, CardDTO>>({});
  const [bulkAdding, setBulkAdding] = useState(false);
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

  // Estimado de compra del grid en UNA sola llamada batch (mata el fan-out FE-12: antes cada carta
  // del grid disparaba su propio POST /buylist/quote → ~pageSize requests). El backend responde con
  // resultado/error POR-ÍTEM (HTTP 200), así que una carta inválida no tumba el resto del grid.
  const gridBatchItems: BuylistQuoteItemDTO[] = useMemo(
    () => (cardsResult.data?.data ?? []).map(gridQuoteItem),
    [cardsResult.data],
  );
  const gridQuotes = useQuery({
    queryKey: ['buylist-quote-batch', gridBatchItems.map((i) => `${i.cardId}:${i.finish}`).join('|')],
    queryFn: () => batchQuote(gridBatchItems),
    enabled: gridBatchItems.length > 0,
    staleTime: QUOTE_STALE_MS,
  });
  // index por cardId (cada carta aparece una vez en el grid) para pintar su estimado/su error.
  const gridQuoteByCardId = useMemo(() => {
    const map = new Map<string, BuylistBatchQuoteResultDTO>();
    for (const r of gridQuotes.data?.results ?? []) map.set(r.cardId, r);
    return map;
  }, [gridQuotes.data]);

  function runSearch() {
    setSearchQuery(searchInput.trim());
  }

  const rawCondition: RawCondition | undefined = productType === 'raw' ? 'NM' : undefined;

  // El acabado solo aplica a raw/singles; graded/sealed cotizan siempre en `normal` (contrato §I).
  const availableFinishes: Finish[] = selectedCard
    ? FINISH_ORDER.filter((f) => selectedCard.availableFinishes.includes(f))
    : ['normal'];
  const effectiveFinish: Finish = productType === 'raw' ? finish : 'normal';
  // Se muestra el selector solo cuando hay >1 acabado disponible (si es ["normal"], queda fijo/oculto).
  const showFinishSelect = productType === 'raw' && availableFinishes.length > 1;

  /**
   * Cotización AUTOMÁTICA (menos clics): al elegir carta/tipo/acabado la key cambia y
   * react-query cotiza sola — sin botón "Cotizar". useQuery (no mutation) porque el
   * quote es read-only en el contrato (§6, v1.12) y así se cachea/comparte con el grid.
   * v1.6-finish: el acabado viaja en `finish`; el backend valida ∈ availableFinishes.
   */
  const quoteQuery = useQuery({
    queryKey: quoteKeyFor(selectedCard?.id ?? 'none', productType, effectiveFinish),
    queryFn: () =>
      getBuylistQuote({ cardId: selectedCard!.id, productType, rawCondition, finish: effectiveFinish }),
    enabled: !!selectedCard,
    staleTime: QUOTE_STALE_MS,
  });

  function pickCard(card: CardDTO) {
    setSelectedCard(card);
    // Arranca en el primer acabado disponible; la cotización dispara sola (auto-quote).
    setFinish(firstAvailableFinish(card));
    setJustAdded(false);
  }

  function addToCart() {
    if (!selectedCard || !quoteQuery.data) return;
    const data = quoteQuery.data;
    const card = selectedCard;
    // El acabado autoritativo es el que ecoa el quote (validado server-side).
    setCart((prev) => mergeCartLine(prev, { card, productType, rawCondition, finish: data.finish, quote: data }));
    setJustAdded(true);
  }

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
   * Bulk: agrega TODAS las seleccionadas de golpe (raw NM, acabado por defecto; el
   * acabado/tipo se puede afinar por línea re-cotizando esa carta en el panel).
   *
   * Fase 3b: UNA sola llamada `POST /buylist/quote/batch` (antes: `Promise.all` de N
   * `POST /buylist/quote`, all-or-nothing — una carta inválida tumbaba TODO el lote). Ahora es
   * tolerante por-ítem: las que salen `ok:true` se agregan y las `ok:false` se cuentan aparte
   * sin bloquear a las demás.
   */
  async function addSelectedToCart() {
    const cards = Object.values(bulkSelected);
    if (cards.length === 0) return;
    setBulkAdding(true);
    setBulkNotice(null);
    try {
      const { results } = await batchQuote(cards.map(gridQuoteItem));
      const cardById = new Map(cards.map((c) => [c.id, c]));
      const okResults = results.filter(
        (r): r is Extract<BuylistBatchQuoteResultDTO, { ok: true }> => r.ok,
      );
      setCart((prev) => {
        let next = prev;
        for (const r of okResults) {
          const card = cardById.get(r.cardId);
          if (!card) continue;
          next = mergeCartLine(next, {
            card,
            productType: 'raw',
            rawCondition: 'NM',
            finish: r.finish,
            quote: batchResultToQuote(r),
          });
        }
        return next;
      });
      const added = okResults.filter((r) => cardById.has(r.cardId)).length;
      const failed = results.length - added;
      setBulkAddedCount(added);
      setBulkFailedCount(failed);
      // Tolerante por-ítem: éxito total → "added"; algunas fallaron pero otras entraron → "partial";
      // ninguna entró → "error".
      setBulkNotice(failed === 0 ? 'added' : added > 0 ? 'partial' : 'error');
      setBulkSelected({});
    } catch {
      // Error a nivel request (p. ej. 400 VALIDATION_ERROR por vacío/sobre-cap, o red).
      setBulkNotice('error');
    } finally {
      setBulkAdding(false);
    }
  }

  function setQuantity(lineId: string, quantity: number) {
    const clean = Number.isFinite(quantity) ? Math.max(1, Math.floor(quantity)) : 1;
    setCart((prev) => prev.map((l) => (l.id === lineId ? { ...l, quantity: clean } : l)));
  }

  function removeLine(lineId: string) {
    setCart((prev) => prev.filter((l) => l.id !== lineId));
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

  const requests = useQuery({ queryKey: ['sell-requests'], queryFn: getSellRequests });

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
        </div>

        <div className="grid lg:grid-cols-[1fr_380px]">
          {/* Cotizador */}
          <div className="gutter border-b border-border pb-11 pt-9 lg:border-b-0 lg:border-r">
            <p className="eyebrow">{t('quoterTitle')}</p>

            {/* Paso 1: filtrar por set y/o buscar sobre TODO el catálogo */}
            <div className="mt-6 grid gap-7 sm:grid-cols-2">
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
              <div className="flex items-end gap-4">
                <Input
                  label={t('searchCards')}
                  className="flex-1"
                  placeholder={t('searchPlaceholder')}
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') runSearch();
                  }}
                />
                <button
                  type="button"
                  onClick={runSearch}
                  className="shrink-0 pb-3 text-xs font-medium text-accent hover:text-text"
                >
                  {t('searchAction')}
                </button>
              </div>
            </div>

            {/* Resultados: el arte manda; el elegido se marca con el filete bermellón.
                Cada carta muestra su precio de compra estimado (buylist navegable) y un
                checkbox de multi-selección para agregar en lote. */}
            {hasSearch && (
              <div className="mt-9">
                <p className="eyebrow">{t('searchResults')}</p>
                <p className="mt-2 font-mono text-[11px] text-muted">{t('gridEstimateLegend')}</p>
                <div className="mt-4">
                  <QueryState
                    isLoading={cardsResult.isLoading}
                    isError={cardsResult.isError}
                    error={cardsResult.error}
                    onRetry={() => cardsResult.refetch()}
                  >
                    {cardsResult.data &&
                      (cardsResult.data.data.length === 0 ? (
                        <EmptyState title={t('noResults')} />
                      ) : (
                        <ul
                          className="flex max-h-96 flex-wrap gap-5 overflow-y-auto"
                          aria-label={t('searchResults')}
                        >
                          {cardsResult.data.data.map((card) => {
                            const active = selectedCard?.id === card.id;
                            return (
                              <li key={card.id} className="relative w-24">
                                {/* Multi-selección (bulk): checkbox FUERA del botón de detalle. */}
                                <input
                                  type="checkbox"
                                  aria-label={t('bulkSelect', { name: card.name })}
                                  checked={!!bulkSelected[card.id]}
                                  onChange={() => toggleBulk(card)}
                                  className="absolute left-1 top-1 z-10 h-4 w-4 accent-accent focus-visible:shadow-focus"
                                />
                                <button
                                  type="button"
                                  aria-pressed={active}
                                  onClick={() => pickCard(card)}
                                  className="block w-24 text-left"
                                >
                                  <CardImage
                                    src={card.imageSmallUrl}
                                    alt={card.name}
                                    className={cn(
                                      'p-1.5',
                                      active && 'outline outline-1 outline-offset-4 outline-accent',
                                    )}
                                  />
                                  <span
                                    lang="en"
                                    className={cn(
                                      'mt-2.5 block truncate text-xs',
                                      active ? 'text-text' : 'text-muted',
                                    )}
                                  >
                                    {card.name}
                                  </span>
                                  <span lang="en" className="mt-1 block truncate font-mono text-[10px] text-muted">
                                    {card.setName}
                                    {card.number && ` · #${card.number}`}
                                  </span>
                                  {/* Estimado de compra por carta (raw NM, acabado default), del batch. */}
                                  <span className="mt-1 block truncate font-mono text-[10px]">
                                    <ResultQuote
                                      result={gridQuoteByCardId.get(card.id)}
                                      loading={gridQuotes.isLoading}
                                    />
                                  </span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      ))}
                  </QueryState>
                </div>

                {/* Barra de bulk: agrega todas las seleccionadas en un clic. */}
                {bulkCount > 0 && (
                  <div className="mt-5 flex flex-wrap items-center gap-5">
                    <Button size="sm" variant="secondary" loading={bulkAdding} onClick={addSelectedToCart}>
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
                  /* Tolerante por-ítem: algunas entraron, otras no (batch, HTTP 200 con errores por-ítem). */
                  <p role="status" className="mt-3 font-mono text-[11px] text-accent">
                    {t('bulkAddedPartial', { added: bulkAddedCount, failed: bulkFailedCount })}
                  </p>
                )}
                {bulkNotice === 'error' && (
                  <p role="alert" className="mt-3 font-mono text-[11px] text-accent">
                    {t('bulkAddError')}
                  </p>
                )}
              </div>
            )}

            {/* Paso 2: tipo, condición y acabado de la carta seleccionada */}
            <div className="mt-9 grid gap-7 sm:grid-cols-3">
              <Select
                label={t('selectType')}
                options={PRODUCT_TYPES.map((p) => ({ value: p, label: t(`productType.${p}`) }))}
                value={productType}
                onChange={(e) => {
                  setProductType(e.target.value as ProductType);
                  setJustAdded(false);
                }}
              />
              {productType === 'raw' && (
                // Sin selector de condición: NM fijo (único grado que compramos).
                <div>
                  <p className="eyebrow">{t('selectCondition')}</p>
                  <p className="mt-3 border-b border-border-strong pb-3 text-sm text-muted">
                    {t('conditionFixedNm')}
                  </p>
                </div>
              )}
              {/* v1.6-finish: selector de acabado poblado de card.availableFinishes. Solo cuando
                  la carta tiene >1 acabado; si es ["normal"] queda fijo en Normal (oculto).
                  Cambiarlo RE-COTIZA automáticamente (auto-quote). */}
              {selectedCard && showFinishSelect && (
                <Select
                  label={t('selectFinish')}
                  options={availableFinishes.map((f) => ({ value: f, label: tFinish(f) }))}
                  value={finish}
                  onChange={(e) => {
                    setFinish(e.target.value as Finish);
                    setJustAdded(false);
                  }}
                />
              )}
            </div>

            <div className="mt-9 flex flex-wrap items-center gap-6">
              <button
                type="button"
                onClick={() => setGuideOpen(true)}
                className="border-b border-accent pb-1.5 text-xs font-medium text-accent hover:border-text hover:text-text"
              >
                {t('shippingGuideLink')}
              </button>
            </div>
            {!selectedCard && (
              <p className="mt-4 font-mono text-[11px] text-muted">{t('chooseCardFirst')}</p>
            )}

            {/* Política NM-only (PROJECT §E/H, AC 3d) como nota al margen. */}
            <p className="rule-note mt-10 max-w-[640px] text-[13px] leading-[1.7] text-muted">
              <span className="font-medium text-text">{t('nmOnlyTitle')}.</span> {t('nmOnlyBody')}
            </p>

            {/* Copy de confianza (EDITABLE): quién paga el envío, tiempos de verificación/
                pago SPEI y vigencia de la cotización (ver FRONTEND_NOTES). */}
            <div className="mt-6 max-w-[640px] text-[13px] leading-[1.7] text-muted">
              <p>{t('trustShipping')}</p>
              <p className="mt-2">{t('trustPayment')}</p>
              <p className="mt-2">{t('trustValidity')}</p>
            </div>
          </div>

          {/* Cotización + carrito de venta */}
          <aside className="gutter pb-11 pt-9">
            {/* La cabecera aparece con la cotización: sin datos no hay ficha que titular.
                La cotización es automática: elegir carta/acabado dispara el quote. */}
            {selectedCard ? (
              <QueryState
                isLoading={quoteQuery.isLoading}
                isError={quoteQuery.isError}
                error={quoteQuery.error}
                onRetry={() => quoteQuery.refetch()}
                loading={
                  <p role="status" className="text-[13px] leading-[1.7] text-muted">
                    {t('quoting')}
                  </p>
                }
              >
                {quoteQuery.data && (
                  <>
                    <h2 className="eyebrow">{t('quoteResult')}</h2>
                    <div className="mt-5 border-t border-border">
                      <QuoteRow label={t('selectedCard')} lang="en">
                        {selectedCard.name}
                      </QuoteRow>
                      <QuoteRow label={t('rarityLabel')} lang="en">
                        {quoteQuery.data.rarity}
                      </QuoteRow>
                      {/* v1.6-finish: acabado cotizado; la regla y la referencia se resuelven por acabado. */}
                      <QuoteRow label={tFinish('label')}>{tFinish(quoteQuery.data.finish)}</QuoteRow>
                      {quoteQuery.data.referencePrice.status === 'priced' && (
                        <QuoteRow label={t('referencePrice')}>
                          <span className="tabular">
                            {formatMoneyCents(quoteQuery.data.referencePrice.priceMxnCents ?? 0, locale)}
                          </span>
                        </QuoteRow>
                      )}
                      {/* Regla aplicada, resuelta por el acabado (ej. "40% de referencia" o "$1.50 fijo"). */}
                      <QuoteRow label={t('appliedRuleLabel')}>
                        {quoteQuery.data.appliedRule.mode === 'fixed'
                          ? t('ruleFixed', {
                              amount: formatMoneyCents(quoteQuery.data.appliedRule.value, locale),
                            })
                          : t('rulePct', { pct: quoteQuery.data.appliedRule.value })}
                      </QuoteRow>
                    </div>

                    {quoteQuery.data.quote.status === 'precio_pendiente' ? (
                      <p className="rule-note mt-6 text-[13px] leading-[1.7] text-muted">
                        {t('pricePendingNotice')}
                      </p>
                    ) : (
                      <div className="mt-6">
                        <p className="eyebrow">{t('quotedPrice')}</p>
                        <p className="tabular mt-2.5 text-[36px] font-medium leading-none text-text">
                          {formatMoneyCents(quoteQuery.data.quote.quotedPriceCents ?? 0, locale)}
                        </p>
                      </div>
                    )}

                    {/* PAY_AFTER_RECEIPT (PROJECT AC 33, DESIGN §7.5) */}
                    <p className="mt-5 text-xs leading-[1.6] text-muted">{t('payAfterReceipt')}</p>

                    <Button variant="secondary" className="mt-6 w-full" onClick={addToCart}>
                      {t('addToCart')}
                    </Button>
                    {justAdded && (
                      <p className="mt-3 font-mono text-[11px] text-success" role="status">
                        {t('addedToCart')}
                      </p>
                    )}
                  </>
                )}
              </QueryState>
            ) : (
              <p className="text-[13px] leading-[1.7] text-muted">{t('payAfterReceipt')}</p>
            )}

            {/* Carrito de venta: varias cartas en UNA sola solicitud. */}
            <div className="mt-10 border-t border-border pt-6">
              <div className="flex items-center justify-between">
                <h2 className="eyebrow">{t('cartTitle')}</h2>
                {cartCount > 0 && <span className="eyebrow">{t('cartCount', { count: cartCount })}</span>}
              </div>

              {/* Requisitos de cuenta SIEMPRE visibles (aun con carrito vacío): el usuario
                  sabe QUÉ le falta antes de llenar todo (sesión / correo / CLABE / INE). */}
              <div className="mt-5">
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
                          <p className="mt-1 font-mono text-[10px] text-muted">
                            <span className="text-muted">{t('cartItemEstimate')}: </span>
                            {pending ? (
                              <span className="text-accent">{t('linePending')}</span>
                            ) : (
                              <span className="tabular">{formatMoneyCents(unitCents, locale)}</span>
                            )}
                            {' · '}
                            <span lang="en">{tFinish(l.finish)}</span>
                            {' · ×'}
                            <span className="tabular">{l.quantity}</span>
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
                            <button
                              type="button"
                              onClick={() => removeLine(l.id)}
                              className="ml-auto font-mono text-[10px] uppercase tracking-[0.06em] text-muted hover:text-accent"
                            >
                              {t('removeLine')}
                            </button>
                          </div>
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
            </div>
          </aside>
        </div>

        {createdId && (
          <p className="gutter rule-note py-5 text-sm text-text" role="status">
            {t('created')}
          </p>
        )}

        {/* Mis solicitudes */}
        <section className="gutter border-t border-border pb-14 pt-10">
          <h2 className="font-serif text-[22px] leading-tight text-text lg:text-[28px]">{t('myRequests')}</h2>
          <div className="mt-6">
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
          </div>
        </section>
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
                      <span className="min-w-0 truncate text-text">
                        <span lang="en">{l.card.name}</span>
                        <span className="ml-2 font-mono text-[10px] text-muted">
                          ×{l.quantity} · {tFinish(l.finish)}
                        </span>
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
                setJustAdded(false);
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
