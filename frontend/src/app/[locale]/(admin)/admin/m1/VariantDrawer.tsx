'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
  VariantControlsResponse,
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
import { ItemDetailModal } from './ItemDetailModal';

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
    pricing,
    marketRefCents,
    marketCapturedDate,
    highlightFolio,
    locations = [],
    onClose,
    onChanged,
    onToast,
    onAddGraded,
  } = props;
  const t = useTranslations('admin.drawer');
  const tSpec = useTranslations('finish');
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

  // Gradeadas: el endpoint filtra carta+tipo; el grupo (empresa, grado) se recorta aquí.
  const rows = useMemo(() => {
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

  // Estado vacío = invitación a dar de alta: la sección de alta abre desplegada.
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const emptyKnown = pieces.data != null && rows.length === 0;
  useEffect(() => {
    if (emptyKnown) setQuickAddOpen(true);
  }, [emptyKnown]);

  const [pricesOpen, setPricesOpen] = useState(isSuperAdmin);
  const [highlighted, setHighlighted] = useState<string[]>(highlightFolio ? [highlightFolio] : []);

  const specParts = [
    productType === 'raw'
      ? 'RAW · NM'
      : productType === 'graded'
        ? `GRADED · ${props.gradeInfo ? `${props.gradeInfo.gradingCompany} ${props.gradeInfo.gradeValue}` : ''}`
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
        className="flex h-full w-full flex-col overflow-hidden border-l border-border bg-bg outline-none lg:max-w-[480px]"
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
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="flex flex-col gap-6">
            {quickAddOpen && quickAddTarget && (
              <QuickAddSection
                target={quickAddTarget}
                buyEffectiveCents={pricing?.buy.effectiveCents ?? null}
                buySource={pricing?.buy.source ?? null}
                marketRefCents={marketRefCents ?? null}
                onToast={onToast}
                onCreated={(folios) => {
                  setHighlighted(folios);
                  void pieces.refetch();
                  onChanged?.();
                }}
              />
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
                {pricesOpen && (
                  <VariantPriceConsole
                    cardId={cardId}
                    finish={productType === 'raw' ? finish : 'normal'}
                    productType={productType === 'raw' ? 'raw' : 'graded'}
                    gradeKey={
                      props.gradeInfo
                        ? `graded:${props.gradeInfo.gradingCompany}:${props.gradeInfo.gradeValue}`
                        : undefined
                    }
                    pricing={pricing}
                    marketRefCents={marketRefCents}
                    marketCapturedDate={marketCapturedDate}
                    onToast={onToast}
                    onSaved={(res: VariantControlsResponse) => {
                      void res;
                      onChanged?.();
                    }}
                  />
                )}
              </section>
            )}

            <PiecesSection
              rows={rows}
              query={pieces}
              highlighted={highlighted}
              variantHasOverride={variantHasOverride}
              showCert={productType === 'graded'}
              locations={locations}
              onToast={onToast}
              onChanged={() => {
                void pieces.refetch();
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
  rows,
  query,
  highlighted,
  variantHasOverride,
  showCert,
  locations,
  onToast,
  onChanged,
}: {
  rows: InventoryItemDTO[];
  query: { isLoading: boolean; isError: boolean; error: unknown; refetch: () => unknown; data: unknown };
  highlighted: string[];
  variantHasOverride: boolean;
  showCert: boolean;
  locations: VaultLocationDTO[];
  onToast?: (msg: string) => void;
  onChanged: () => void;
}) {
  const t = useTranslations('admin.drawer');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const errorMessage = useErrorMessage();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
  const [priceInput, setPriceInput] = useState('');
  const [lossItem, setLossItem] = useState<InventoryItemDTO | null>(null);

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

  return (
    <section className="flex flex-col gap-3 border-t border-border pt-4" aria-label={t('pieces', { count: rows.length })}>
      <h3 className="text-h3">{t('pieces', { count: rows.length })}</h3>

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
        {query.data != null &&
          (rows.length === 0 ? (
            <p className="text-sm text-muted">{t('noPieces')}</p>
          ) : (
            <ul className="flex flex-col">
              {rows.map((piece) => {
                const isHighlighted = highlighted.includes(piece.folio);
                const publishable = piece.status === 'in_stock';
                const listed = piece.status === 'listed';
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
                    {/* Precio manual por pieza (gana sobre el de variante). */}
                    {editingPriceId === piece.id ? (
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
                      <button
                        type="button"
                        aria-label={t('markLoss', { folio: piece.folio })}
                        title={t('markLossTitle')}
                        className="flex h-8 w-8 items-center justify-center text-muted hover:text-accent"
                        onClick={() => setLossItem(piece)}
                      >
                        <TriangleAlert size={15} />
                      </button>
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

      <ItemDetailModal itemId={detailId} onClose={() => setDetailId(null)} locations={locations} />
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
  const errorMessage = useErrorMessage();
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
