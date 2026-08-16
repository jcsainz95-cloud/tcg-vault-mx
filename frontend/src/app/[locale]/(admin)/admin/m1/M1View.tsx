'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Plus, Search, Check } from 'lucide-react';
import {
  getAdminInventory,
  getLocations,
  listBuylistSets,
  searchBuylistCards,
  createInventoryItem,
} from '@/lib/api';
import type {
  ProductType,
  SealedSubtype,
  GradingCompany,
  AcquisitionType,
  Finish,
  InventoryItemDTO,
  CardDTO,
} from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { FinishBadge } from '@/components/domain/FinishBadge';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Banner } from '@/components/ui/Banner';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PriceTag } from '@/components/ui/PriceTag';
import { QueryState } from '@/components/ui/QueryState';

const PRODUCT_TYPES: ProductType[] = ['raw', 'graded', 'sealed'];
const SEALED_SUBTYPES: SealedSubtype[] = ['box', 'etb', 'bundle', 'tin', 'blister'];
const GRADING_COMPANIES: GradingCompany[] = ['PSA', 'CGC'];
const ACQ: AcquisitionType[] = ['aportacion_en_especie', 'buylist', 'compra'];
// v1.6-finish: orden de despliegue del acabado; la etiqueta legible viene de i18n `finish`.
const FINISH_ORDER: Finish[] = ['normal', 'reverse_holo', 'holofoil', 'first_edition_holofoil'];

