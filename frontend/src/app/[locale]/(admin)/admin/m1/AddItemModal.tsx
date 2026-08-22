'use client';

import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Search, Check, Trash2, AlertTriangle } from 'lucide-react';
import {
  getLocations,
  listBuylistSets,
  searchBuylistCards,
  createInventoryItem,
  batchCreateItems,
} from '@/lib/api';
import type {
  ProductType,
  GradingCompany,
  AcquisitionType,
  Finish,
  CardDTO,
  BatchInventoryItemInput,
} from '@/types/contract';
import { FINISH_ORDER } from '@/lib/finish';
import { FinishBadge } from '@/components/domain/FinishBadge';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Banner } from '@/components/ui/Banner';
import { ApiClientError } from '@/lib/api-client';

// P-35 (§16.8a): el sellado ya NO se da de alta por el buscador de cartas — vive en el flujo
// dedicado `SealedAddFlow`. El alta por lote clásica conserva solo raw/graded.
const PRODUCT_TYPES: ProductType[] = ['raw', 'graded'];
const GRADING_COMPANIES: GradingCompany[] = ['PSA', 'CGC'];
// Alta MANUAL: `buylist` NO es una vía de alta manual (es la conversión automática de M5).
const ACQ: AcquisitionType[] = ['aportacion_en_especie', 'compra'];

export interface AddItemModalProps {
  onClose: () => void;
  onToast: (t: { variant: 'success' | 'danger'; title: string; message: string; duration?: number }) => void;
}

/**
 * «Alta por lote» — el modal de alta masiva existente (P-5), SIN cambios funcionales (§16.1.3):
 * picker sobre el catálogo real, selección múltiple, lote tolerante por-línea con batchKey
 * idempotente y error anclado arriba (P-4). Extraído de M1View en la reorganización P-17 (el
 * formulario clásico conserva ubicación, % de aportación y dropdown de acabado; el alta RÁPIDA
 * simplificada P-19 vive en el drill-down).
 *
 * El componente se monta AL ABRIR y se desmonta al cerrar: cada apertura arranca limpia (FIX 2 —
 * la adquisición/% /tipo no se heredan de la tanda anterior).
 */
