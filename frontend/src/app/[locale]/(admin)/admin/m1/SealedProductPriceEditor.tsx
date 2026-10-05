'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Pencil } from 'lucide-react';
import { setSealedProductSalePrice } from '@/lib/api';
import { asApiError } from '@/lib/api-client';
import { formatMoneyCents, formatSignedMoneyCents } from '@/lib/format';
import type { AppLocale } from '@/i18n/routing';
import type {
  SealedAutoPublishDTO,
  SealedPriceSheetResponse,
  SealedPriceSheetRowDTO,
  SealedProductPiecesDTO,
} from '@/types/contract';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { useErrorMessage } from '@/components/ui/QueryState';
import { parseFinalPrice } from './SealedFinalPrice';
import {
  formatBpsPct,
  marginPreview,
  MAX_LIST_PRICE_CENTS,
  SEALED_FINAL_PRICE_INVALIDATES,
} from './sealed-final-price';

/** Lo que el editor necesita del producto. Todo sale de UNA fila que lo trae (hoja, listado S-2 o cola). */
export interface SealedProductPriceTarget {
  /** `SealedProduct.id`. */
  id: string;
  /** El nombre que ya pinta la fila (§M11-SP.13.7). */
  name: string;
  /**
   * 💰 El `P` del dueño **que la pantalla pintó**: es el `expectedDisplayPriceCents` del `PUT` (F-SP-2). En la hoja,
   * `ownerDisplayPriceCents`; en panel y cola, `sealedProductDisplayPriceCents` de una fila S-2 / `sealed` del mismo
   * producto (§M11-SP.13.7). ⛔ Nunca de otra fuente.
   */
  ownerDisplayPriceCents: number | null;
  /** Lo que paga hoy el cliente (con IVA) si no hay precio del dueño; solo para la línea «Ahora». */
  displayPriceCents?: number | null;
  effectiveOrigin?: 'product' | 'automatic' | 'pending';
  /** Conteo del producto (`pieces` de la hoja / `sealedProductPieces`). Ausente ⇒ «todas sus piezas». */
  pieces?: SealedProductPiecesDTO | null;
  legacy?: { count: number; shadowed: boolean } | null;
  /** Solo la hoja: costo promedio para el margen en vivo. */
  avgCostCents?: number | null;
}

/** Resultado de un `200`, para que el sitio que monta el editor pinte el aviso (§70.2 (d)). */
export interface SealedProductPriceSaved {
  name: string;
  displayPriceCents: number | null;
  pieces: number;
  autoPublish: SealedAutoPublishDTO | null;
}

const total = (p: SealedProductPiecesDTO) => p.inStock + p.listed + p.reserved;

/**
 * 💰 **El editor del precio del PRODUCTO sellado** (`DESIGN_SYSTEM §70.2 (d)`, `API_CONTRACT §M11-SP.12.4–12.6` y
 * `§M11-SP.13.7`). **Uno** solo, montado en la hoja, en el panel de la presentación y en la cola (regla dura 1).
 *
 * - El dueño escribe **`P` con IVA**: lo tecleado **es** lo que paga el cliente y es lo que viaja,
 *   `displayPriceCents = parseFinalPrice(texto).cents`, ⛔ sin ninguna cuenta (F-SP-7, UX-SP-17).
 * - `expectedDisplayPriceCents` = el `ownerDisplayPriceCents` **pintado al abrir** (F-SP-2). Tras un `409` pasa a ser
 *   el que dice el servidor, y la hoja se recarga sola.
 * - Margen en vivo solo con costo **y** tasa (`marginPreview`, UX-SP-8). Panel y cola no traen ninguno ⇒ sin línea.
 * - Tras el `200`, el aviso lo dicen las cuentas de **`autoPublish`** (F-SP-8); ⛔ nunca se deduce comparando `pieces`.
 * - ⛔ Sin casilla «publicar también» ni `bulkPublishItems` (A-2 aceptada: el servidor publica solo, UX-SP-20).
 *
 * Solo se monta para quien puede fijar el precio (la hoja: `canEdit`; panel y cola: `canSetSealedPrice`): lo que no se
 * puede hacer no se pinta (§8).
 */