export function M1View() {
  const t = useTranslations('admin.m1');
  const tt = useTranslations('admin.m1.table');
  const tSub = useTranslations('status.sealedSubtype');
  const tFinish = useTranslations('finish');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  // Picker sobre el catálogo REAL (patrón del cotizador): set + búsqueda + carta elegida.
  const [setId, setSetId] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCard, setSelectedCard] = useState<CardDTO | null>(null);
  const [productType, setProductType] = useState<ProductType>('raw');
  // v1.6-finish: acabado de la copia física; se valida contra card.availableFinishes al alta.
  const [finish, setFinish] = useState<Finish>('normal');
  const [sealedSubtype, setSealedSubtype] = useState<SealedSubtype>('box');
  const [gradingCompany, setGradingCompany] = useState<GradingCompany>('PSA');
  const [gradeValue, setGradeValue] = useState('10');
  const [certNumber, setCertNumber] = useState('');
  const [listPrice, setListPrice] = useState('');
  const [acq, setAcq] = useState<AcquisitionType>('aportacion_en_especie');
  const [pct, setPct] = useState('70');

  // Gradeada: certNumber es obligatorio para publicar (contrato §M1, v1.2).
  const gradedCertMissing = productType === 'graded' && certNumber.trim() === '';

  // v1.6-finish: acabados disponibles de la carta REAL elegida (solo raw/singles; graded/sealed = normal).
  const availableFinishes: Finish[] = selectedCard
    ? FINISH_ORDER.filter((f) => selectedCard.availableFinishes.includes(f))
    : ['normal'];
  const showFinishSelect = productType === 'raw' && availableFinishes.length > 1;

  const inventory = useQuery({ queryKey: ['admin-inventory'], queryFn: getAdminInventory });
  const locations = useQuery({ queryKey: ['locations'], queryFn: getLocations });

  // --- Picker de catálogo real (contrato §6 GET /buylist/sets + /buylist/cards, @Public) ---
  const sets = useQuery({ queryKey: ['buylist-sets'], queryFn: listBuylistSets });
  // Solo se busca cuando hay set o texto (evita traer todo el catálogo sin filtro).
  const hasSearch = setId !== '' || searchQuery.trim() !== '';
  const cardsResult = useQuery({
    queryKey: ['m1-cards', setId, searchQuery],
    queryFn: () => searchBuylistCards({ setId: setId || undefined, q: searchQuery || undefined }),
    enabled: hasSearch,
  });

  function runSearch() {
    setSearchQuery(searchInput.trim());
  }

  function pickCard(card: CardDTO) {
    setSelectedCard(card);
    // Reinicia el acabado al primero disponible de la carta elegida (normal va primero).
    setFinish(FINISH_ORDER.find((f) => card.availableFinishes.includes(f)) ?? 'normal');
  }

  const [locationId, setLocationId] = useState<string>('');

  // Alta contra el catálogo real: cardId = selectedCard.id (contrato POST /admin/inventory/items).
  const create = useMutation({
    mutationFn: () =>
      createInventoryItem({
        cardId: selectedCard!.id,
        productType,
        rawCondition: productType === 'raw' ? 'NM' : undefined,
        finish: productType === 'raw' ? finish : undefined,
        sealedSubtype: productType === 'sealed' ? sealedSubtype : undefined,
        gradingCompany: productType === 'graded' ? gradingCompany : undefined,
        gradeValue: productType === 'graded' ? gradeValue : undefined,
        certNumber: productType === 'graded' ? certNumber.trim() : undefined,
        locationId: locationId || undefined,
        acquisitionType: acq,
        acquisitionPct: acq === 'aportacion_en_especie' ? Number(pct) : undefined,
        listPriceCents:
          productType === 'sealed' && listPrice
            ? Math.round(Number(listPrice) * 100)
            : undefined,
      }),
    onSuccess: () => {
      setOpen(false);
      setSelectedCard(null);
      void queryClient.invalidateQueries({ queryKey: ['admin-inventory'] });
    },
  });

  const columns: Column<InventoryItemDTO>[] = [
    { key: 'folio', header: tt('folio'), render: (i) => <span className="tabular">{i.folio}</span> },
    { key: 'card', header: tt('card'), render: (i) => <span lang="en">{i.card.name}</span> },
    { key: 'type', header: tt('type'), render: (i) => i.productType },
    {
      key: 'finish',
      header: tt('finish'),
      render: (i) => (i.finish ? <FinishBadge finish={i.finish} productType={i.productType} /> : '—'),
    },
    { key: 'location', header: tt('location'), render: (i) => <span className="tabular">{i.location?.label ?? '—'}</span> },
    { key: 'status', header: tt('status'), render: (i) => <StatusBadge domain="inventory" value={i.status} /> },
    {
      key: 'reference',
      header: tt('reference'),
      align: 'right',
      render: (i) =>
        i.referenceValue ? (
          <PriceTag reference={i.referenceValue} mode="reference" />
        ) : (
          '—'
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-h1 font-bold">{t('title')}</h1>
        <Button onClick={() => setOpen(true)}>
          <Plus size={18} /> {t('newItem')}
        </Button>
      </div>

      <QueryState
        isLoading={inventory.isLoading}
        isError={inventory.isError}
        error={inventory.error}
        onRetry={() => inventory.refetch()}
      >
        {inventory.data && (
          <div className="rounded-lg border border-border bg-surface p-2">
            <DataTable columns={columns} rows={inventory.data} rowKey={(i) => i.id} />
          </div>
        )}
      </QueryState>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('newItemTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {tc('cancel')}
            </Button>
            <Button
              onClick={() => create.mutate()}
              disabled={!selectedCard || gradedCertMissing || create.isPending}
              loading={create.isPending}
            >
              {t('createItem')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {/* v1.2: alta SIN foto propia; la imagen es la de catálogo remota de pokemontcg.io */}
          <Banner variant="info">{t('noPhotoNotice')}</Banner>

          {/* Picker de catálogo REAL (contrato §6): filtra por set + busca sobre TODO el catálogo. */}
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
              <QueryState
                isLoading={cardsResult.isLoading}
                isError={cardsResult.isError}
                error={cardsResult.error}
                onRetry={() => cardsResult.refetch()}
              >
                {cardsResult.data &&
                  (cardsResult.data.data.length === 0 ? (
                    <p className="text-sm text-muted">{t('noResults')}</p>
                  ) : (
                    <ul
                      className="flex max-h-60 flex-col gap-1 overflow-y-auto"
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

          {selectedCard ? (
            <p className="rounded-md bg-primary/5 px-3 py-2 text-sm">
              {t('selectedCard')}: <span lang="en" className="font-semibold">{selectedCard.name}</span>
            </p>
          ) : (
            <p className="text-xs text-muted">{t('chooseCardFirst')}</p>
          )}
          <Select
            label={t('productType')}
            options={PRODUCT_TYPES.map((p) => ({ value: p, label: p }))}
            value={productType}
            onChange={(e) => setProductType(e.target.value as ProductType)}
          />
          {productType === 'raw' && (
            // Raw solo NM (v1.1): sin selector de grados; condición fija.
            <p className="rounded-md bg-success-bg px-3 py-2 text-sm text-success">{t('conditionNm')}</p>
          )}
          {/* v1.6-finish: acabado de la copia física, poblado de card.availableFinishes.
              graded/sellado son siempre normal → se muestra la nota fija en su lugar. */}
          {showFinishSelect ? (
            <Select
              label={t('finish')}
              options={availableFinishes.map((f) => ({ value: f, label: tFinish(f) }))}
              value={finish}
              onChange={(e) => setFinish(e.target.value as Finish)}
            />
          ) : (
            productType !== 'raw' && (
              <p className="rounded-md bg-surface-2/60 px-3 py-2 text-sm text-muted">
                {t('finishFixedNormal')}
              </p>
            )
          )}
          {productType === 'graded' && (
            // Gradeada (v1.2): empresa + grado + certNumber (requerido para publicar).
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
          {productType === 'sealed' && (
            // Sellado: subtipo + precio manual MXN obligatorio para publicar (§3.6).
            <>
              <Select
                label={t('sealedSubtype')}
                options={SEALED_SUBTYPES.map((s) => ({ value: s, label: tSub(s) }))}
                value={sealedSubtype}
                onChange={(e) => setSealedSubtype(e.target.value as SealedSubtype)}
              />
              <Input
                label={t('listPriceRequired')}
                type="text"
                inputMode="decimal"
                prefix="MX$"
                required
                value={listPrice}
                onChange={(e) => setListPrice(e.target.value)}
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
            options={ACQ.map((a) => ({ value: a, label: a }))}
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
          {create.isError && <Banner variant="danger">{t('createError')}</Banner>}
        </div>
      </Modal>
    </div>
  );
}
