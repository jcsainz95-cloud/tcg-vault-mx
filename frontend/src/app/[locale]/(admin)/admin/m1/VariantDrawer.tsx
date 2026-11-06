'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { X, Copy, Megaphone, EyeOff, TriangleAlert, FileText, Info } from 'lucide-react';
import {
  getAdminInventory,
  bulkPublishItems,
  updateInventoryItem,
  createInventoryAdjustment,
} from '@/lib/api';
import type {
  Finish,
  InventoryItemDTO,
  ProductType,
  VariantPricingDTO,
  VaultLocationDTO,
  SealedCondition,
  SealedSubtype,
} from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { useRole } from '@/lib/role';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { FinishMark } from '@/components/domain/FinishMark';
import { VariantPriceConsole } from '@/components/master-set/VariantPriceConsole';
import { PerLineErrors } from '@/components/master-set/PerLineErrors';
import { localUid } from '@/components/master-set/capture';
import { QuickAddSection, type QuickAddTarget } from './QuickAdd';
import { PieceVersion, PieceVersionFilters, type LanguageFilter, type StampFilter } from './PieceVersion';
import { QuickRemoveSection } from './QuickRemove';
import { ItemDetailModal } from './ItemDetailModal';
import { SealedFinalPrice } from './SealedFinalPrice';
import { SealedPiecePriceLabel } from './SealedPiecePriceLabel';
import { SealedProductPriceBlock } from './SealedProductPriceBlock';
import { canEditSealedPiecePrice, canSetSealedPrice, sealedPieceLinkOf } from '@/lib/sealed-price-role';

/**
 * Drill-down de piezas por VARIANTE — P-17 (DESIGN_SYSTEM §16.4). Panel lateral (sheet 480px en
 * ≥lg; hoja a pantalla casi completa en <lg) que concentra TODO lo operable de una variante:
 * alta rápida (P-19), consola de precios (P-18, si `pricing` viene — sellado NO la lleva),
 * y las copias físicas (folio, estado, precio manual por pieza, detalle, publicar, merma).
 * La VENTA no existe aquí (ratificado §4.26c): solo checkout/M3; las bajas son merma por ajuste.
 */

const LOSS_REASONS = ['perdida', 'danada', 'error_captura'] as const;

export interface VariantDrawerProps {
  cardId: string;
  cardName: string;
  cardNumber: string;
  imageSmallUrl?: string;
  finish: Finish;
  productType: ProductType;
  /**
   * A2 (I-6 «Piezas del cajón»): acabados de la carta en el binder (`MasterSetCardCellDTO.availableFinishes` /
   * `CardDTO.availableFinishes`). Con él, la lista de una casilla raw suma las piezas de liga cuyo acabado NO tiene
   * casilla (segunda lectura `stamped=true`). Sin él (sellado, gradeadas, quien no lo sabe) ⇒ solo la lectura de hoy.
   */
  cardFinishes?: Finish[];
  /** Consola P-18 (solo scope platform raw/graded del binder; ausente = no se renderiza). */
  pricing?: VariantPricingDTO;
  marketRefCents?: number | null;
  marketCapturedDate?: string | null;
  /** Solo sellado: identidad del grupo (§4.23) para el alta rápida. */
  sealedSubtype?: SealedSubtype | null;
  sealedCondition?: SealedCondition;
  /** Solo gradeadas: la variante es (carta, empresa, grado). */
  gradeInfo?: { gradingCompany: string; gradeValue: string };
  /** Pieza a resaltar/enfocar (buscador por folio §16.1.1). */
  highlightFolio?: string;
  locations?: VaultLocationDTO[];
  /**
   * §SU-UX.3 (b): ¿`locations` ya llegó del servidor? Se reenvía a la ficha (`ItemDetailModal`), que solo dice
   * «no hay ubicaciones» con `true`. Por defecto `false`: quien no lo sabe no lo afirma.
   */
  locationsReady?: boolean;
  onClose: () => void;
  /** Refresca agregados del binder/pestaña tras alta/publicación/merma/guardado de precios. */
  onChanged?: () => void;
  onToast?: (msg: string) => void;
  /** Acción secundaria «Agregar gradeada…» (raw → abre el modal corto P-20). */
  onAddGraded?: () => void;
}

