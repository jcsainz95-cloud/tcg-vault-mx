'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Info, ShieldQuestion, Search, Check, ShoppingCart, Plus, Minus, Trash2 } from 'lucide-react';
import { getBuylistQuote, getSellRequests, listBuylistSets, searchBuylistCards } from '@/lib/api';
import type { ProductType, CardDTO, RawCondition, Finish, BuylistQuoteResponse } from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { FinishBadge } from '@/components/domain/FinishBadge';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { Modal } from '@/components/ui/Modal';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PipelineStepper } from '@/components/ui/PipelineStepper';
import { SafeShippingGuide } from '@/components/domain/SafeShippingGuide';
import { BuylistKycForm, type BuylistRequestItem } from '@/components/domain/BuylistKycForm';
import { EmptyState } from '@/components/ui/EmptyState';
import { QueryState } from '@/components/ui/QueryState';
import { useBuylistSteps } from '@/lib/pipelines';

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
    setCart((prev) =>
      prev.map((l) => (l.id === lineId ? { ...l, quantity: Math.max(1, quantity) } : l)),
    );
  }

  function removeLine(lineId: string) {
    setCart((prev) => prev.filter((l) => l.id !== lineId));
  }

  // Total ESTIMADO: suma quotedPriceCents × cantidad. Las líneas en precio
  // pendiente no aportan (el backend fija su monto al recibir).
  const totalEstimatedCents = useMemo(
    () =>
      cart.reduce(
        (sum, l) => sum + (l.quote.quote.quotedPriceCents ?? 0) * l.quantity,
        0,
      ),
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
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-h1 font-bold">{t('title')}</h1>
        <p className="mt-1 text-muted">{t('subtitle')}</p>
      </div>

      {/* Banner persistente PAY_AFTER_RECEIPT (PROJECT AC 33, DESIGN §7.5) */}
      <Banner variant="trust" title={t('quoterTitle')}>
        {t('payAfterReceipt')}
      </Banner>

      {/* Política NM-only prominente (PROJECT §E/H, AC 3d) */}
      <Banner variant="warning" title={t('nmOnlyTitle')}>
        {t('nmOnlyBody')}
      </Banner>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
          <h2 className="text-h3 font-semibold">{t('quoterTitle')}</h2>

          {/* Paso 1: filtrar por set y/o buscar sobre TODO el catálogo */}
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
          <div className="flex items-end gap-2">
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
            <Button variant="secondary" onClick={runSearch} aria-label={t('searchAction')}>
              <Search size={18} /> {t('searchAction')}
            </Button>
          </div>

          {/* Resultados de la búsqueda: elegir una carta */}
          {hasSearch && (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">{t('searchResults')}</p>
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
                    <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto" role="listbox" aria-label={t('searchResults')}>
                      {cardsResult.data.data.map((card) => {
                        const active = selectedCard?.id === card.id;
                        return (
                          <li key={card.id}>
                            <button
                              type="button"
                              role="option"
                              aria-selected={active}
                              onClick={() => pickCard(card)}
                              className={`flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                                active ? 'border-primary bg-primary/5' : 'border-border hover:bg-surface-2'
                              }`}
                            >
                              <span lang="en" className="font-medium">{card.name}</span>
                              <span className="flex items-center gap-2 text-xs text-muted">
                                <span lang="en">{card.setName}</span>
                                {card.number && <span className="tabular">#{card.number}</span>}
                                {active && <Check size={16} className="text-primary" aria-hidden />}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ))}
              </QueryState>
            </div>
          )}

          {/* Paso 2: elegir tipo y cotizar la carta seleccionada */}
          {selectedCard && (
            <p className="rounded-md bg-primary/5 px-3 py-2 text-sm">
              {t('selectedCard')}: <span lang="en" className="font-semibold">{selectedCard.name}</span>
            </p>
          )}
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
            <p className="rounded-md bg-success-bg px-3 py-2 text-sm text-success">
              {t('conditionFixedNm')}
            </p>
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
          <Button onClick={() => quote.mutate()} loading={quote.isPending} disabled={!selectedCard}>
            {quote.isPending ? t('quoting') : t('getQuote')}
          </Button>
          {!selectedCard && <p className="text-xs text-muted">{t('chooseCardFirst')}</p>}
          <button
            type="button"
            onClick={() => setGuideOpen(true)}
            className="inline-flex items-center gap-2 self-start text-sm font-medium text-primary hover:underline"
          >
            <ShieldQuestion size={16} /> {t('shippingGuideLink')}
          </button>
        </div>

        <div className="flex flex-col gap-4">
          {quote.data && (
            <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
              <h3 className="text-h3 font-semibold">{t('quoteResult')}</h3>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">{t('rarityLabel')}</span>
                <span className="font-medium" lang="en">{quote.data.rarity}</span>
              </div>
              {/* v1.6-finish: acabado cotizado; la regla y la referencia se resuelven por acabado. */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">{tFinish('label')}</span>
                <FinishBadge finish={quote.data.finish} />
              </div>
              {/* Regla aplicada al usuario, resuelta por el acabado (ej. "40% de referencia" o "$1.50 fijo"). */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">{t('appliedRuleLabel')}</span>
                <span className="font-medium">
                  {quote.data.appliedRule.mode === 'fixed'
                    ? t('ruleFixed', { amount: formatMoneyCents(quote.data.appliedRule.value, locale) })
                    : t('rulePct', { pct: quote.data.appliedRule.value })}
                </span>
              </div>
              {quote.data.quote.status === 'precio_pendiente' ? (
                <Banner variant="warning">{t('pricePendingNotice')}</Banner>
              ) : (
                <div className="flex items-center justify-between">
                  <span className="text-muted">{t('quotedPrice')}</span>
                  <span className="tabular text-lg font-semibold text-success">
                    {formatMoneyCents(quote.data.quote.quotedPriceCents ?? 0, locale)}
                  </span>
                </div>
              )}
              {quote.data.referencePrice.status === 'priced' && (
                <div className="flex items-center justify-between text-xs text-muted">
                  <span>{t('referencePrice')}</span>
                  <span className="tabular">
                    {formatMoneyCents(quote.data.referencePrice.priceMxnCents ?? 0, locale)}
                  </span>
                </div>
              )}
              {/* Agregar la carta cotizada al carrito con su estimado (snapshot). */}
              <Button variant="accent" onClick={addToCart}>
                <ShoppingCart size={18} /> {t('addToCart')}
              </Button>
              {justAdded && (
                <p className="flex items-center gap-1.5 text-sm text-success" role="status">
                  <Check size={16} aria-hidden /> {t('addedToCart')}
                </p>
              )}
            </div>
          )}
          <Banner variant="info" title="">
            <span className="flex items-center gap-2">
              <Info size={16} /> {t('payAfterReceipt')}
            </span>
          </Banner>
        </div>
      </div>

      {/* Panel de carrito: varias cartas en UNA sola solicitud de venta */}
      <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
        <div className="flex items-center gap-2">
          <ShoppingCart size={20} className="text-primary" aria-hidden />
          <h2 className="text-h2 font-semibold">{t('cartTitle')}</h2>
          {cartCount > 0 && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary tabular">
              {t('cartCount', { count: cartCount })}
            </span>
          )}
        </div>

        {cart.length === 0 ? (
          <EmptyState title={t('cartEmpty')} />
        ) : (
          <>
            <ul className="flex flex-col divide-y divide-border">
              {cart.map((l) => {
                const pending = l.quote.quote.status === 'precio_pendiente';
                const unitCents = l.quote.quote.quotedPriceCents ?? 0;
                return (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p lang="en" className="truncate font-medium">{l.card.name}</p>
                      <p className="text-xs text-muted">
                        <span lang="en">{l.card.setName}</span>
                        {l.card.rarity && <> · <span lang="en">{l.card.rarity}</span></>}
                        {' · '}
                        {l.productType === 'raw' ? `${l.productType} · NM` : l.productType}
                      </p>
                      {/* v1.6-finish: acabado de esta línea (parte de su identidad para el dedup). */}
                      <div className="mt-1">
                        <FinishBadge finish={l.finish} productType={l.productType} compact />
                      </div>
                      <p className="mt-0.5 text-xs">
                        <span className="text-muted">{t('cartItemEstimate')}: </span>
                        {pending ? (
                          <span className="font-medium text-warning">{t('linePending')}</span>
                        ) : (
                          <span className="tabular font-medium text-success">
                            {formatMoneyCents(unitCents, locale)}
                          </span>
                        )}
                      </p>
                    </div>

                    <div className="flex items-center gap-1" role="group" aria-label={t('quantity')}>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t('decreaseQty')}
                        disabled={l.quantity <= 1}
                        onClick={() => setQuantity(l.id, l.quantity - 1)}
                      >
                        <Minus size={16} />
                      </Button>
                      <span className="tabular w-8 text-center text-sm font-medium" aria-live="polite">
                        {l.quantity}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t('increaseQty')}
                        onClick={() => setQuantity(l.id, l.quantity + 1)}
                      >
                        <Plus size={16} />
                      </Button>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="tabular w-24 text-right text-sm font-semibold">
                        {pending ? '—' : formatMoneyCents(unitCents * l.quantity, locale)}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t('removeLine')}
                        onClick={() => removeLine(l.id)}
                      >
                        <Trash2 size={16} className="text-danger" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="flex items-center justify-between border-t border-border pt-3">
              <span className="font-semibold">{t('totalEstimated')}</span>
              <span className="tabular text-h3 font-bold text-success">
                {formatMoneyCents(totalEstimatedCents, locale)}
              </span>
            </div>

            {/* SEC-A1: el total es un ESTIMADO; el backend confirma el monto al recibir. */}
            <Banner variant="info">{t('estimateNote')}</Banner>
            <Banner variant="info">{t('kycNotice')}</Banner>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="accent"
                disabled={cart.length === 0}
                onClick={() => {
                  setCreatedId(null);
                  setRequestOpen(true);
                }}
              >
                {t('sendRequestCta', { count: cartCount })}
              </Button>
              <Button variant="ghost" onClick={() => setCart([])}>
                <Trash2 size={16} /> {t('clearCart')}
              </Button>
            </div>
          </>
        )}
      </section>

      {createdId && (
        <Banner variant="success" role="status">
          {t('created')}
        </Banner>
      )}

      <section className="flex flex-col gap-4">
        <h2 className="text-h2 font-semibold">{t('myRequests')}</h2>
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
              <div key={r.sellRequestId} className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="tabular text-sm font-medium">{r.sellRequestId}</span>
                    <StatusBadge domain="sellRequest" value={r.status} />
                  </div>
                  <span className="tabular text-sm text-muted">
                    {formatMoneyCents(r.quotedTotalCents, locale)}
                  </span>
                </div>
                <PipelineStepper
                  steps={buylistSteps}
                  current={r.status}
                  errored={r.status === 'rechazada' || r.status === 'abandonada'}
                />
                <div className="flex flex-col gap-1.5">
                  {r.items.map((it) => (
                    <div key={it.id} className="flex items-center justify-between text-sm">
                      <span lang="en">{it.card.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="tabular text-muted">
                          {formatMoneyCents(it.quotedPriceCents ?? 0, locale)}
                        </span>
                        <StatusBadge domain="sellItem" value={it.itemStatus} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </QueryState>
      </section>

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
