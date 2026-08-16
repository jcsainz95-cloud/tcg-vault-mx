'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getBuylistQuote, getSellRequests, listBuylistSets, searchBuylistCards } from '@/lib/api';
import type { ProductType, CardDTO, RawCondition, Finish, BuylistQuoteResponse } from '@/types/contract';
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
import { EmptyState } from '@/components/ui/EmptyState';
import { QueryState } from '@/components/ui/QueryState';
import { useBuylistSteps } from '@/lib/pipelines';
import { cn } from '@/lib/cn';

const PRODUCT_TYPES: ProductType[] = ['raw', 'graded', 'sealed'];
// v1.6-finish: acabados en el orden de despliegue del selector; la etiqueta legible viene de i18n `finish`.
const FINISH_ORDER: Finish[] = ['normal', 'reverse_holo', 'holofoil', 'first_edition_holofoil'];

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

  const sets = useQuery({ queryKey: ['buylist-sets'], queryFn: listBuylistSets });

  // Solo se busca cuando hay set o texto (evita traer todo el catálogo sin filtro).
  const hasSearch = setId !== '' || searchQuery.trim() !== '';
  const cardsResult = useQuery({
    queryKey: ['buylist-cards', setId, searchQuery],
    queryFn: () => searchBuylistCards({ setId: setId || undefined, q: searchQuery || undefined }),
    enabled: hasSearch,
  });

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

  const quote = useMutation({
    // Condición de compra SIEMPRE NM (v1.1): raw se envía con rawCondition='NM', sin selector.
    // v1.6-finish: el acabado elegido viaja en `finish`; el backend valida ∈ availableFinishes.
    mutationFn: () =>
      getBuylistQuote({ cardId: selectedCard!.id, productType, rawCondition, finish: effectiveFinish }),
  });

  function pickCard(card: CardDTO) {
    setSelectedCard(card);
    // Arranca en el primer acabado disponible (normal va primero por convención del catálogo).
    const first = FINISH_ORDER.find((f) => card.availableFinishes.includes(f)) ?? 'normal';
    setFinish(first);
    setJustAdded(false);
    quote.reset();
  }

  function addToCart() {
    if (!selectedCard || !quote.data) return;
    // Identidad de línea = (cardId + productType + finish). El acabado autoritativo es el que
    // ecoa el quote (validado server-side). Dedup: si ya existe la MISMA línea, +1 cantidad.
    const lineFinish = quote.data.finish;
    const cardId = selectedCard.id;
    setCart((prev) => {
      const idx = prev.findIndex(
        (l) => l.card.id === cardId && l.productType === productType && l.finish === lineFinish,
      );
      if (idx >= 0) {
        return prev.map((l, i) => (i === idx ? { ...l, quantity: l.quantity + 1 } : l));
      }
      lineSeq += 1;
      return [
        ...prev,
        {
          id: `line-${lineSeq}`,
          card: selectedCard,
          productType,
          rawCondition,
          finish: lineFinish,
          quote: quote.data!,
          quantity: 1,
        },
      ];
    });
    setJustAdded(true);
  }

  function setQuantity(lineId: string, quantity: number) {
    setCart((prev) => prev.map((l) => (l.id === lineId ? { ...l, quantity: Math.max(1, quantity) } : l)));
  }

  function removeLine(lineId: string) {
    setCart((prev) => prev.filter((l) => l.id !== lineId));
  }

  // Total ESTIMADO: suma quotedPriceCents × cantidad. Las líneas en precio
  // pendiente no aportan (el backend fija su monto al recibir).
  const totalEstimatedCents = useMemo(
    () => cart.reduce((sum, l) => sum + (l.quote.quote.quotedPriceCents ?? 0) * l.quantity, 0),
    [cart],
  );

  const cartCount = cart.reduce((n, l) => n + l.quantity, 0);

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

  return (
    <div className="grid lg:grid-cols-[56px_1fr]">
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

            {/* Resultados: el arte manda; el elegido se marca con el filete bermellón. */}
            {hasSearch && (
              <div className="mt-9">
                <p className="eyebrow">{t('searchResults')}</p>
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
                          role="listbox"
                          aria-label={t('searchResults')}
                        >
                          {cardsResult.data.data.map((card) => {
                            const active = selectedCard?.id === card.id;
                            return (
                              <li key={card.id}>
                                <button
                                  type="button"
                                  role="option"
                                  aria-selected={active}
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
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      ))}
                  </QueryState>
                </div>
              </div>
            )}

            {/* Paso 2: tipo, condición y acabado de la carta seleccionada */}
            <div className="mt-9 grid gap-7 sm:grid-cols-3">
              <Select
                label={t('selectType')}
                options={PRODUCT_TYPES.map((p) => ({ value: p, label: p }))}
                value={productType}
                onChange={(e) => {
                  setProductType(e.target.value as ProductType);
                  setJustAdded(false);
                  quote.reset();
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
                  la carta tiene >1 acabado; si es ["normal"] queda fijo en Normal (oculto). */}
              {selectedCard && showFinishSelect && (
                <Select
                  label={t('selectFinish')}
                  options={availableFinishes.map((f) => ({ value: f, label: tFinish(f) }))}
                  value={finish}
                  onChange={(e) => {
                    setFinish(e.target.value as Finish);
                    setJustAdded(false);
                    quote.reset();
                  }}
                />
              )}
            </div>

            <div className="mt-9 flex flex-wrap items-center gap-6">
              <Button onClick={() => quote.mutate()} loading={quote.isPending} disabled={!selectedCard}>
                {quote.isPending ? t('quoting') : t('getQuote')}
              </Button>
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
          </div>

          {/* Cotización + carrito de venta */}
          <aside className="gutter pb-11 pt-9 lg:px-10">
            {/* La cabecera aparece con la cotización: sin datos no hay ficha que titular. */}
            {quote.data ? (
              <>
                <h2 className="eyebrow">{t('quoteResult')}</h2>
                <div className="mt-5 border-t border-border">
                  {selectedCard && (
                    <QuoteRow label={t('selectedCard')} lang="en">
                      {selectedCard.name}
                    </QuoteRow>
                  )}
                  <QuoteRow label={t('rarityLabel')} lang="en">
                    {quote.data.rarity}
                  </QuoteRow>
                  {/* v1.6-finish: acabado cotizado; la regla y la referencia se resuelven por acabado. */}
                  <QuoteRow label={tFinish('label')}>{tFinish(quote.data.finish)}</QuoteRow>
                  {quote.data.referencePrice.status === 'priced' && (
                    <QuoteRow label={t('referencePrice')}>
                      <span className="tabular">
                        {formatMoneyCents(quote.data.referencePrice.priceMxnCents ?? 0, locale)}
                      </span>
                    </QuoteRow>
                  )}
                  {/* Regla aplicada, resuelta por el acabado (ej. "40% de referencia" o "$1.50 fijo"). */}
                  <QuoteRow label={t('appliedRuleLabel')}>
                    {quote.data.appliedRule.mode === 'fixed'
                      ? t('ruleFixed', { amount: formatMoneyCents(quote.data.appliedRule.value, locale) })
                      : t('rulePct', { pct: quote.data.appliedRule.value })}
                  </QuoteRow>
                </div>

                {quote.data.quote.status === 'precio_pendiente' ? (
                  <p className="rule-note mt-6 text-[13px] leading-[1.7] text-muted">
                    {t('pricePendingNotice')}
                  </p>
                ) : (
                  <div className="mt-6">
                    <p className="eyebrow">{t('quotedPrice')}</p>
                    <p className="tabular mt-2.5 text-[36px] font-medium leading-none text-text">
                      {formatMoneyCents(quote.data.quote.quotedPriceCents ?? 0, locale)}
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
            ) : (
              <p className="text-[13px] leading-[1.7] text-muted">{t('payAfterReceipt')}</p>
            )}

            {/* Carrito de venta: varias cartas en UNA sola solicitud. */}
            <div className="mt-10 border-t border-border pt-6">
              <div className="flex items-center justify-between">
                <h2 className="eyebrow">{t('cartTitle')}</h2>
                {cartCount > 0 && <span className="eyebrow">{t('cartCount', { count: cartCount })}</span>}
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
                              {pending ? '—' : formatMoneyCents(unitCents * l.quantity, locale)}
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
                            <div className="flex items-center gap-2" role="group" aria-label={t('quantity')}>
                              <button
                                type="button"
                                aria-label={t('decreaseQty')}
                                disabled={l.quantity <= 1}
                                onClick={() => setQuantity(l.id, l.quantity - 1)}
                                className="font-mono text-sm text-muted hover:text-text disabled:opacity-40"
                              >
                                −
                              </button>
                              <span className="tabular w-6 text-center font-mono text-xs" aria-live="polite">
                                {l.quantity}
                              </span>
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
                    <span className="tabular text-[22px] font-medium leading-none text-text">
                      {formatMoneyCents(totalEstimatedCents, locale)}
                    </span>
                  </div>

                  {/* SEC-A1: el total es un ESTIMADO; el backend confirma el monto al recibir. */}
                  <p className="font-mono text-[11px] leading-[1.6] text-muted">{t('estimateNote')}</p>
                  <p className="mt-3 font-mono text-[11px] leading-[1.6] text-muted">{t('kycNotice')}</p>

                  <Button
                    variant="accent"
                    className="mt-5 w-full"
                    disabled={cart.length === 0}
                    onClick={() => {
                      setCreatedId(null);
                      setRequestOpen(true);
                    }}
                  >
                    {t('sendRequestCta', { count: cartCount })}
                  </Button>
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
                requests.data!.map((r) => (
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
                            <span className="tabular text-muted">
                              {formatMoneyCents(it.quotedPriceCents ?? 0, locale)}
                            </span>
                            <StatusBadge domain="sellItem" value={it.itemStatus} />
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
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
          <BuylistKycForm
            items={requestItems}
            onCreated={(sellRequestId) => {
              setCreatedId(sellRequestId);
              setRequestOpen(false);
              setCart([]);
              setJustAdded(false);
              void queryClient.invalidateQueries({ queryKey: ['sell-requests'] });
            }}
          />
        )}
      </Modal>
    </div>
  );
}
