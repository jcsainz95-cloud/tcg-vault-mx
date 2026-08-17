'use client';

import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Plus, Search, Check, ChevronLeft, ChevronRight, MapPin } from 'lucide-react';
import {
  getAdminInventory,
  getLocations,
  listBuylistSets,
  searchBuylistCards,
  createInventoryItem,
  type AdminInventoryFilters,
} from '@/lib/api';
import type {
  ProductType,
  SealedSubtype,
  GradingCompany,
  AcquisitionType,
  Finish,
  InventoryItemDTO,
  InventoryStatus,
  VaultZone,
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
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PriceTag } from '@/components/ui/PriceTag';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { ItemDetailModal } from './ItemDetailModal';
import { LocationsModal } from './LocationsModal';
import { MasterSetPanel } from './master-set/MasterSetPanel';

type M1Tab = 'pieces' | 'masterSet';

const PRODUCT_TYPES: ProductType[] = ['raw', 'graded', 'sealed'];
const SEALED_SUBTYPES: SealedSubtype[] = ['box', 'etb', 'bundle', 'tin', 'blister'];
const GRADING_COMPANIES: GradingCompany[] = ['PSA', 'CGC'];
// Alta MANUAL: `buylist` NO es una vía de alta manual (es la conversión automática de M5,
// MovementReason.buylist_convert); solo `aportacion_en_especie` y `compra` se dan de alta aquí.
// El enum completo (incl. buylist) se sigue traduciendo en tabla/detalle para items ya convertidos.
const ACQ: AcquisitionType[] = ['aportacion_en_especie', 'compra'];
// v1.6-finish: orden de despliegue del acabado; la etiqueta legible viene de i18n `finish`.
const FINISH_ORDER: Finish[] = ['normal', 'reverse_holo', 'holofoil', 'first_edition_holofoil'];
// Filtro de estado de la tabla (enum InventoryStatus completo del contrato).
const INVENTORY_STATUSES: InventoryStatus[] = [
  'in_stock',
  'listed',
  'reserved',
  'in_custody',
  'picking',
  'shipped',
  'delivered',
  'lost',
  'damaged',
  'withdrawn',
];
const ZONES: VaultZone[] = ['platform_stock', 'customer_custody'];
const INVENTORY_PAGE_SIZE = 20;

