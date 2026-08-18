'use client';

import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import {
  Plus,
  Search,
  Check,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Trash2,
  AlertTriangle,
} from 'lucide-react';
import {
  getAdminInventory,
  getLocations,
  listBuylistSets,
  searchBuylistCards,
  createInventoryItem,
  batchCreateItems,
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
  BatchInventoryItemInput,
} from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { FINISH_ORDER } from '@/lib/finish';
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
import { QueryState } from '@/components/ui/QueryState';
import { Toaster, useToasts } from '@/components/ui/Toast';
import { ApiClientError } from '@/lib/api-client';
import { ItemDetailModal } from './ItemDetailModal';
import { LocationsModal } from './LocationsModal';
// v1.20 (§4.20f): el binder Master Set es COMPARTIDO (M1 + bóveda de cliente + "Mi bóveda");
// M1 lo monta en modo `platform` (captura por lote, publicación, ajuste).
import { MasterSetPanel } from '@/components/master-set/MasterSetPanel';

type M1Tab = 'pieces' | 'masterSet';

const PRODUCT_TYPES: ProductType[] = ['raw', 'graded', 'sealed'];
const SEALED_SUBTYPES: SealedSubtype[] = ['box', 'etb', 'bundle', 'tin', 'blister'];
const GRADING_COMPANIES: GradingCompany[] = ['PSA', 'CGC'];
// Alta MANUAL: `buylist` NO es una vía de alta manual (es la conversión automática de M5,
// MovementReason.buylist_convert); solo `aportacion_en_especie` y `compra` se dan de alta aquí.
// El enum completo (incl. buylist) se sigue traduciendo en tabla/detalle para items ya convertidos.
const ACQ: AcquisitionType[] = ['aportacion_en_especie', 'compra'];
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
  const tRoot = useTranslations();
  const locale = useLocale() as AppLocale;
  const queryClient = useQueryClient();
  // Toasts (P-4): confirmación INEQUÍVOCA de éxito/fallo, visible por encima del modal.
  const { toasts, push: pushToast, dismiss: dismissToast } = useToasts();
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
  // P-5 · Alta MASIVA: modo de selección múltiple + "carrito" de cartas del lote.
  const [multiSelect, setMultiSelect] = useState(false);
  const [batchCards, setBatchCards] = useState<CardDTO[]>([]);
  // batchKey ESTABLE por sesión de captura (patrón MasterSetPanel): se fija al empezar a
  // armar el lote y SOLO se regenera tras un envío exitoso → un reintento por timeout es
  // replay idempotente en el backend (no duplica piezas), no un alta nueva.
  const batchKeyRef = useRef<string | null>(null);
  function ensureBatchKey(): string {
    if (batchKeyRef.current === null) {
      batchKeyRef.current = `batch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    }
    return batchKeyRef.current;
  }
  // Foco/scroll al banner de error del alta (P-4: feedback visible sin depender de scroll).
  const errorRef = useRef<HTMLDivElement>(null);

  // Gradeada: certNumber es obligatorio para publicar (contrato §M1, v1.2).
  const gradedCertMissing = productType === 'graded' && certNumber.trim() === '';

  // v1.6-finish: acabados disponibles de la carta REAL elegida (solo raw/singles; graded/sealed = normal).
  const availableFinishes: Finish[] = selectedCard
    ? FINISH_ORDER.filter((f) => selectedCard.availableFinishes.includes(f))
    : ['normal'];
  // En alta MASIVA el acabado se elige de la UNIÓN de acabados de las cartas del lote; al
  // enviar se recorta por-carta (`finishForCard`) para no mandar un acabado inexistente.
  const batchFinishes: Finish[] = FINISH_ORDER.filter((f) =>
    batchCards.some((c) => c.availableFinishes.includes(f)),
  );
  const finishOptions: Finish[] = multiSelect
    ? batchFinishes.length > 0
      ? batchFinishes
      : ['normal']
    : availableFinishes;
  const showFinishSelect = productType === 'raw' && finishOptions.length > 1;

  // Acabado efectivo de una carta del lote: el elegido si la carta lo soporta; si no, su
  // primer acabado disponible (evita FINISH_NOT_AVAILABLE espurio en el alta masiva).
  function finishForCard(card: CardDTO): Finish {
    if (card.availableFinishes.includes(finish)) return finish;
    return FINISH_ORDER.find((f) => card.availableFinishes.includes(f)) ?? 'normal';
  }

  // Mensaje de error en el CONTEXTO DEL ALTA ADMIN (P-4.2): prioriza copy propio del operador
  // (`admin.m1.errorByCode.*`) sobre el genérico de storefront (`error.*`), que habla de "comprar".
  function messageForCode(code: string | undefined, message?: string): string {
    if (code && t.has(`errorByCode.${code}`)) return t(`errorByCode.${code}`);
    if (code && tRoot.has(`error.${code}`)) return tRoot(`error.${code}`);
    return message ?? tc('errorGeneric');
  }
  function errorMessage(error: unknown): string {
    if (error instanceof ApiClientError) return messageForCode(error.code, error.message);
    return tc('errorGeneric');
  }

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
  // P-3: subir el tamaño de página del buscador del alta (de 20 a 50; el backend topa en 100)
  // para reducir la fricción de "Cargar más" (un set de 120 cartas cabe en 3 páginas, no 6).
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

  function runSearch() {
    setSearchQuery(searchInput.trim());
  }

  function pickCard(card: CardDTO) {
    setSelectedCard(card);
    // Reinicia el acabado al primero disponible de la carta elegida (normal va primero).
    setFinish(FINISH_ORDER.find((f) => card.availableFinishes.includes(f)) ?? 'normal');
  }

  const inBatch = (cardId: string) => batchCards.some((c) => c.id === cardId);

  /** Alta MASIVA: alterna la carta en el lote (checkbox por fila). */
  function toggleBatch(card: CardDTO) {
    ensureBatchKey();
    batch.reset();
    setBatchCards((prev) =>
      prev.some((c) => c.id === card.id) ? prev.filter((c) => c.id !== card.id) : [...prev, card],
    );
  }

  function clearBatch() {
    // Vaciar el lote cierra la sesión → nueva batchKey en el próximo lote.
    batchKeyRef.current = null;
    setBatchCards([]);
    batch.reset();
  }

  const [locationId, setLocationId] = useState<string>('');

  // FIX 2 (dinero — base de costo/P&L): cada apertura del alta arranca LIMPIA. Reseteamos los
  // campos del formulario a sus defaults iniciales (los mismos de los useState de arriba) para
  // que la ADQUISICIÓN, %, tipo, acabado, cert, precio y la selección de set/búsqueda/carta NO
  // se hereden de la tanda anterior (una `acq` heredada fijaría un costo/origen equivocado en M7).
  function resetAddForm() {
    setAcq('aportacion_en_especie');
    setProductType('raw');
    setFinish('normal');
    setSealedSubtype('box');
    setGradingCompany('PSA');
    setGradeValue('10');
    setCertNumber('');
    setListPrice('');
    setPct('70');
    setLocationId('');
    setSetId('');
    setSearchInput('');
    setSearchQuery('');
    setSelectedCard(null);
  }

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
    onSuccess: (data) => {
      setOpen(false);
      setSelectedCard(null);
      void queryClient.invalidateQueries({ queryKey: ['admin-inventory'] });
      // P-4.3: toast flotante INEQUÍVOCO con el folio devuelto (imposible de no ver).
      pushToast({
        variant: 'success',
        title: t('createToastTitle'),
        message: t('createToast', { folio: data.folio }),
      });
    },
  });

  // P-5 · Alta MASIVA (POST /admin/inventory/items/batch): tolerante por-línea (HTTP 200);
  // una línea inválida trae su error y NO tumba las demás. Reusa el endpoint de lote existente.
  const batch = useMutation({
    mutationFn: (cardsToAdd: CardDTO[]) => {
      const items: BatchInventoryItemInput[] = cardsToAdd.map((card) => ({
        cardId: card.id,
        productType,
        rawCondition: productType === 'raw' ? 'NM' : undefined,
        finish: productType === 'raw' ? finishForCard(card) : undefined,
        sealedSubtype: productType === 'sealed' ? sealedSubtype : undefined,
        gradingCompany: productType === 'graded' ? gradingCompany : undefined,
        gradeValue: productType === 'graded' ? gradeValue : undefined,
        certNumber: productType === 'graded' ? certNumber.trim() : undefined,
        locationId: locationId || undefined,
        acquisitionType: acq,
        acquisitionPct: acq === 'aportacion_en_especie' ? Number(pct) : undefined,
        listPriceCents:
          productType === 'sealed' && listPrice ? Math.round(Number(listPrice) * 100) : undefined,
        qty: 1,
      }));
      return batchCreateItems({ batchKey: ensureBatchKey(), items });
    },
    onSuccess: (data) => {
      // Sesión cerrada con éxito → próxima captura arranca con batchKey NUEVA. Se vacía el
      // lote SIEMPRE (aun con fallos parciales): las líneas OK ya se crearon en el backend;
      // reenviar el mismo lote con key nueva DUPLICARÍA las creadas. El detalle por-línea
      // (data.results) se sigue mostrando desde `batch.data` aunque el lote quede vacío.
      batchKeyRef.current = null;
      setBatchCards([]);
      void queryClient.invalidateQueries({ queryKey: ['admin-inventory'] });
      const { createdItems, failedLines } = data.summary;
      if (failedLines === 0) {
        pushToast({
          variant: 'success',
          title: t('batchToastTitle'),
          message: t('batchToastAllOk', { created: createdItems }),
        });
      } else {
        pushToast({
          variant: 'danger',
          title: t('batchToastTitle'),
          message: t('batchToastPartial', { created: createdItems, failed: failedLines }),
          duration: 9000,
        });
      }
    },
  });

  // P-4.1: al fallar el alta, lleva el banner de error al viewport y mueve el foco (a11y).
  useEffect(() => {
    if ((create.isError || batch.isError) && errorRef.current) {
      // `scrollIntoView` no existe en jsdom (tests) → optional call defensivo.
      errorRef.current.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
      errorRef.current.focus();
    }
  }, [create.isError, batch.isError]);

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
      {/* Viewport de toasts (portal a <body>, z-[60]) — visible por encima del modal (z-50). */}
      <Toaster toasts={toasts} onDismiss={dismissToast} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-h1 font-bold">{t('title')}</h1>
        {tab === 'pieces' && (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setLocationsOpen(true)}>
              <MapPin size={18} /> {t('locations.button')}
            </Button>
            <Button
              onClick={() => {
                // Nueva alta: limpia el resultado anterior (banner de folio / error) y el lote.
                create.reset();
                batch.reset();
                batchKeyRef.current = null;
                setBatchCards([]);
                setMultiSelect(false);
                // FIX 2: además del estado de mutación/lote, resetea los CAMPOS del formulario
                // (acq/%/tipo/acabado/cert/precio + set/búsqueda/carta) a sus defaults limpios.
                resetAddForm();
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
            {multiSelect ? (
              // P-5: alta MASIVA — un solo envío por lote (batchCreateItems).
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
          {/* P-4.1: zona de feedback ANCLADA ARRIBA (sticky) — el error del alta se ve SIEMPRE,
              sin depender de hacer scroll hasta el fondo del formulario. `errorRef` recibe el
              foco y el scroll al fallar (a11y: role=alert en el Banner). */}
          {(create.isError || batch.isError) && (
            <div ref={errorRef} tabIndex={-1} className="sticky top-0 z-10 -mx-1 bg-bg px-1 pt-1 outline-none">
              <Banner variant="danger" role="alert" title={t('createErrorTitle')}>
                {create.isError ? errorMessage(create.error) : errorMessage(batch.error)}
              </Banner>
            </div>
          )}

          {/* P-5: resultado del alta MASIVA (tolerante por-línea): cuántas se crearon (con folios)
              y cuáles fallaron con su motivo. Se conserva aunque el lote quede vacío tras enviar. */}
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
                    className={`flex items-start gap-2 font-mono text-xs ${
                      r.ok ? 'text-success' : 'text-accent'
                    }`}
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

          {/* P-5: modo de alta MASIVA — marca varias cartas y dalas de alta en un solo envío.
              FIX 1: deshabilitado en `graded` (cert único por pieza ⇒ el alta masiva no aplica). */}
          <label
            className={`flex items-center gap-2 text-sm ${
              productType === 'graded' ? 'text-muted' : 'text-text'
            }`}
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
                // Al cambiar de modo se limpia la selección del otro modo para no confundir.
                if (e.target.checked) setSelectedCard(null);
                else clearBatch();
              }}
            />
            {t('multiSelect')}
          </label>
          {productType === 'graded' && (
            <p className="text-xs text-muted">{t('gradedNoBulk')}</p>
          )}

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
                        aria-multiselectable={multiSelect || undefined}
                      >
                        {cards.map((card) => {
                          // En modo masivo el "activo" = está en el lote; en modo simple = carta elegida.
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
                                  {!multiSelect && active && (
                                    <Check size={16} className="text-primary" aria-hidden />
                                  )}
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

          {/* P-5: "carrito" del lote — cartas marcadas para el alta masiva (solo modo múltiple). */}
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
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => toggleBatch(c)}
                        aria-label={t('batchRemove')}
                      >
                        <Trash2 size={16} />
                      </Button>
                    </li>
                  ))}
                </ul>
                <div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={clearBatch}
                    disabled={batch.isPending}
                  >
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
              // FIX 1 (dinero — integridad de inventario): el alta MASIVA NO admite gradeadas.
              // El certNumber es ÚNICO por slab; un lote aplicaría el mismo cert a N piezas y
              // crearía inventario de alto valor con certificado duplicado. Al pasar a `graded`
              // forzamos selección única y limpiamos cualquier lote ya armado (evita enviar un
              // carrito de gradeadas con cert compartido).
              if (next === 'graded' && multiSelect) {
                setMultiSelect(false);
                clearBatch();
              }
            }}
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
              options={finishOptions.map((f) => ({ value: f, label: tFinish(f) }))}
              value={finishOptions.includes(finish) ? finish : finishOptions[0]}
              onChange={(e) => setFinish(e.target.value as Finish)}
            />
          ) : productType !== 'raw' ? (
            <p className="rounded-md bg-surface-2/60 px-3 py-2 text-sm text-muted">
              {t('finishFixedNormal')}
            </p>
          ) : (
            // Raw con UN solo acabado disponible: se muestra fijo, no se oculta en silencio.
            !multiSelect &&
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
          {/* El error del alta ya NO va al final del formulario (quedaba fuera del viewport):
              se pinta ARRIBA, anclado (sticky), al inicio del cuerpo del modal (P-4.1). */}
        </div>
      </Modal>
      </>
      )}
    </div>
  );
}