export function AddItemModal({ onClose, onToast }: AddItemModalProps) {
  const t = useTranslations('admin.m1');
  const tFinish = useTranslations('finish');
  const tc = useTranslations('common');
  const tRoot = useTranslations();
  const queryClient = useQueryClient();

  // Picker sobre el catálogo REAL (patrón del cotizador): set + búsqueda + carta elegida.
  const [setId, setSetId] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCard, setSelectedCard] = useState<CardDTO | null>(null);
  const [productType, setProductType] = useState<ProductType>('raw');
  const [finish, setFinish] = useState<Finish>('normal');
  const [gradingCompany, setGradingCompany] = useState<GradingCompany>('PSA');
  const [gradeValue, setGradeValue] = useState('10');
  const [certNumber, setCertNumber] = useState('');
  const [acq, setAcq] = useState<AcquisitionType>('aportacion_en_especie');
  const [pct, setPct] = useState('70');
  const [locationId, setLocationId] = useState<string>('');
  // P-5 · Alta MASIVA: modo de selección múltiple + "carrito" de cartas del lote.
  const [multiSelect, setMultiSelect] = useState(false);
  const [batchCards, setBatchCards] = useState<CardDTO[]>([]);
  // batchKey ESTABLE por sesión de captura: se fija al empezar a armar el lote y SOLO se
  // regenera tras un envío exitoso → un reintento por timeout es replay idempotente.
  const batchKeyRef = useRef<string | null>(null);
  function ensureBatchKey(): string {
    if (batchKeyRef.current === null) {
      batchKeyRef.current = `batch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    }
    return batchKeyRef.current;
  }
  // Foco/scroll al banner de error del alta (P-4).
  const errorRef = useRef<HTMLDivElement>(null);

  const gradedCertMissing = productType === 'graded' && certNumber.trim() === '';

  const locations = useQuery({ queryKey: ['locations'], queryFn: getLocations });
  const sets = useQuery({ queryKey: ['buylist-sets'], queryFn: listBuylistSets });
  const hasSearch = setId !== '' || searchQuery.trim() !== '';
  // P-3: pageSize 50 (el backend topa en 100) para reducir la fricción de "Cargar más".
  const PAGE_SIZE = 50;
  const cardsResult = useInfiniteQuery({
    queryKey: ['m1-cards', setId, searchQuery],
    queryFn: ({ pageParam }) =>
      searchBuylistCards({
        setId: setId || undefined,
        q: searchQuery || undefined,
        page: pageParam,
        pageSize: PAGE_SIZE,
      }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    enabled: hasSearch,
  });
  const cards: CardDTO[] = cardsResult.data?.pages.flatMap((p) => p.data) ?? [];
  const cardsTotal = cardsResult.data?.pages[0]?.total ?? 0;

  // v1.6-finish: acabados de la carta REAL elegida; en masivo, la UNIÓN del lote.
  const availableFinishes: Finish[] = selectedCard
    ? FINISH_ORDER.filter((f) => selectedCard.availableFinishes.includes(f))
    : ['normal'];
  const batchFinishes: Finish[] = FINISH_ORDER.filter((f) =>
    batchCards.some((c) => c.availableFinishes.includes(f)),
  );
  const finishOptions: Finish[] = multiSelect
    ? batchFinishes.length > 0
      ? batchFinishes
      : ['normal']
    : availableFinishes;
  const showFinishSelect = productType === 'raw' && finishOptions.length > 1;

  function finishForCard(card: CardDTO): Finish {
    if (card.availableFinishes.includes(finish)) return finish;
    return FINISH_ORDER.find((f) => card.availableFinishes.includes(f)) ?? 'normal';
  }

  // Mensaje de error en el CONTEXTO DEL ALTA ADMIN (P-4.2).
  function messageForCode(code: string | undefined, message?: string): string {
    if (code && t.has(`errorByCode.${code}`)) return t(`errorByCode.${code}`);
    if (code && tRoot.has(`error.${code}`)) return tRoot(`error.${code}`);
    return message ?? tc('errorGeneric');
  }
  function errorMessage(error: unknown): string {
    if (error instanceof ApiClientError) return messageForCode(error.code, error.message);
    return tc('errorGeneric');
  }

  function runSearch() {
    setSearchQuery(searchInput.trim());
  }

  function pickCard(card: CardDTO) {
    setSelectedCard(card);
    setFinish(FINISH_ORDER.find((f) => card.availableFinishes.includes(f)) ?? 'normal');
  }

  const inBatch = (cardId: string) => batchCards.some((c) => c.id === cardId);

  function toggleBatch(card: CardDTO) {
    ensureBatchKey();
    batch.reset();
    setBatchCards((prev) =>
      prev.some((c) => c.id === card.id) ? prev.filter((c) => c.id !== card.id) : [...prev, card],
    );
  }

  function clearBatch() {
    batchKeyRef.current = null;
    setBatchCards([]);
    batch.reset();
  }

  const create = useMutation({
    mutationFn: () =>
      createInventoryItem({
        cardId: selectedCard!.id,
        productType,
        rawCondition: productType === 'raw' ? 'NM' : undefined,
        finish: productType === 'raw' ? finish : undefined,
        gradingCompany: productType === 'graded' ? gradingCompany : undefined,
        gradeValue: productType === 'graded' ? gradeValue : undefined,
        certNumber: productType === 'graded' ? certNumber.trim() : undefined,
        locationId: locationId || undefined,
        acquisitionType: acq,
        acquisitionPct: acq === 'aportacion_en_especie' ? Number(pct) : undefined,
      }),
    onSuccess: (data) => {
      setSelectedCard(null);
      void queryClient.invalidateQueries({ queryKey: ['admin-inventory'] });
      void queryClient.invalidateQueries({ queryKey: ['variant-pieces'] });
      onClose();
      // P-4.3: toast flotante INEQUÍVOCO con el folio devuelto.
      onToast({
        variant: 'success',
        title: t('createToastTitle'),
        message: t('createToast', { folio: data.folio }),
      });
    },
  });

  const batch = useMutation({
    mutationFn: (cardsToAdd: CardDTO[]) => {
      const items: BatchInventoryItemInput[] = cardsToAdd.map((card) => ({
        cardId: card.id,
        productType,
        rawCondition: productType === 'raw' ? 'NM' : undefined,
        finish: productType === 'raw' ? finishForCard(card) : undefined,
        gradingCompany: productType === 'graded' ? gradingCompany : undefined,
        gradeValue: productType === 'graded' ? gradeValue : undefined,
        certNumber: productType === 'graded' ? certNumber.trim() : undefined,
        locationId: locationId || undefined,
        acquisitionType: acq,
        acquisitionPct: acq === 'aportacion_en_especie' ? Number(pct) : undefined,
        qty: 1,
      }));
      return batchCreateItems({ batchKey: ensureBatchKey(), items });
    },
    onSuccess: (data) => {
      // Las líneas OK ya se crearon: se vacía el lote SIEMPRE (reenviar con key nueva duplicaría).
      batchKeyRef.current = null;
      setBatchCards([]);
      void queryClient.invalidateQueries({ queryKey: ['admin-inventory'] });
      void queryClient.invalidateQueries({ queryKey: ['variant-pieces'] });
      const { createdItems, failedLines } = data.summary;
      if (failedLines === 0) {
        onToast({
          variant: 'success',
          title: t('batchToastTitle'),
          message: t('batchToastAllOk', { created: createdItems }),
        });
      } else {
        onToast({
          variant: 'danger',
          title: t('batchToastTitle'),
          message: t('batchToastPartial', { created: createdItems, failed: failedLines }),
          duration: 9000,
        });
      }
    },
  });

  // P-4.1: al fallar el alta, banner al viewport + foco (a11y).
  useEffect(() => {
    if ((create.isError || batch.isError) && errorRef.current) {
      errorRef.current.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
      errorRef.current.focus();
    }
  }, [create.isError, batch.isError]);

  return (
    <Modal
      open
      onClose={onClose}
      title={t('newItemTitle')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          {multiSelect ? (
            <Button
              onClick={() => batch.mutate(batchCards)}
              disabled={batchCards.length === 0 || gradedCertMissing || batch.isPending}
              loading={batch.isPending}
            >
              {t('batchSubmit', { count: batchCards.length })}
            </Button>
          ) : (
            <Button
              onClick={() => create.mutate()}
              disabled={!selectedCard || gradedCertMissing || create.isPending}
              loading={create.isPending}
            >
              {t('createItem')}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* P-4.1: zona de feedback ANCLADA ARRIBA (sticky). */}
        {(create.isError || batch.isError) && (
          <div ref={errorRef} tabIndex={-1} className="sticky top-0 z-10 -mx-1 bg-bg px-1 pt-1 outline-none">
            <Banner variant="danger" role="alert" title={t('createErrorTitle')}>
              {create.isError ? errorMessage(create.error) : errorMessage(batch.error)}
            </Banner>
          </div>
        )}

        {/* P-5: resultado del alta MASIVA (tolerante por-línea). */}
        {batch.data && (
          <div className="flex flex-col gap-2 border border-border-strong bg-surface-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-text">
                {t('batchResultTitle')}
              </p>
              <span className="font-mono text-xs text-muted">
                {batch.data.summary.failedLines === 0
                  ? t('batchToastAllOk', { created: batch.data.summary.createdItems })
                  : t('batchToastPartial', {
                      created: batch.data.summary.createdItems,
                      failed: batch.data.summary.failedLines,
                    })}
                {batch.data.idempotentReplay ? ` · ${t('batchReplay')}` : ''}
              </span>
            </div>
            <ul className="flex flex-col gap-1" aria-label={t('batchResultTitle')}>
              {batch.data.results.map((r) => (
                <li
                  key={r.index}
                  className={`flex items-start gap-2 font-mono text-xs ${r.ok ? 'text-success' : 'text-accent'}`}
                >
                  {r.ok ? (
                    <Check size={14} className="mt-0.5 shrink-0" aria-hidden />
                  ) : (
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
                  )}
                  <span className="tabular-nums">
                    {r.ok ? r.folios.join(', ') : t('batchLine', { index: r.index + 1 })}
                  </span>
                  {!r.ok && <span>— {messageForCode(r.error.code, r.error.message)}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* v1.2: alta SIN foto propia; la imagen es la de catálogo remota de pokemontcg.io */}
        <Banner variant="info">{t('noPhotoNotice')}</Banner>

        {/* P-5: modo de alta MASIVA — FIX 1: deshabilitado en `graded` (cert único por pieza). */}
        <label
          className={`flex items-center gap-2 text-sm ${productType === 'graded' ? 'text-muted' : 'text-text'}`}
        >
          <input
            type="checkbox"
            className="h-4 w-4 accent-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-50"
            checked={multiSelect}
            disabled={productType === 'graded'}
            onChange={(e) => {
              setMultiSelect(e.target.checked);
              batch.reset();
              create.reset();
              if (e.target.checked) setSelectedCard(null);
              else clearBatch();
            }}
          />
          {t('multiSelect')}
        </label>
        {productType === 'graded' && <p className="text-xs text-muted">{t('gradedNoBulk')}</p>}

        {/* Picker de catálogo REAL (contrato §6). */}
        <Select
          label={t('filterBySet')}
          placeholder={t('allSets')}
          options={(sets.data ?? []).map((s) => ({
            value: s.id,
            label: s.year ? `${s.name} (${s.year})` : s.name,
          }))}
          value={setId}
          onChange={(e) => setSetId(e.target.value)}
        />
        <div className="flex items-end gap-2">
          <Input
            label={t('searchCards')}
            className="flex-1"
            placeholder={t('searchPlaceholder')}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                runSearch();
              }
            }}
          />
          <Button variant="secondary" onClick={runSearch} aria-label={t('searchAction')}>
            <Search size={18} /> {t('searchAction')}
          </Button>
        </div>

        {hasSearch && (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">{t('searchResults')}</p>
            {cardsResult.isLoading ? (
              <p className="text-sm text-muted">{tc('loading')}</p>
            ) : cardsResult.isError ? (
              <Banner variant="danger" role="alert">
                {tc('errorGeneric')}
              </Banner>
            ) : cards.length === 0 ? (
              <p className="text-sm text-muted">{t('noResults')}</p>
            ) : (
              <>
                <ul
                  className="flex max-h-72 flex-col gap-1 overflow-y-auto"
                  role="listbox"
                  aria-label={t('searchResults')}
                  aria-multiselectable={multiSelect || undefined}
                >
                  {cards.map((card) => {
                    const active = multiSelect ? inBatch(card.id) : selectedCard?.id === card.id;
                    return (
                      <li key={card.id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={active}
                          onClick={() => (multiSelect ? toggleBatch(card) : pickCard(card))}
                          className={`flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                            active ? 'border-primary bg-primary/5' : 'border-border hover:bg-surface-2'
                          }`}
                        >
                          {multiSelect && (
                            <span
                              aria-hidden
                              className={`flex h-4 w-4 shrink-0 items-center justify-center border ${
                                active ? 'border-primary bg-primary text-primary-fg' : 'border-border-strong'
                              }`}
                            >
                              {active && <Check size={12} />}
                            </span>
                          )}
                          {card.imageSmallUrl && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={card.imageSmallUrl}
                              alt=""
                              aria-hidden
                              loading="lazy"
                              className="h-12 w-auto shrink-0 bg-surface-2 object-contain"
                            />
                          )}
                          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span lang="en" className="font-medium">{card.name}</span>
                            <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
                              <span lang="en">{card.setName}</span>
                              {card.number && <span className="tabular">#{card.number}</span>}
                              {card.rarity && <span lang="en">{card.rarity}</span>}
                            </span>
                          </span>
                          <span className="flex shrink-0 items-center gap-1">
                            {card.availableFinishes.map((f) => (
                              <FinishBadge key={f} finish={f} />
                            ))}
                            {!multiSelect && active && <Check size={16} className="text-primary" aria-hidden />}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted">
                    {t('resultCount', { shown: cards.length, total: cardsTotal })}
                  </p>
                  {cardsResult.hasNextPage && (
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={cardsResult.isFetchingNextPage}
                      onClick={() => cardsResult.fetchNextPage()}
                    >
                      {t('loadMore')}
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* P-5: "carrito" del lote (solo modo múltiple). */}
        {multiSelect &&
          (batchCards.length > 0 ? (
            <section
              aria-label={t('batchTitle')}
              className="flex flex-col gap-2 border border-border-strong bg-surface-2 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-text">
                  {t('batchTitle')}
                </p>
                <span className="font-mono text-xs text-muted">
                  {t('batchCount', { count: batchCards.length })}
                </span>
              </div>
              <ul className="flex flex-col gap-1">
                {batchCards.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center gap-2 border-b border-border py-1 text-sm last:border-b-0"
                  >
                    <span lang="en" className="min-w-0 flex-1 truncate">
                      {c.name}
                      {c.number && <span className="tabular text-muted"> · #{c.number}</span>}
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => toggleBatch(c)} aria-label={t('batchRemove')}>
                      <Trash2 size={16} />
                    </Button>
                  </li>
                ))}
              </ul>
              <div>
                <Button size="sm" variant="secondary" onClick={clearBatch} disabled={batch.isPending}>
                  {t('batchClear')}
                </Button>
              </div>
            </section>
          ) : (
            <p className="text-xs text-muted">{t('batchEmpty')}</p>
          ))}

        {!multiSelect &&
          (selectedCard ? (
            <div className="flex items-center gap-3 rounded-md bg-primary/5 px-3 py-2 text-sm">
              {selectedCard.imageSmallUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={selectedCard.imageSmallUrl}
                  alt=""
                  aria-hidden
                  loading="lazy"
                  className="h-14 w-auto shrink-0 bg-surface-2 object-contain"
                />
              )}
              <div className="flex min-w-0 flex-col gap-1">
                <p>
                  {t('selectedCard')}: <span lang="en" className="font-semibold">{selectedCard.name}</span>
                </p>
                <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span lang="en">{selectedCard.setName}</span>
                  {selectedCard.number && <span className="tabular">#{selectedCard.number}</span>}
                  {selectedCard.rarity && <span lang="en">{selectedCard.rarity}</span>}
                </p>
                <span className="flex flex-wrap items-center gap-1">
                  {selectedCard.availableFinishes.map((f) => (
                    <FinishBadge key={f} finish={f} />
                  ))}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted">{t('chooseCardFirst')}</p>
          ))}
        <Select
          label={t('productType')}
          options={PRODUCT_TYPES.map((p) => ({ value: p, label: t(`productTypeLabel.${p}`) }))}
          value={productType}
          onChange={(e) => {
            const next = e.target.value as ProductType;
            setProductType(next);
            // FIX 1: el alta MASIVA NO admite gradeadas (certNumber único por slab).
            if (next === 'graded' && multiSelect) {
              setMultiSelect(false);
              clearBatch();
            }
          }}
        />
        {productType === 'raw' && (
          <p className="rounded-md bg-success-bg px-3 py-2 text-sm text-success">{t('conditionNm')}</p>
        )}
        {showFinishSelect ? (
          <Select
            label={t('finish')}
            options={finishOptions.map((f) => ({ value: f, label: tFinish(f) }))}
            value={finishOptions.includes(finish) ? finish : finishOptions[0]}
            onChange={(e) => setFinish(e.target.value as Finish)}
          />
        ) : productType !== 'raw' ? (
          <p className="rounded-md bg-surface-2/60 px-3 py-2 text-sm text-muted">{t('finishFixedNormal')}</p>
        ) : (
          !multiSelect &&
          selectedCard && (
            <p className="rounded-md bg-surface-2/60 px-3 py-2 text-sm text-muted">
              {t('finishFixedSingle', { finish: tFinish(availableFinishes[0] ?? 'normal') })}
            </p>
          )
        )}
        {productType === 'graded' && (
          <>
            <Select
              label={t('gradingCompany')}
              options={GRADING_COMPANIES.map((g) => ({ value: g, label: g }))}
              value={gradingCompany}
              onChange={(e) => setGradingCompany(e.target.value as GradingCompany)}
            />
            <Input
              label={t('gradeValue')}
              type="text"
              inputMode="decimal"
              value={gradeValue}
              onChange={(e) => setGradeValue(e.target.value)}
            />
            <Input
              label={t('certNumberRequired')}
              type="text"
              inputMode="numeric"
              required
              value={certNumber}
              onChange={(e) => setCertNumber(e.target.value)}
              error={gradedCertMissing ? t('certNumberError') : undefined}
            />
          </>
        )}
        <Select
          label={t('location')}
          options={(locations.data ?? []).map((l) => ({ value: l.id, label: l.label }))}
          value={locationId}
          onChange={(e) => setLocationId(e.target.value)}
        />
        <Select
          label={t('acquisitionType')}
          options={ACQ.map((a) => ({ value: a, label: t(`acquisitionLabel.${a}`) }))}
          value={acq}
          onChange={(e) => setAcq(e.target.value as AcquisitionType)}
        />
        {acq === 'aportacion_en_especie' && (
          <>
            <Input
              label={t('acquisitionPct')}
              type="number"
              inputMode="numeric"
              value={pct}
              onChange={(e) => setPct(e.target.value)}
            />
            <Banner variant="info">{t('costHint', { pct })}</Banner>
          </>
        )}
      </div>
    </Modal>
  );
}
