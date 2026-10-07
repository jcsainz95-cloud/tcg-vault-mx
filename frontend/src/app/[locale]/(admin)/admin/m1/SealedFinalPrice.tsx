'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Pencil } from 'lucide-react';
import { updateInventoryItem, type UpdateInventoryItemInput } from '@/lib/api';
import { asApiError } from '@/lib/api-client';
import { formatMoneyCents } from '@/lib/format';
import type { AppLocale } from '@/i18n/routing';
import type { InventoryStatus, OwnerType, PriceBasis } from '@/types/contract';
import { Link } from '@/i18n/navigation';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { useErrorMessage } from '@/components/ui/QueryState';

import { MAX_LIST_PRICE_CENTS, SEALED_FINAL_PRICE_INVALIDATES } from './sealed-final-price';

export { MAX_LIST_PRICE_CENTS };

export interface SealedFinalPricePiece {
  id: string;
  folio: string;
  status: InventoryStatus;
  ownerType: OwnerType;
  hasLocation: boolean;
  listPriceCents: number | null;
  /** v1.80.8.7 (S-2): ausente ⇒ servidor anterior (el panel dice «automático» sin cifra). */
  resolvedSalePriceCents?: number | null;
  priceBasis?: PriceBasis | null;
  /** `sealedProductName` / nombre de la presentación. ⛔ Nunca el nombre del ancla (P-79c). */
  name?: string | null;
  /** Referencia de MERCADO del grupo (panel): se rotula «Mercado», ⛔ nunca como precio de venta. */
  marketRefCents?: number | null;
  /**
   * §M11-SP.12.4 / D-SP-4 — el `P` de esta pieza que calcula el SERVIDOR (lo que paga el cliente). Se pinta «En la
   * tienda: {P}» bajo el `L`; ausente ⇒ no se pinta. ⛔ La UI no lo deriva de `L` (UX-SP-21).
   */
  resolvedDisplayPriceCents?: number | null;
}

type Mode = 'publish' | 'save' | 'reprice';

/**
 * Qué hace el botón del editor (`DESIGN_SYSTEM §39.2 (a)`). `null` ⇒ solo lectura (el `422` es el candado).
 *
 * ⭐ Errata SU-1 (`API_CONTRACT §M1-SU` SU.4, `ARCHITECTURE §4.65`): una pieza `in_stock` ofrece **siempre**
 * «Guardar y publicar», tenga o no cajón. Guardar sin publicar una pieza sin cajón la dejaría con `missing = []`:
 * fuera de la cola y sin publicar (prueba SU-F1). `hasLocation` ya no decide; la rama `'save'` queda **dormida**
 * (inalcanzable, conservada para revertir y para no mover la paridad de i18n). Revertir = volver a
 * `p.hasLocation ? 'publish' : 'save'`.
 */
export function sealedFinalPriceMode(p: Pick<SealedFinalPricePiece, 'status' | 'ownerType' | 'hasLocation'>): Mode | null {
  if (p.ownerType !== 'platform') return null;
  if (p.status === 'listed') return 'reprice';
  if (p.status === 'in_stock') return 'publish';
  return null;
}

type ParseResult = { cents: number } | { error: 'errPositive' | 'errDecimals' | 'errMax' } | null;

/** Pesos (texto) → centavos SIN aritmética de coma flotante. Vacío ⇒ `null` (botón apagado, sin error). */
export function parseFinalPrice(text: string): ParseResult {
  const raw = text.trim().replace(/,/g, '');
  if (raw === '') return null;
  const m = /^(\d+)(?:\.(\d*))?$/.exec(raw);
  if (!m) return { error: 'errPositive' };
  const decimals = m[2] ?? '';
  if (decimals.length > 2) return { error: 'errDecimals' };
  const cents = Number(m[1]) * 100 + Number((decimals + '00').slice(0, 2));
  if (!Number.isSafeInteger(cents) || cents <= 0) return { error: 'errPositive' };
  if (cents > MAX_LIST_PRICE_CENTS) return { error: 'errMax' };
  return { cents };
}

