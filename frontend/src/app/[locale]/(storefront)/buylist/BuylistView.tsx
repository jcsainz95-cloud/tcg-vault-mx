'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Info, ShieldQuestion, Search, Check } from 'lucide-react';
import { getBuylistQuote, getSellRequests, listBuylistSets, searchBuylistCards } from '@/lib/api';
import type { ProductType, CardDTO } from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { Modal } from '@/components/ui/Modal';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PipelineStepper } from '@/components/ui/PipelineStepper';
import { SafeShippingGuide } from '@/components/domain/SafeShippingGuide';
import { BuylistKycForm } from '@/components/domain/BuylistKycForm';
import { EmptyState } from '@/components/ui/EmptyState';
import { QueryState } from '@/components/ui/QueryState';
import { useBuylistSteps } from '@/lib/pipelines';

const PRODUCT_TYPES: ProductType[] = ['raw', 'graded', 'sealed'];

export function BuylistView() {
  const t = useTranslations('buylist');
  const tcat = useTranslations('buylist.categoryLabel');
  const locale = useLocale() as AppLocale;
  const buylistSteps = useBuylistSteps();
  const queryClient = useQueryClient();

  // --- Búsqueda real sobre TODO el catálogo (contrato §6, v1.3) ---
  const [setId, setSetId] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCard, setSelectedCard] = useState<CardDTO | null>(null);

  const [productType, setProductType] = useState<ProductType>('raw');
  const [guideOpen, setGuideOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);

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

  const quote = useMutation({
    // Condición de compra SIEMPRE NM (v1.1): raw se envía con rawCondition='NM', sin selector.
    mutationFn: () =>
      getBuylistQuote({
        cardId: selectedCard!.id,
        productType,
        rawCondition: productType === 'raw' ? 'NM' : undefined,
      }),
  });

  function pickCard(card: CardDTO) {
    setSelectedCard(card);
    quote.reset();
  }

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
            onChange={(e) => setProductType(e.target.value as ProductType)}
          />
          {productType === 'raw' && (
            // Sin selector de condición: NM fijo (único grado que compramos).
            <p className="rounded-md bg-success-bg px-3 py-2 text-sm text-success">
              {t('conditionFixedNm')}
            </p>
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
                <span className="text-muted">{t('category')}</span>
                <span className="font-medium">{tcat(quote.data.category)}</span>
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
              <Banner variant="info">{t('kycNotice')}</Banner>
              <Button
                variant="accent"
                disabled={quote.data.quote.status === 'precio_pendiente'}
                onClick={() => {
                  setCreatedId(null);
                  setRequestOpen(true);
                }}
              >
                {t('createRequest')}
              </Button>
            </div>
          )}
          <Banner variant="info" title="">
            <span className="flex items-center gap-2">
              <Info size={16} /> {t('payAfterReceipt')}
            </span>
          </Banner>
        </div>
      </div>

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
        {quote.data && quote.data.quote.status !== 'precio_pendiente' && selectedCard && (
          <BuylistKycForm
            cardId={selectedCard.id}
            productType={productType}
            category={quote.data.category}
            onCreated={(sellRequestId) => {
              setCreatedId(sellRequestId);
              setRequestOpen(false);
              void queryClient.invalidateQueries({ queryKey: ['sell-requests'] });
            }}
          />
        )}
      </Modal>
    </div>
  );
}