export function SealedProductPriceEditor({
  product,
  ivaRatePct,
  editing,
  onEditingChange,
  onDone,
  triggerVariant = 'short',
}: {
  product: SealedProductPriceTarget;
  /** `iva.ratePct` de la hoja. Ausente (panel, cola) ⇒ sin margen en vivo. */
  ivaRatePct?: number | null;
  editing: boolean;
  onEditingChange: (open: boolean) => void;
  onDone: (saved: SealedProductPriceSaved) => void;
  /** `short` = «Poner precio» / «Cambiar» (hoja); `product` = «… precio del producto» (panel y cola). */
  triggerVariant?: 'short' | 'product';
}) {
  const t = useTranslations('admin.sealedProductPrice');
  const tf = useTranslations('admin.sealedFinalPrice');
  const tSheet = useTranslations('admin.m11.priceSheet');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const qc = useQueryClient();
  const getError = useErrorMessage('operator');

  const [text, setText] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  /** `action`: `reload` (404) o `retry` (red / otro); el `409` se recarga solo y no lleva botón. */
  const [error, setError] = useState<{ text: string; action?: 'reload' | 'retry' } | null>(null);
  /** El `expected` se FIJA al abrir (F-SP-2): ⛔ no se relee de la fila al enviar. */
  const [expected, setExpected] = useState<number | null>(product.ownerDisplayPriceCents);
  const awaitingReload = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [cancelEl, setCancelEl] = useState<HTMLButtonElement | null>(null);
  const returnFocus = useRef(false);

  useEffect(() => {
    if (editing) {
      // Prellenado: el precio del dueño, o VACÍO (⛔ el automático: el campo es para decidir un número, UX-SP-3).
      setText(product.ownerDisplayPriceCents != null ? (product.ownerDisplayPriceCents / 100).toFixed(2) : '');
      setExpected(product.ownerDisplayPriceCents);
      awaitingReload.current = false;
      setError(null);
      setTimeout(() => inputRef.current?.focus(), 0);
    } else if (returnFocus.current) {
      returnFocus.current = false;
      triggerRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  // Tras un `409`, la fila recargada trae el precio nuevo: ése pasa a ser el `expected` (§70.2 (d), errores).
  useEffect(() => {
    if (awaitingReload.current) {
      awaitingReload.current = false;
      setExpected(product.ownerDisplayPriceCents);
    }
  }, [product.ownerDisplayPriceCents]);

  useEffect(() => {
    if (confirmOpen && cancelEl) setTimeout(() => cancelEl.focus(), 0);
  }, [confirmOpen, cancelEl]);

  const parsed = parseFinalPrice(text);
  const cents = parsed && 'cents' in parsed ? parsed.cents : null;
  const fieldError =
    parsed && 'error' in parsed ? tf(parsed.error, { max: formatMoneyCents(MAX_LIST_PRICE_CENTS, locale) }) : undefined;
  const unchanged = cents !== null && cents === product.ownerDisplayPriceCents;
  const canSubmit = cents !== null && !unchanged;
  const hasOwner = product.ownerDisplayPriceCents != null;

  function invalidate() {
    for (const key of SEALED_FINAL_PRICE_INVALIDATES) void qc.invalidateQueries({ queryKey: [key] });
  }

  const mutation = useMutation({
    // 💰 F-SP-7: lo tecleado, exacto. `expected` = el pintado al abrir (o el del servidor tras un 409).
    mutationFn: (displayPriceCents: number) =>
      setSealedProductSalePrice(product.id, { displayPriceCents, expectedDisplayPriceCents: expected }),
    onMutate: () => setError(null),
    onSuccess: (res) => {
      setConfirmOpen(false);
      // La fila se sustituye por `data` (sin esperar la recarga) y se invalidan las demás vistas.
      qc.setQueriesData<SealedPriceSheetResponse>({ queryKey: ['sealed-price-sheet'] }, (old) =>
        old
          ? { ...old, data: old.data.map((r: SealedPriceSheetRowDTO) => (r.sealedProductId === res.data.sealedProductId ? res.data : r)) }
          : old,
      );
      invalidate();
      returnFocus.current = true;
      onEditingChange(false);
      onDone({
        name: res.data.name,
        displayPriceCents: res.data.ownerDisplayPriceCents,
        pieces: total(res.data.pieces),
        autoPublish: res.autoPublish,
      });
    },
    onError: (e) => {
      // El editor SIGUE abierto con lo tecleado; el error va en un Banner junto al botón (⛔ solo toast).
      setConfirmOpen(false);
      const err = asApiError(e);
      if (err?.status === 409 && err.code === 'CONFLICT') {
        const current = err.details?.currentDisplayPriceCents;
        const currentCents = typeof current === 'number' ? current : null;
        setExpected(currentCents);
        awaitingReload.current = true;
        invalidate(); // automática: sin botón «Recargar» (UX-SP-2)
        setError({
          text:
            currentCents != null
              ? t('errors.conflict', { current: formatMoneyCents(currentCents, locale) })
              : t('errors.conflictNone'),
        });
      } else if (err?.status === 403) {
        invalidate(); // llega `canEdit:false` y el editor desaparece
        setError({ text: t('errors.forbidden') });
      } else if (err?.status === 404) {
        setError({ text: t('errors.notFound'), action: 'reload' });
      } else if (err?.code === 'VALIDATION_ERROR') {
        setError({ text: tf('errors.validation', { max: formatMoneyCents(MAX_LIST_PRICE_CENTS, locale) }) });
      } else {
        setError({ text: getError(e), action: 'retry' });
      }
    },
  });

  function cancel() {
    returnFocus.current = true;
    onEditingChange(false);
  }

  const n = product.pieces ? total(product.pieces) : null;
  const preview = cents !== null ? marginPreview(cents, product.avgCostCents, ivaRatePct) : null;
  const newPrice = cents !== null ? formatMoneyCents(cents, locale) : '';
  const originLabel =
    product.effectiveOrigin === 'automatic' ? tSheet('origin.automatic') : tSheet('origin.product');
  const nowLine = hasOwner
    ? t('confirm.nowOwner', { price: formatMoneyCents(product.ownerDisplayPriceCents!, locale) })
    : product.displayPriceCents != null
      ? t('confirm.nowAuto', { price: formatMoneyCents(product.displayPriceCents, locale), origin: originLabel })
      : t('confirm.nowNone');

  const triggerText =
    triggerVariant === 'product' ? (hasOwner ? t('changeProduct') : t('setProduct')) : hasOwner ? t('change') : t('set');

  return (
    <span className="flex flex-col gap-2">
      {!editing ? (
        <Button
          ref={triggerRef}
          size="sm"
          variant="secondary"
          className="self-start"
          aria-label={hasOwner ? t('changeAria', { name: product.name }) : t('setAria', { name: product.name })}
          onClick={() => onEditingChange(true)}
        >
          <Pencil size={14} aria-hidden /> {triggerText}
        </Button>
      ) : (
        <span className="flex flex-col gap-2" data-testid={`sealed-product-price-editor-${product.id}`}>
          <span className="w-[11rem]">
            <Input
              ref={inputRef}
              label={t('label')}
              prefix="MX$"
              inputMode="decimal"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (canSubmit) setConfirmOpen(true);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  cancel();
                }
              }}
              error={fieldError}
              hint={fieldError ? undefined : t('hint')}
            />
          </span>
          <span className="text-xs text-muted">{n == null ? t('appliesToAll') : t('appliesTo', { n })}</span>
          {preview && (
            <span className="tabular font-mono text-xs text-text" data-testid="sealed-product-price-margin-preview">
              {t('marginPreview', {
                net: formatMoneyCents(preview.netCents, locale),
                cents: formatSignedMoneyCents(preview.cents, locale),
                pct: formatBpsPct(preview.bps, locale),
              })}
            </span>
          )}
          <span className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="primary"
              disabled={!canSubmit || mutation.isPending}
              loading={mutation.isPending}
              onClick={() => setConfirmOpen(true)}
            >
              {t('save')}
            </Button>
            <Button size="sm" variant="ghost" onClick={cancel}>
              {tc('cancel')}
            </Button>
          </span>
          {error && (
            <Banner
              variant="danger"
              role="alert"
              action={
                error.action === 'reload' ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setError(null);
                      invalidate();
                    }}
                  >
                    {t('reload')}
                  </Button>
                ) : error.action === 'retry' && cents !== null ? (
                  <Button size="sm" variant="secondary" onClick={() => mutation.mutate(cents)}>
                    {tc('retry')}
                  </Button>
                ) : undefined
              }
            >
              <p>{error.text}</p>
            </Banner>
          )}
        </span>
      )}

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={t('confirm.title', { name: product.name })}
        footer={
          <>
            <Button ref={setCancelEl} variant="secondary" onClick={() => setConfirmOpen(false)}>
              {tc('cancel')}
            </Button>
            <Button
              variant="primary"
              loading={mutation.isPending}
              disabled={cents === null || mutation.isPending}
              onClick={() => cents !== null && mutation.mutate(cents)}
              data-testid="sealed-product-price-confirm"
            >
              {t('confirm.save', { price: newPrice })}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          <p className="tabular font-mono text-sm">{nowLine}</p>
          <p className="tabular font-mono text-sm">{t('confirm.new', { price: newPrice })}</p>
          {product.pieces && (
            <p className="text-sm">
              {t('confirm.effect', { n: product.pieces.inStock + product.pieces.listed })}
              {product.pieces.reserved > 0 && <> {t('confirm.reserved', { n: product.pieces.reserved })}</>}
            </p>
          )}
          {product.legacy && product.legacy.count > 0 && !product.legacy.shadowed && (
            <p className="text-sm">{t('confirm.legacy', { count: product.legacy.count })}</p>
          )}
          <p className="text-xs text-muted">{t('confirm.note')}</p>
        </div>
      </Modal>
    </span>
  );
}