/**
 * 💰 **Precio final a mano — SOLO sellado** (`DESIGN_SYSTEM §39.2`, `API_CONTRACT §M1` INV-SP-8 + «v1.80.8.7»,
 * criterio **255**). UN componente para los dos sitios (la cola «Listas para publicar» y el panel de «Sellado»):
 * la regla de botones no se duplica.
 *
 * - **«Guardar y publicar»** (pieza `in_stock`, con o sin ubicación — Errata SU-1) ⇒ `{ listPriceCents, status:
 *   'listed' }` en **una** llamada: si no puede publicar no se guarda nada. Es el ÚNICO botón en ese caso: guardar sin
 *   publicar la sacaría de la cola sin estar a la venta (fase 8, «ninguna pieza adquirida se queda invisible»).
 * - **«Guardar precio»** (ya publicada) ⇒ `{ listPriceCents }`. La variante «sin ubicación» está dormida (SU.4).
 * - ⛔ **Nunca `listPriceCents: null`** (D-SFP-2): el tipo del verbo no lo admite y aquí no hay «volver al automático».
 * - La base del precio es la del servidor (`priceBasis`); ⛔ la UI no la deduce comparando cifras.
 *
 * ⛔ **Raw y graded no montan esto** (P-PRE-1: su override por pieza se queda como está).
 */