export function M1View() {
  const t = useTranslations('admin.m1');
  const tt = useTranslations('admin.m1.table');
  const tSub = useTranslations('status.sealedSubtype');
  const tFinish = useTranslations('finish');
  const tInv = useTranslations('status.inventory');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const queryClient = useQueryClient();
  // Pestañas M1: "Piezas" = tabla plana actual; "Master Set" = binder/cuadrícula por set (WS-E).
  const [tab, setTab] = useState<M1Tab>('pieces');
  const [open, setOpen] = useState(false);
  // Gestión Ola 2: detalle por pieza + gestor de ubicaciones.
  const [detailId, setDetailId] = useState<string | null>(null);
  const [locationsOpen, setLocationsOpen] = useState(false);
  // Filtros de la tabla (contrato §M1 · ?q/status/zone/locationId + paginación).
  const [folioQ, setFolioQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | InventoryStatus>('');
  const [zoneFilter, setZoneFilter] = useState<'' | VaultZone>('');
  const [locationFilter, setLocationFilter] = useState('');
  const [page, setPage] = useState(1);
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

  // Tabla con filtros + paginación REALES (antes iba sin query y quedaba capada a 20).
  const inventoryFilters: AdminInventoryFilters = {
    q: folioQ.trim() || undefined,
    status: statusFilter || undefined,
    zone: zoneFilter || undefined,
    locationId: locationFilter || undefined,
    page,
    pageSize: INVENTORY_PAGE_SIZE,
  };
  const inventory = useQuery({
    queryKey: ['admin-inventory', inventoryFilters],
    queryFn: () => getAdminInventory(inventoryFilters),
  });
  const locations = useQuery({ queryKey: ['locations'], queryFn: getLocations });

  // --- Picker de catálogo real (contrato §6 GET /buylist/sets + /buylist/cards, @Public) ---
  const sets = useQuery({ queryKey: ['buylist-sets'], queryFn: listBuylistSets });
  // Solo se busca cuando hay set o texto (evita traer todo el catálogo sin filtro).
  const hasSearch = setId !== '' || searchQuery.trim() !== '';
  // Paginado real (P-4a): el endpoint topa en 20 por página; sin `page` el operador solo
  // veía las primeras ~20 cartas del set. "Cargar más" acumula páginas hasta `total`.
  const PAGE_SIZE = 20;
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
  const getError = useErrorMessage();

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
    // §9.2: nunca el enum crudo → label legible ("Suelta (raw)"/"Gradeada"/"Sellado").
    { key: 'type', header: tt('type'), render: (i) => t(`productTypeLabel.${i.productType}`) },
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
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (i) => (
        <Button size="sm" variant="secondary" onClick={() => setDetailId(i.id)}>
          {t('view')}
        </Button>
      ),
    },
  ];

  const totalPages = inventory.data
    ? Math.max(1, Math.ceil(inventory.data.total / INVENTORY_PAGE_SIZE))
    : 1;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-h1 font-bold">{t('title')}</h1>
        {tab === 'pieces' && (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setLocationsOpen(true)}>
              <MapPin size={18} /> {t('locations.button')}
            </Button>
            <Button
              onClick={() => {
                // Nueva alta: limpia el resultado anterior (banner de folio / error).
                create.reset();
                setOpen(true);
              }}
            >
              <Plus size={18} /> {t('newItem')}
            </Button>
          </div>
        )}
      </div>

      {/* Pestañas "Piezas" / "Master Set" (WS-E): subrayado inferior en la activa (§6.6). */}
      <div className="flex gap-4 border-b border-border" role="tablist" aria-label={t('title')}>
        {(['pieces', 'masterSet'] as M1Tab[]).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-1 pb-2 text-sm transition-colors ${
              tab === key ? 'border-primary text-text' : 'border-transparent text-muted hover:text-text'
            }`}
          >
            {t(key === 'pieces' ? 'tabPieces' : 'tabMasterSet')}
          </button>
        ))}
      </div>

      {tab === 'masterSet' && <MasterSetPanel />}

      {tab === 'pieces' && (
      <>
      {/* P-4: confirmación de alta con el FOLIO devuelto por el backend (antes se ignoraba). */}
      {create.isSuccess && create.data && (
        <Banner variant="success" role="status">
          {t('createSuccess', { folio: create.data.folio })}
        </Banner>
      )}

      {/* Filtros de la tabla (folio + estado + zona + ubicación). Cambiar un filtro
          reinicia a la página 1 para no quedar fuera de rango. */}
      <div className="flex flex-wrap items-end gap-3">
        <Input
          label={t('filtersFolio')}
          className="w-56"
          placeholder={t('filtersFolioPlaceholder')}
          value={folioQ}
          onChange={(e) => { setFolioQ(e.target.value); setPage(1); }}
        />
        <Select
          label={tt('status')}
          className="w-44"
          options={[
            { value: '', label: tc('all') },
            ...INVENTORY_STATUSES.map((s) => ({ value: s, label: tInv(s) })),
          ]}
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value as '' | InventoryStatus); setPage(1); }}
        />
        <Select
          label={t('filtersZone')}
          className="w-48"
          options={[
            { value: '', label: tc('all') },
            ...ZONES.map((z) => ({ value: z, label: t(`zone.${z}`) })),
          ]}
          value={zoneFilter}
          onChange={(e) => { setZoneFilter(e.target.value as '' | VaultZone); setPage(1); }}
        />
        <Select
          label={tt('location')}
          className="w-48"
          options={[
            { value: '', label: tc('all') },
            ...(locations.data ?? []).map((l) => ({ value: l.id, label: l.label })),
          ]}
          value={locationFilter}
          onChange={(e) => { setLocationFilter(e.target.value); setPage(1); }}
        />
      </div>

      <QueryState
        isLoading={inventory.isLoading}
        isError={inventory.isError}
        error={inventory.error}
        onRetry={() => inventory.refetch()}
      >
        {inventory.data &&
          (inventory.data.data.length > 0 ? (
            <div className="flex flex-col gap-3">
              <div className="rounded-lg border border-border bg-surface p-2">
                <DataTable columns={columns} rows={inventory.data.data} rowKey={(i) => i.id} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted">
                  {t('pageInfo', { page: inventory.data.page, totalPages, total: inventory.data.total })}
                </span>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    <ChevronLeft size={16} /> {t('prev')}
                  </Button>
                  <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                    {t('next')} <ChevronRight size={16} />
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <EmptyState title={t('emptyTitle')} body={t('emptyBody')} />
          ))}
      </QueryState>

      {/* Detalle por pieza + acciones de gestión (publicar / mover / marcar) */}
      <ItemDetailModal
        itemId={detailId}
        onClose={() => setDetailId(null)}
        locations={locations.data ?? []}
      />

      {/* Gestor mínimo de ubicaciones de bóveda (crear/listar) */}
      <LocationsModal
        open={locationsOpen}
        onClose={() => setLocationsOpen(false)}
        locations={locations.data ?? []}
      />

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
                  (cards.length === 0 ? (
                    <p className="text-sm text-muted">{t('noResults')}</p>
                  ) : (
                    <>
                      <ul
                        className="flex max-h-72 flex-col gap-1 overflow-y-auto"
                        role="listbox"
                        aria-label={t('searchResults')}
                      >
                        {cards.map((card) => {
                          const active = selectedCard?.id === card.id;
                          return (
                            <li key={card.id}>
                              <button
                                type="button"
                                role="option"
                                aria-selected={active}
                                onClick={() => pickCard(card)}
                                className={`flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                                  active ? 'border-primary bg-primary/5' : 'border-border hover:bg-surface-2'
                                }`}
                              >
                                {/* Miniatura de catálogo remota (misma fuente que CardImage) */}
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
                                  {active && <Check size={16} className="text-primary" aria-hidden />}
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
                  ))}
              </QueryState>
            </div>
          )}

          {selectedCard ? (
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
          )}
          <Select
            label={t('productType')}
            options={PRODUCT_TYPES.map((p) => ({ value: p, label: t(`productTypeLabel.${p}`) }))}
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
          ) : productType !== 'raw' ? (
            <p className="rounded-md bg-surface-2/60 px-3 py-2 text-sm text-muted">
              {t('finishFixedNormal')}
            </p>
          ) : (
            // Raw con UN solo acabado disponible: se muestra fijo, no se oculta en silencio.
            selectedCard && (
              <p className="rounded-md bg-surface-2/60 px-3 py-2 text-sm text-muted">
                {t('finishFixedSingle', { finish: tFinish(availableFinishes[0] ?? 'normal') })}
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
          {create.isError && (
            // P-4: mensaje REAL del backend (p. ej. 422 PRICE_PENDING / FINISH_NOT_AVAILABLE),
            // no un genérico: el operador necesita saber POR QUÉ no se creó.
            <Banner variant="danger" role="alert" title={t('createError')}>
              {getError(create.error)}
            </Banner>
          )}
        </div>
      </Modal>
      </>
      )}
    </div>
  );
}