export function VariantDrawer(props: VariantDrawerProps) {
  const {
    cardId,
    cardName,
    cardNumber,
    imageSmallUrl,
    finish,
    productType,
    cardFinishes,
    pricing,
    marketRefCents,
    marketCapturedDate,
    highlightFolio,
    locations = [],
    locationsReady = false,
    onClose,
    onChanged,
    onToast,
    onAddGraded,
  } = props;
  const t = useTranslations('admin.drawer');
  const tSpec = useTranslations('finish');
  const tSub = useTranslations('status.sealedSubtype');
  const { isSuperAdmin } = useRole();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // §IDS-UX.3: filtros de un toque Idioma / Liga en burbujas (solo raw: la versión es solo de raw NM, D-IDS-K).
  const [langFilter, setLangFilter] = useState<LanguageFilter>('all');
  const [stampFilter, setStampFilter] = useState<StampFilter>('all');
  // A2 (I-6 «Piezas del cajón»): la lista de la casilla raw (carta, F) = la lectura de hoy (`finish=F`) ∪ la misma con
  // `stamped=true` SIN `finish`, quedándose con las piezas de liga cuyo acabado no tiene casilla raw en el binder
  // (`cardFinishes`; `Card.availableFinishes` no recibe acabados de liga, IDS.3). Los filtros Idioma/Liga se aplican
  // aquí sobre las dos lecturas (≤ 100 filas cada una; el truncado se dice abajo): así «Piezas (n)» es el total sin
  // filtrar y no cambia con el filtro (IDS-UX.3), y «Sin liga» deja fuera la segunda lectura entera.
  const pieces = useQuery({
    queryKey: ['variant-pieces', cardId, finish, productType, props.gradeInfo?.gradeValue ?? null],
    queryFn: () =>
      getAdminInventory({
        cardId,
        ...(productType === 'raw' ? { finish } : {}),
        productType,
        ownerType: 'platform',
        pageSize: 100,
      }),
  });
  const leagueEnabled = productType === 'raw' && cardFinishes != null;
  const leaguePieces = useQuery({
    queryKey: ['variant-pieces-league', cardId, productType],
    queryFn: () => getAdminInventory({ cardId, productType, ownerType: 'platform', pageSize: 100, stamped: 'true' }),
    enabled: leagueEnabled,
  });

  // Gradeadas: el endpoint filtra carta+tipo; el grupo (empresa, grado) se recorta aquí.
  const slotRows = useMemo(() => {
    let data = pieces.data?.data ?? [];
    if (props.gradeInfo) {
      data = data.filter(
        (i) =>
          i.gradingCompany === props.gradeInfo!.gradingCompany &&
          i.gradeValue === props.gradeInfo!.gradeValue,
      );
    }
    if (props.sealedSubtype !== undefined || props.sealedCondition !== undefined) {
      data = data.filter(
        (i) =>
          (props.sealedSubtype === undefined || (i.sealedSubtype ?? null) === props.sealedSubtype) &&
          (props.sealedCondition === undefined || (i.sealedCondition ?? 'mint') === props.sealedCondition),
      );
    }
    return data;
  }, [pieces.data, props.gradeInfo, props.sealedSubtype, props.sealedCondition]);
  // Segunda lectura: solo las piezas cuyo acabado no tiene casilla (las que sí la tienen viven en SU casilla).
  const leagueRows = useMemo(() => {
    if (!leagueEnabled || !cardFinishes) return [];
    return (leaguePieces.data?.data ?? []).filter((i) => !cardFinishes.includes((i.finish ?? 'normal') as Finish));
  }, [leagueEnabled, cardFinishes, leaguePieces.data]);
  const allRows = useMemo(() => {
    const seen = new Set(slotRows.map((r) => r.id));
    return [...slotRows, ...leagueRows.filter((r) => !seen.has(r.id))];
  }, [slotRows, leagueRows]);
  const filtersActive = productType === 'raw' && (langFilter !== 'all' || stampFilter !== 'all');
  const matchesFilters = (i: InventoryItemDTO) =>
    (langFilter === 'all' || (i.version?.language ?? 'en') === langFilter) &&
    (stampFilter === 'all' || (i.version?.stamp != null) === (stampFilter === 'true'));
  const rows = useMemo(() => (filtersActive ? allRows.filter(matchesFilters) : allRows), [allRows, filtersActive, langFilter, stampFilter]); // eslint-disable-line react-hooks/exhaustive-deps
  // Pista del cajón (IDS-UX.3): alguna fila con versión ≠ inglés sin liga ⇒ esas piezas no cuentan en la casilla.
  const anyNonDefault = allRows.some((i) => i.version != null && (i.version.language !== 'en' || i.version.stamp != null));

  // Estado vacío = invitación a dar de alta: la sección de alta abre desplegada (vacío = las DOS lecturas sin piezas).
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickRemoveOpen, setQuickRemoveOpen] = useState(false);
  const emptyKnown = pieces.data != null && (!leagueEnabled || leaguePieces.data != null) && allRows.length === 0;
  useEffect(() => {
    if (emptyKnown) setQuickAddOpen(true);
  }, [emptyKnown]);

  // Conteo VISIBLE de piezas ajustables para la baja rápida (P-29): SOLO la primera lectura (la casilla), como hoy;
  // las piezas de liga sin casilla no se dan de baja desde aquí (I-6). Sumo solo las que el backend deja ajustar.
  // TL-A2-5: SIN los filtros Idioma/Liga (son de vista): `bulk-remove` opera sobre la casilla entera, así que el conteo también.
  const removableCount = slotRows.filter((r) => r.status === 'in_stock' || r.status === 'listed').length;
  const refetchPieces = () => {
    void pieces.refetch();
    if (leagueEnabled) void leaguePieces.refetch();
  };

  const [pricesOpen, setPricesOpen] = useState(isSuperAdmin);
  const [highlighted, setHighlighted] = useState<string[]>(highlightFolio ? [highlightFolio] : []);

  const specParts = [
    productType === 'raw'
      ? 'RAW · NM'
      : productType === 'graded'
        ? `GRADED · ${props.gradeInfo ? `${props.gradeInfo.gradingCompany} ${props.gradeInfo.gradeValue}` : ''}`
        : // SELLADO-M1(C): el desglose de FORMATO (Bundle/Booster Box/ETB…) YA viaja como prop
          // `sealedSubtype`; se pintaba «SELLADO» a secas y el subtipo se perdía en el drill-down.
          // Display-only passthrough del campo que el drawer ya recibe.
          props.sealedSubtype
          ? `SELLADO · ${tSub(props.sealedSubtype).toUpperCase()}`
          : 'SELLADO',
    productType === 'raw' ? tSpec(finish).toUpperCase() : null,
  ].filter(Boolean);

  const quickAddTarget: QuickAddTarget | null =
    productType === 'graded'
      ? null
      : {
          cardId,
          productType: productType as 'raw' | 'sealed',
          finish: productType === 'raw' ? finish : 'normal',
          sealedSubtype: props.sealedSubtype,
          sealedCondition: props.sealedCondition,
        };

  const variantHasOverride = pricing?.sell.overrideCents != null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-[rgba(26,26,24,.55)]"
      onClick={onClose}
      data-testid="variant-drawer-overlay"
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`${cardName} · ${specParts.join(' · ')}`}
        onClick={(e) => e.stopPropagation()}
        // `min-w-0`: el cajón es un flex item; sin esto, cualquier hijo con `nowrap` más ancho que el viewport lo ensancha
        // por `min-width:auto` (medido a 390 px el 2026-11-05 con el desglose de precio: cajón de ≈405 px).
        className="flex h-full w-full min-w-0 flex-col overflow-hidden border-l border-border bg-bg outline-none lg:max-w-[480px]"
      >
        {/* Header */}
        <div className="flex shrink-0 items-start gap-3 border-b border-border p-4">
          {imageSmallUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageSmallUrl}
              alt=""
              aria-hidden
              className="h-[78px] w-[56px] shrink-0 bg-surface-2 object-contain"
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <h2 lang="en" className="truncate font-serif text-lg text-text">
              {cardName}
            </h2>
            <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
              <span className="tabular-nums">#{cardNumber}</span>
              <span aria-hidden> · </span>
              {specParts.join(' · ')}
            </p>
            {productType === 'raw' && <FinishMark finish={finish} className="mt-1.5" band />}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('close')}
            className="flex h-11 w-11 items-center justify-center text-muted hover:text-text focus-visible:shadow-focus focus-visible:outline-none"
          >
            <X size={20} />
          </button>
        </div>

        {/* CTA primario de alta — SIEMPRE visible bajo el header (no scrollea). */}
        <div className="flex shrink-0 flex-wrap gap-2 border-b border-border p-4">
          {quickAddTarget ? (
            <Button className="flex-1" onClick={() => setQuickAddOpen((v) => !v)} aria-expanded={quickAddOpen}>
              {t('addQuick')}
            </Button>
          ) : (
            onAddGraded && (
              <Button className="flex-1" onClick={onAddGraded}>
                {t('addGraded')}
              </Button>
            )
          )}
          {productType === 'raw' && onAddGraded && (
            <Button variant="secondary" onClick={onAddGraded}>
              {t('addGraded')}
            </Button>
          )}
          {/* Baja rápida (P-29): simétrica al alta rápida; solo raw/sellado (graded no la lleva). */}
          {quickAddTarget && (
            <Button
              variant="secondary"
              onClick={() => setQuickRemoveOpen((v) => !v)}
              aria-expanded={quickRemoveOpen}
            >
              {t('removeQuick')}
            </Button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="flex flex-col gap-6">
            {quickAddOpen && quickAddTarget && (
              // Sin toast en el cajón (vIDS-10 §16.5 (b), MENOR-4): el banner del panel (`role="status"`) es el único
              // aviso de éxito; el toast tapaba ~130 px del pie a 390.
              <QuickAddSection
                target={quickAddTarget}
                buyEffectiveCents={pricing?.buy.effectiveCents ?? null}
                buySource={pricing?.buy.source ?? null}
                marketRefCents={marketRefCents ?? null}
                onCreated={(folios) => {
                  setHighlighted(folios);
                  refetchPieces();
                  onChanged?.();
                }}
              />
            )}

            {/* Baja rápida (P-29): da de baja N piezas de la variante de un golpe. */}
            {quickRemoveOpen && quickAddTarget && (
              <section className="flex flex-col gap-3 border-t border-border pt-4">
                <h3 className="text-h3">{t('removeQuick')}</h3>
                <QuickRemoveSection
                  // `QuickAddTarget.cardId` es opcional (H-P38-5: el alta de sellado por identidad lo
                  // omite), pero la BAJA rápida SIEMPRE opera una variante anclada a una Card real —
                  // aquí `cardId` es el prop (string) del drawer, así que se re-afirma para el target.
                  target={{ ...quickAddTarget, cardId }}
                  removableCount={removableCount}
                  onToast={onToast}
                  onRemoved={() => {
                    refetchPieces();
                    onChanged?.();
                  }}
                />
              </section>
            )}

            {/* Sección «Precios» (P-18) — colapsable; NO existe para sellado (cadena H-1). */}
            {pricing && productType !== 'sealed' && (
              <section className="flex flex-col gap-3 border-t border-border pt-4">
                <button
                  type="button"
                  className="flex items-center justify-between text-left"
                  aria-expanded={pricesOpen}
                  onClick={() => setPricesOpen((v) => !v)}
                >
                  <h3 className="text-h3">{t('prices')}</h3>
                  <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted">
                    {pricesOpen ? t('collapse') : t('expand')}
                  </span>
                </button>
                {/* M-1: la consola mantiene su pricing resuelto; aquí solo refrescamos agregados.
                    gradeKey es clave de dinero: en graded lo exige el tipo (sin default mágico). */}
                {pricesOpen &&
                  (productType === 'raw' ? (
                    <VariantPriceConsole
                      cardId={cardId}
                      finish={finish}
                      productType="raw"
                      pricing={pricing}
                      marketRefCents={marketRefCents}
                      marketCapturedDate={marketCapturedDate}
                      onToast={onToast}
                      onChanged={onChanged}
                    />
                  ) : props.gradeInfo ? (
                    <VariantPriceConsole
                      cardId={cardId}
                      finish="normal"
                      productType="graded"
                      gradeKey={`graded:${props.gradeInfo.gradingCompany}:${props.gradeInfo.gradeValue}`}
                      pricing={pricing}
                      marketRefCents={marketRefCents}
                      marketCapturedDate={marketCapturedDate}
                      onToast={onToast}
                      onChanged={onChanged}
                    />
                  ) : null)}
              </section>
            )}

            <PiecesSection
              // UX-ALTA-LIGA (2026-11-05): los filtros Idioma/Liga de la LISTA van bajo el título «Piezas (n)», rotulados
              // «Filtrar piezas» — nunca entre los botones y el panel de alta, donde se confundían con la versión del alta.
              filters={
                productType === 'raw' ? (
                  <PieceVersionFilters
                    language={langFilter}
                    stamped={stampFilter}
                    onLanguage={setLangFilter}
                    onStamped={setStampFilter}
                  />
                ) : null
              }
              rows={rows}
              unfilteredCount={allRows.length}
              filtered={filtersActive}
              onClearFilters={() => {
                setLangFilter('all');
                setStampFilter('all');
              }}
              showSlotNote={productType === 'raw' && anyNonDefault}
              query={{
                isLoading: pieces.isLoading || (leagueEnabled && leaguePieces.isLoading),
                isError: pieces.isError || (leagueEnabled && leaguePieces.isError),
                error: pieces.error ?? leaguePieces.error,
                refetch: refetchPieces,
                data: pieces.data,
              }}
              fetchedCount={pieces.data?.data.length ?? 0}
              totalCount={pieces.data?.total ?? 0}
              highlighted={highlighted}
              variantHasOverride={variantHasOverride}
              showCert={productType === 'graded'}
              sealed={productType === 'sealed' ? { name: cardName, marketRefCents: marketRefCents ?? null } : null}
              locations={locations}
              locationsReady={locationsReady}
              onToast={onToast}
              onChanged={() => {
                refetchPieces();
                onChanged?.();
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sección «Piezas (N)» — folio, estado, precio manual por pieza, acciones + selección múltiple.
// ---------------------------------------------------------------------------

function PiecesSection({
  filters,
  rows,
  unfilteredCount,
  filtered = false,
  onClearFilters,
  showSlotNote = false,
  query,
  fetchedCount,
  totalCount,
  highlighted,
  variantHasOverride,
  showCert,
  sealed,
  locations,
  locationsReady,
  onToast,
  onChanged,
}: {
  /** Filtros de la LISTA (Idioma/Liga, solo raw): se pintan bajo el título con el eyebrow «Filtrar piezas». */
  filters?: ReactNode;
  /** Filas VISIBLES (con los filtros aplicados). */
  rows: InventoryItemDTO[];
  /** «Piezas (n)»: el total de la casilla SIN filtrar (IDS-UX.3: no cambia con el filtro). Por defecto, `rows.length`. */
  unfilteredCount?: number;
  /** ¿Hay un filtro Idioma/Liga activo? ⇒ «Mostrando n de N» y el vacío filtrado con «Quitar filtros» (§16.4 punto 5). */
  filtered?: boolean;
  onClearFilters?: () => void;
  /** Pista del cajón (IDS-UX.3): alguna fila no es inglés sin liga ⇒ «La casilla cuenta solo inglés sin liga…». */
  showSlotNote?: boolean;
  query: { isLoading: boolean; isError: boolean; error: unknown; refetch: () => unknown; data: unknown };
  /** Piezas que el servidor devolvió vs. total real — honestidad del truncado (M-2). */
  fetchedCount: number;
  totalCount: number;
  highlighted: string[];
  variantHasOverride: boolean;
  showCert: boolean;
  /**
   * §39.2 (c): SOLO sellado ⇒ el precio por pieza es `SealedFinalPrice` con rótulo visible. `null` (raw/graded) ⇒
   * el código de siempre, sin tocar (P-PRE-1: «se conserva como está, sin hacerlo más visible»).
   */
  sealed: { name: string; marketRefCents: number | null } | null;
  locations: VaultLocationDTO[];
  locationsReady: boolean;
  onToast?: (msg: string) => void;
  onChanged: () => void;
}) {
  const t = useTranslations('admin.drawer');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const errorMessage = useErrorMessage('operator');

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
  const [priceInput, setPriceInput] = useState('');
  const [lossItem, setLossItem] = useState<InventoryItemDTO | null>(null);
  const [sealedEditingId, setSealedEditingId] = useState<string | null>(null);
  const { role } = useRole();
  const canSetPrice = canSetSealedPrice(role);
  /**
   * §M11-SP.12.7 / 13.5 — en sellado se decide por `sealedProductId` de la fila: `string` ⇒ ligada (precio del
   * PRODUCTO, un bloque encima de la lista), `null` ⇒ sin producto (precio por pieza, antes de IVA, solo el dueño).
   * Clave ausente ⇒ sin bloque y la pieza en solo lectura (falla cerrado; §13.5.1, `sealedPieceLinkOf`).
   */
  const linkedProducts = useMemo(() => {
    if (!sealed) return [];
    const byId = new Map<string, InventoryItemDTO[]>();
    for (const r of rows) {
      if (typeof r.sealedProductId === 'string') {
        const list = byId.get(r.sealedProductId) ?? [];
        list.push(r);
        byId.set(r.sealedProductId, list);
      }
    }
    return [...byId.entries()];
  }, [rows, sealed]);

  // batchKey estable por sesión de publicación (replay idempotente en reintentos).
  const publishKeyRef = useRef<string | null>(null);
  function ensurePublishKey(): string {
    if (publishKeyRef.current === null) publishKeyRef.current = localUid('pub');
    return publishKeyRef.current;
  }

  const publish = useMutation({
    mutationFn: (ids: string[]) =>
      bulkPublishItems({
        batchKey: ensurePublishKey(),
        items: ids.map((inventoryItemId) => ({ inventoryItemId })),
        repriceFresh: true,
      }),
    onSuccess: () => {
      publishKeyRef.current = null;
      setSelected(new Set());
      onChanged();
    },
  });

  const unpublish = useMutation({
    mutationFn: (id: string) => updateInventoryItem(id, { status: 'in_stock' }),
    onSuccess: () => onChanged(),
  });

  const editPrice = useMutation({
    mutationFn: ({ id, cents }: { id: string; cents: number }) =>
      updateInventoryItem(id, { listPriceCents: cents }),
    onSuccess: () => {
      setEditingPriceId(null);
      onChanged();
    },
  });

  function copyFolio(folio: string) {
    void navigator.clipboard?.writeText(folio);
    onToast?.(t('folioCopied'));
  }

  const publishResults = publish.data?.results ?? [];
  const count = unfilteredCount ?? rows.length;

  return (
    <section className="flex flex-col gap-3 border-t border-border pt-4" aria-label={t('pieces', { count })}>
      <h3 className="text-h3">{t('pieces', { count })}</h3>

      {/* Pista del cajón (IDS-UX.3, vIDS-10): bajo «Piezas (n)» y sobre «Filtrar piezas»; sin `role`; hasta dos líneas a 390. */}
      {showSlotNote && <p className="text-xs text-muted">{t('slotCountNote')}</p>}

      {filters && (
        <div className="flex flex-col gap-2">
          <span className="eyebrow">{t('filterPieces')}</span>
          {filters}
          {filtered && (
            <p className="text-xs text-muted" role="status">
              {t('showingFiltered', { shown: rows.length, total: count })}
            </p>
          )}
        </div>
      )}

      {/* M-2: el endpoint capea a 100 (pageSize máx del contrato) — el truncado se DICE, no se
          esconde (la lista no es todo lo que hay para esta carta). */}
      {totalCount > fetchedCount && (
        <p className="text-xs text-muted" role="status">
          {t('truncated', { shown: fetchedCount, total: totalCount })}
        </p>
      )}

      {/* Nota única: el precio POR PIEZA gana sobre el precio de la variante. */}
      {variantHasOverride && rows.length > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <Info size={14} aria-hidden /> {t('pieceOverridesVariant')}
        </p>
      )}

      <QueryState
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={() => query.refetch()}
      >
        {/* §70.3 (a): «Precio del producto · N piezas», UNA vez encima de la lista, por producto ligado. */}
        {sealed &&
          linkedProducts.map(([productId, productRows]) => (
            <SealedProductPriceBlock
              key={productId}
              productId={productId}
              name={sealed.name}
              rows={productRows}
              canSet={canSetPrice}
              onChanged={onChanged}
            />
          ))}
        {query.data != null &&
          (rows.length === 0 ? (
            filtered && count > 0 ? (
              // §16.4 punto 5 (vIDS-10): nunca «Sin piezas de esta variante» con piezas ocultas por el filtro.
              <div className="flex flex-col items-start gap-1">
                <p className="text-sm text-muted">{t('emptyFiltered')}</p>
                <button
                  type="button"
                  onClick={onClearFilters}
                  className="min-h-11 px-0 text-sm font-medium text-text underline-offset-4 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
                >
                  {t('clearFilters')}
                </button>
              </div>
            ) : (
              <p className="text-sm text-muted">{t('noPieces')}</p>
            )
          ) : (
            <ul className="flex flex-col">
              {rows.map((piece) => {
                const isHighlighted = highlighted.includes(piece.folio);
                const publishable = piece.status === 'in_stock';
                const listed = piece.status === 'listed';
                // Reglas de pantalla del contrato (§M1 v1.79.6 «5»; QA menor sobre `4ca6c45`, 2026-09-29):
                // - «Merma» solo en `in_stock|listed` (= `ITEM_NOT_ADJUSTABLE`, el mismo predicado que
                //   `removableCount`); ⛔ nunca `picking` (el backend la rechazaba con 422) ni `reserved`.
                // - «Editar precio» ⛔ no sobre una pieza VENDIDA (`picking`; y `shipped|delivered`, que
                //   son la misma pieza más tarde): su precio ya es el de la línea del pedido. Se sigue
                //   LEYENDO. Sobre `reserved` el contrato no norma nada y aquí no se cambia.
                const markable = publishable || listed;
                const sold =
                  piece.status === 'picking' || piece.status === 'shipped' || piece.status === 'delivered';
                return (
                  <li
                    key={piece.id}
                    className={`flex min-h-[48px] flex-wrap items-center gap-x-3 gap-y-1 border-b border-border py-2 ${
                      isHighlighted ? 'bg-surface-2' : ''
                    }`}
                  >
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        aria-label={t('selectPiece', { folio: piece.folio })}
                        checked={selected.has(piece.id)}
                        disabled={!publishable}
                        onChange={() =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (next.has(piece.id)) next.delete(piece.id);
                            else next.add(piece.id);
                            return next;
                          })
                        }
                        className="h-4 w-4 accent-[color:var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-40"
                      />
                    </label>
                    <button
                      type="button"
                      className="font-mono tabular-nums text-xs text-text hover:text-accent"
                      title={t('copyFolio')}
                      onClick={() => copyFolio(piece.folio)}
                    >
                      {piece.folio} <Copy size={12} className="inline" aria-hidden />
                    </button>
                    {showCert && piece.certNumber && (
                      <button
                        type="button"
                        className="font-mono tabular-nums text-xs text-muted hover:text-accent"
                        title={t('copyCert')}
                        onClick={() => {
                          void navigator.clipboard?.writeText(piece.certNumber!);
                          onToast?.(t('certCopied'));
                        }}
                      >
                        CERT {piece.certNumber}
                      </button>
                    )}
                    <StatusBadge domain="inventory" value={piece.status} />
                    {/* §IDS-UX.3: Idioma (EN gris / «Español») y Liga (insignia + tipo exacto, o —); solo raw. */}
                    {piece.productType === 'raw' && <PieceVersion version={piece.version} />}
                    {sealedPieceLinkOf(piece) === 'linked' ? (
                      /* §70.3 (a): pieza LIGADA ⇒ solo lectura; el precio es del producto (bloque de arriba). */
                      <span className="ml-auto">
                        <SealedPiecePriceLabel
                          id={piece.id}
                          origin={piece.sealedPriceOrigin}
                          resolvedDisplayPriceCents={piece.resolvedDisplayPriceCents}
                        />
                      </span>
                    ) : sealed ? (
                      <span className="ml-auto">
                        <SealedFinalPrice
                          layout="panel"
                          piece={{
                            id: piece.id,
                            folio: piece.folio,
                            status: piece.status,
                            ownerType: piece.ownerType,
                            hasLocation: piece.location != null,
                            listPriceCents: piece.listPriceCents ?? null,
                            resolvedSalePriceCents: piece.resolvedSalePriceCents,
                            resolvedDisplayPriceCents: piece.resolvedDisplayPriceCents,
                            priceBasis: piece.priceBasis,
                            name: sealed.name,
                            marketRefCents: sealed.marketRefCents,
                          }}
                          // §M11-SP.13.5.1: sin producto solo el dueño; clave ausente ⇒ nadie (falla cerrado).
                          canEdit={canEditSealedPiecePrice(role, piece)}
                          staffNote={sealedPieceLinkOf(piece) === 'unlinked' && !canSetPrice}
                          editing={sealedEditingId === piece.id}
                          onEditingChange={(open) => setSealedEditingId(open ? piece.id : null)}
                          onDone={(msg) => {
                            onToast?.(msg);
                            onChanged();
                          }}
                        />
                      </span>
                    ) : /* Precio manual por pieza (gana sobre el de variante). */
                    editingPriceId === piece.id ? (
                      <span className="flex items-end gap-2">
                        <Input
                          label={t('editPriceLabel')}
                          prefix="MX$"
                          inputMode="decimal"
                          className="w-24"
                          value={priceInput}
                          onChange={(e) => setPriceInput(e.target.value)}
                          error={
                            priceInput.trim() !== '' && !(Number(priceInput) > 0)
                              ? t('priceMustBePositive')
                              : undefined
                          }
                        />
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={editPrice.isPending}
                          disabled={editPrice.isPending || !(Number(priceInput) > 0)}
                          onClick={() =>
                            editPrice.mutate({
                              id: piece.id,
                              cents: Math.round(Number(priceInput) * 100),
                            })
                          }
                        >
                          {tc('save')}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingPriceId(null)}>
                          {tc('cancel')}
                        </Button>
                      </span>
                    ) : sold ? (
                      <span className="ml-auto font-mono tabular-nums text-xs text-text">
                        {piece.listPriceCents != null
                          ? formatMoneyCents(piece.listPriceCents, locale)
                          : '—'}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="ml-auto font-mono tabular-nums text-xs text-text hover:text-accent"
                        aria-label={t('editPrice', { folio: piece.folio })}
                        onClick={() => {
                          setEditingPriceId(piece.id);
                          setPriceInput(
                            piece.listPriceCents != null ? String(piece.listPriceCents / 100) : '',
                          );
                        }}
                      >
                        {piece.listPriceCents != null
                          ? formatMoneyCents(piece.listPriceCents, locale)
                          : '—'}
                      </button>
                    )}
                    {/* Acciones por fila: detalle · publicar/despublicar · merma. */}
                    <span className="flex items-center gap-1">
                      <button
                        type="button"
                        aria-label={t('viewDetail', { folio: piece.folio })}
                        title={t('viewDetailTitle')}
                        className="flex h-8 w-8 items-center justify-center text-muted hover:text-text"
                        onClick={() => setDetailId(piece.id)}
                      >
                        <FileText size={15} />
                      </button>
                      {listed ? (
                        <button
                          type="button"
                          aria-label={t('unpublish', { folio: piece.folio })}
                          title={t('unpublishTitle')}
                          className="flex h-8 w-8 items-center justify-center text-muted hover:text-text"
                          onClick={() => unpublish.mutate(piece.id)}
                        >
                          <EyeOff size={15} />
                        </button>
                      ) : (
                        publishable && (
                          <button
                            type="button"
                            aria-label={t('publish', { folio: piece.folio })}
                            title={t('publishTitle')}
                            className="flex h-8 w-8 items-center justify-center text-muted hover:text-text"
                            onClick={() => publish.mutate([piece.id])}
                          >
                            <Megaphone size={15} />
                          </button>
                        )
                      )}
                      {markable && (
                        <button
                          type="button"
                          aria-label={t('markLoss', { folio: piece.folio })}
                          title={t('markLossTitle')}
                          className="flex h-8 w-8 items-center justify-center text-muted hover:text-accent"
                          onClick={() => setLossItem(piece)}
                        >
                          <TriangleAlert size={15} />
                        </button>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          ))}
      </QueryState>

      {/* Barra de acciones de lote. */}
      {selected.size > 0 && (
        <Button
          onClick={() => publish.mutate([...selected])}
          loading={publish.isPending}
          disabled={publish.isPending}
        >
          {t('publishSelection', { count: selected.size })}
        </Button>
      )}
      {publish.data && (
        <div className="flex flex-col gap-2">
          <Banner variant={publish.data.summary.failedLines > 0 ? 'warning' : 'success'} role="status">
            {t('publishResult', {
              published: publish.data.summary.published,
              failed: publish.data.summary.failedLines,
            })}
          </Banner>
          <PerLineErrors
            lines={publishResults.map((r) => ({
              ok: r.ok,
              label: rows.find((p) => p.id === r.inventoryItemId)?.folio ?? r.inventoryItemId,
              code: r.ok ? undefined : r.error.code,
              message: r.ok ? undefined : r.error.message,
            }))}
          />
        </div>
      )}
      {(publish.isError || unpublish.isError || editPrice.isError) && (
        <Banner variant="danger" role="alert">
          {errorMessage(publish.error ?? unpublish.error ?? editPrice.error)}
        </Banner>
      )}

      {/* Merma (§7.6, confirmación destructiva): motivo + nota OBLIGATORIA. */}
      {lossItem && (
        <LossModal
          item={lossItem}
          onClose={() => setLossItem(null)}
          onDone={() => {
            setLossItem(null);
            onChanged();
          }}
        />
      )}

      <ItemDetailModal itemId={detailId} onClose={() => setDetailId(null)} locations={locations} locationsReady={locationsReady} />
    </section>
  );
}

function LossModal({
  item,
  onClose,
  onDone,
}: {
  item: InventoryItemDTO;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('admin.drawer.loss');
  const ta = useTranslations('masterSet.adjust');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage('operator');
  const [reason, setReason] = useState<(typeof LOSS_REASONS)[number]>('perdida');
  const [note, setNote] = useState('');

  const adjust = useMutation({
    mutationFn: () => createInventoryAdjustment({ reason, inventoryItemId: item.id, note: note.trim() }),
    onSuccess: () => onDone(),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={t('title', { folio: item.folio })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button
            variant="destructive"
            onClick={() => adjust.mutate()}
            disabled={note.trim() === '' || adjust.isPending}
            loading={adjust.isPending}
          >
            {t('confirm')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">{t('body')}</p>
        <Select
          label={ta('reasonLabel')}
          options={LOSS_REASONS.map((r) => ({ value: r, label: ta(`reason.${r}`) }))}
          value={reason}
          onChange={(e) => setReason(e.target.value as (typeof LOSS_REASONS)[number])}
        />
        <Input label={ta('noteRequired')} value={note} onChange={(e) => setNote(e.target.value)} />
        {adjust.isError && (
          <Banner variant="danger" role="alert">
            {errorMessage(adjust.error)}
          </Banner>
        )}
      </div>
    </Modal>
  );
}