export function SealedFinalPrice({
  piece,
  layout,
  editing,
  onEditingChange,
  onDone,
  canEdit,
  staffNote = false,
}: {
  piece: SealedFinalPricePiece;
  layout: 'queue' | 'panel';
  editing: boolean;
  onEditingChange: (open: boolean) => void;
  onDone: (message: string) => void;
  /**
   * §M11-SP.3/SP.4 — la pieza SIN producto la precia solo el dueño; el personal la lee. **Obligatorio, sin valor por
   * defecto** (C-2): quien monta esto lo decide con `sealedPieceEditMode(...) === 'piece'`, que falla cerrado.
   */
  canEdit: boolean;
  /** Personal sobre pieza sin producto: «Sin producto: su precio lo pone el dueño.» (§70.3 (a)). */
  staffNote?: boolean;
}) {
  const tsp = useTranslations('admin.sealedProductPrice');
  const t = useTranslations('admin.sealedFinalPrice');
  const tq = useTranslations('admin.m1.publishQueue');
  const tInv = useTranslations('status.inventory');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const qc = useQueryClient();
  const getError = useErrorMessage('operator');

  const mode = sealedFinalPriceMode(piece);
  const [text, setText] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<{ text: string; pendingPriceEntryId?: string; reload?: boolean } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [cancelEl, setCancelEl] = useState<HTMLButtonElement | null>(null);
  const returnFocus = useRef(false);

  // Al abrir: prellenado con el precio final si lo hay; si no, VACÍO (⛔ prellenado con el automático).
  useEffect(() => {
    if (editing) {
      setText(piece.listPriceCents != null ? (piece.listPriceCents / 100).toFixed(2) : '');
      setError(null);
      setTimeout(() => inputRef.current?.focus(), 0);
    } else if (returnFocus.current) {
      returnFocus.current = false;
      triggerRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);
  useEffect(() => {
    if (confirmOpen && cancelEl) setTimeout(() => cancelEl.focus(), 0);
  }, [confirmOpen, cancelEl]);

  const parsed = parseFinalPrice(text);
  const cents = parsed && 'cents' in parsed ? parsed.cents : null;
  const fieldError = parsed && 'error' in parsed ? t(parsed.error, { max: formatMoneyCents(MAX_LIST_PRICE_CENTS, locale) }) : undefined;
  const unchanged = cents !== null && cents === piece.listPriceCents;
  const canSubmit = cents !== null && !unchanged && mode !== null;

  const basisLabel = (() => {
    if (piece.listPriceCents != null) return tq('basis.manual');
    switch (piece.priceBasis) {
      case 'market':
        return tq('basis.market');
      case 'floor':
        return tq('basis.floor');
      case 'override':
        return tq('basis.override');
      default:
        return tq('basis.none');
    }
  })();
  const currentCents = piece.listPriceCents ?? piece.resolvedSalePriceCents ?? null;

  /** Techlead D-8: la MISMA lista tras guardar y en «Recargar» (antes «Recargar» no refrescaba el panel de «Sellado»). */
  function invalidateSealedPrice() {
    for (const key of SEALED_FINAL_PRICE_INVALIDATES) void qc.invalidateQueries({ queryKey: [key] });
  }

  const mutation = useMutation({
    mutationFn: (value: number) => {
      // ⛔ D-SFP-2: `listPriceCents` es SIEMPRE un entero > 0 aquí (el tipo del verbo no admite `null`).
      const body: UpdateInventoryItemInput = mode === 'publish' ? { listPriceCents: value, status: 'listed' } : { listPriceCents: value };
      return updateInventoryItem(piece.id, body);
    },
    onSuccess: (_res, value) => {
      setConfirmOpen(false);
      const price = formatMoneyCents(value, locale);
      invalidateSealedPrice();
      returnFocus.current = true;
      onEditingChange(false);
      onDone(
        mode === 'publish'
          ? t('done.published', { folio: piece.folio, price })
          : mode === 'save'
            ? t('done.savedNoLocation', { folio: piece.folio })
            : t('done.repriced', { folio: piece.folio, price }),
      );
    },
    onError: (e) => {
      // El editor SIGUE abierto con lo tecleado; el error va en un Banner (⛔ solo toast).
      setConfirmOpen(false);
      const err = asApiError(e);
      const status = typeof err?.details?.status === 'string' ? err.details.status : null;
      const statusLabel = status && tInv.has(status) ? tInv(status) : (status ?? '—');
      if (err?.status === 422 && err.code === 'ITEM_NOT_ADJUSTABLE') {
        setError({ text: status === 'reserved' ? t('errors.reserved') : t('errors.notAdjustable', { status: statusLabel }), reload: true });
      } else if (err?.status === 409 && err.code === 'CONFLICT') {
        setError({ text: t('errors.conflict'), reload: true });
      } else if (err?.status === 422 && err.code === 'ITEM_NOT_PUBLISHABLE') {
        setError({ text: t('errors.notPublishable', { status: statusLabel }), reload: true });
      } else if (err?.status === 422 && err.code === 'PRICE_PENDING') {
        const ppe = err.details?.pendingPriceEntryId;
        setError({ text: t('errors.pricePending'), pendingPriceEntryId: typeof ppe === 'string' ? ppe : undefined });
      } else if (err?.status === 422 && err.code === 'VALIDATION_ERROR') {
        setError({ text: t('errors.validation', { max: formatMoneyCents(MAX_LIST_PRICE_CENTS, locale) }) });
      } else {
        setError({ text: getError(e) });
      }
    },
  });

  function cancel() {
    returnFocus.current = true;
    onEditingChange(false);
  }
  function reload() {
    setError(null);
    invalidateSealedPrice();
  }

  const priceText = currentCents != null ? formatMoneyCents(currentCents, locale) : '—';
  const hasFinal = piece.listPriceCents != null;
  // D-SP-4: el `P` del servidor, solo si llega (⛔ nunca ×1.16 en el cliente, UX-SP-21).
  const storeLine =
    typeof piece.resolvedDisplayPriceCents === 'number' ? (
      <span className="tabular text-xs text-text" data-testid={`sealed-store-price-${piece.id}`}>
        {t('storePrice', { price: formatMoneyCents(piece.resolvedDisplayPriceCents, locale) })}
      </span>
    ) : null;

  // ── Lectura ─────────────────────────────────────────────────────────────────────────────────────
  const reading =
    layout === 'queue' ? (
      <span className="flex flex-col" data-testid={`sealed-final-price-${piece.id}`}>
        <span className="flex flex-wrap items-baseline gap-1">
          <span className={currentCents != null ? 'tabular font-mono text-text' : 'tabular font-mono text-accent'}>{priceText}</span>{' '}
          <span className="text-xs text-muted">· {basisLabel}</span>
        </span>
        {storeLine}
      </span>
    ) : (
      <span className="flex flex-col" data-testid={`sealed-final-price-${piece.id}`}>
        <span className="text-xs text-text">
          <span className="text-muted">{t('rowLabel')}: </span>
          {hasFinal ? (
            <span className="tabular font-mono">{t('manual', { price: formatMoneyCents(piece.listPriceCents!, locale) })}</span>
          ) : piece.resolvedSalePriceCents === undefined ? (
            // Servidor anterior a S-2: «automático» SIN cifra (⛔ no se inventa).
            t('auto')
          ) : (
            <>
              <span className="tabular font-mono">{priceText}</span> <span className="text-muted">· {basisLabel}</span>
            </>
          )}
        </span>
        {storeLine}
        {typeof piece.marketRefCents === 'number' && (
          <span className="tabular text-xs text-muted">{t('market', { price: formatMoneyCents(piece.marketRefCents, locale) })}</span>
        )}
      </span>
    );

  if (mode === null) {
    // `reserved`, vendida, terminal o de cliente: solo lectura, sin lápiz (la pantalla no ofrece lo que el `422` rechaza).
    return (
      <span className="flex flex-col">
        <span className="tabular font-mono text-xs text-text" data-testid={`sealed-final-price-${piece.id}`}>
          {piece.listPriceCents != null ? t('readOnly', { price: formatMoneyCents(piece.listPriceCents, locale) }) : '—'}
        </span>
        {storeLine}
      </span>
    );
  }

  if (!canEdit) {
    // §M11-SP.3: el personal LEE el precio de la pieza sin producto; ⛔ sin botón deshabilitado (§8).
    return (
      <span className="flex flex-col gap-1">
        {reading}
        {staffNote && <span className="text-xs text-muted">{tsp('piece.unlinkedStaff')}</span>}
      </span>
    );
  }

  const primaryLabel = mode === 'publish' ? t('saveAndPublish') : t('saveOnly');
  const newPrice = cents !== null ? formatMoneyCents(cents, locale) : '';
  const name = piece.name?.trim() || t('confirm.thisSealed');

  return (
    <span className="flex flex-col gap-2">
      {reading}
      {!editing ? (
        <Button
          ref={triggerRef}
          size="sm"
          variant="secondary"
          className="self-start"
          aria-label={hasFinal ? t('changeAria', { folio: piece.folio }) : t('setAria', { folio: piece.folio })}
          onClick={() => onEditingChange(true)}
        >
          <Pencil size={14} aria-hidden /> {hasFinal ? t('change') : t('set')}
        </Button>
      ) : (
        <span className="flex flex-col gap-2" data-testid={`sealed-final-price-editor-${piece.id}`}>
          <span className="w-[9rem]">
            <Input
              ref={inputRef}
              label={t('label')}
              prefix="MX$"
              inputMode="decimal"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setError(null);
              }}
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
          {mode === 'save' && <span className="text-xs text-muted">{t('noLocationHint')}</span>}
          {mode === 'reprice' && <span className="text-xs text-muted">{t('listedHint')}</span>}
          <span className="flex flex-wrap gap-2">
            <Button size="sm" variant="primary" disabled={!canSubmit || mutation.isPending} loading={mutation.isPending} onClick={() => setConfirmOpen(true)}>
              {primaryLabel}
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
                error.reload ? (
                  <Button size="sm" variant="secondary" onClick={reload}>
                    {t('reload')}
                  </Button>
                ) : undefined
              }
            >
              <p>{error.text}</p>
              {error.pendingPriceEntryId && (
                <Link
                  href={{ pathname: '/admin/m2', query: { pendingPrice: error.pendingPriceEntryId } }}
                  className="text-text underline underline-offset-4 hover:text-accent"
                >
                  {tq('pendingPriceLink')}
                </Link>
              )}
            </Banner>
          )}
        </span>
      )}

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={t('confirm.title', { name })}
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
              data-testid="sealed-final-price-confirm"
            >
              {mode === 'publish' ? t('confirm.publish', { price: newPrice }) : t('confirm.save', { price: newPrice })}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          <p className="tabular font-mono text-sm">
            {currentCents != null ? t('confirm.now', { price: priceText, basis: basisLabel }) : t('confirm.nowNone')}
          </p>
          <p className="tabular font-mono text-sm">{t('confirm.new', { price: newPrice })}</p>
          <p className="text-sm">
            {mode === 'publish'
              ? t('confirm.effectPublish', { price: newPrice })
              : mode === 'save'
                ? t('confirm.effectNoLocation', { price: newPrice })
                : t('confirm.effectListed')}
          </p>
          <p className="text-xs text-muted">{t('confirm.note')}</p>
        </div>
      </Modal>
    </span>
  );
}
