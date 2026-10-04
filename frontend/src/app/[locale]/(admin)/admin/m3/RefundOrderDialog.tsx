'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { PICKING_SUMMARY_KEY } from '@/hooks/usePickingSummary';
import { getAdminOrder, refundOrder } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { useErrorMessage } from '@/components/ui/QueryState';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton';
import { Textarea } from '@/components/ui/Textarea';
import { formatMoneyCents } from '@/lib/format';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';
import type {
  AdminOrderDetailDTO,
  AdminOrderDTO,
  RefundConfirmationRequiredDetails,
  RefundOrderRequest,
  RefundOrderResponse,
  ShippedRefundReason,
  VaultPieceInPackedWithdrawalDetails,
} from '@/types/contract';
import { VaultPiecesList } from './VaultPiecesList';
import { ShippedReasonFieldset } from './ShippedReasonFieldset';

export const ADMIN_ORDER_KEY = ['admin-order'] as const;

/**
 * Lo que el diálogo necesita de la orden. La FILA del listado (`AdminOrderSummaryDTO`) trae `totalCents` en la raíz;
 * el DETALLE no — lo trae en `breakdown.totalCents` (contrato §11). Para el detalle usar `refundDialogOrderOfDetail`.
 */
export type RefundDialogOrder = Pick<AdminOrderDTO, 'id' | 'totalCents' | 'fulfillmentMode' | 'orderNumber'>;

/** Proyecta el detalle M3 a lo que pide el diálogo (QA s5 IMPORTANTE-1: el total del detalle es `breakdown.totalCents`). */
export function refundDialogOrderOfDetail(o: AdminOrderDetailDTO): RefundDialogOrder {
  return { id: o.id, totalCents: o.breakdown.totalCents, fulfillmentMode: o.fulfillmentMode, orderNumber: o.orderNumber };
}

/** Lo que el diálogo sabe y el servidor no devuelve: el motivo que se eligió (`DESIGN_SYSTEM §40.2 (b)` «Éxito»). */
export interface RefundDoneInfo {
  shippedReason: ShippedRefundReason | null;
}

/**
 * 💰 **El reembolso TOTAL de M3** (contrato §M3 v1.80/.80.4/.80.5 + §M4-SHIP.18.12 v1.80.8.6 · `DESIGN_SYSTEM
 * §37.10` y `§40.2`), solo súper-admin.
 *
 * - **Bóveda** (§37.10): `vaultPieces`, `409 VAULT_PIECE_IN_PACKED_WITHDRAWAL`, `422 … ['pieces_with_customer']`
 *   con la casilla «Sé que el cliente ya tiene estas cartas…». ⛔ Nunca pide motivo de envío (P-S11-4).
 * - **Pedido YA ENVIADO** (`shipmentShipped`, §40.2 (b)): aviso «Este pedido ya salió», motivo obligatorio de los dos
 *   (⛔ ninguno preseleccionado) y la nota obligatoria en un `Textarea` de 500. El `POST` lleva `shippedReason`.
 * - **La pantalla no decide «enviado»**: decide la tx1. Por eso el `422 … ['shipped_reason']` pasa al modo enviado
 *   sin perder la nota y el `409 SHIPPED_REFUND_REASON_NOT_APPLICABLE` vuelve al modo normal. ⚠️ El `422
 *   REFUND_CONFIRMATION_REQUIRED` se ramifica por `details.required`: tratarlo siempre como «cartas en mano del
 *   cliente» pintaría la casilla de bóveda en un pedido enviado (bug latente cerrado aquí, SR-UI-3).
 */
export function RefundOrderDialog({
  order,
  open,
  onClose,
  onDone,
}: {
  order: RefundDialogOrder | null;
  open: boolean;
  onClose: () => void;
  onDone: (res: RefundOrderResponse, info: RefundDoneInfo) => void;
}) {
  const t = useTranslations('admin.m3');
  const tv = useTranslations('admin.m3.vaultRefund');
  const ts = useTranslations('admin.m3.shippedRefund');
  const tShip = useTranslations('status.shipment');
  const tm = useTranslations('admin');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const getError = useErrorMessage('operator');
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [required, setRequired] = useState<RefundConfirmationRequiredDetails | null>(null);
  const [confirmPieces, setConfirmPieces] = useState(false);
  const [shippedReason, setShippedReason] = useState<ShippedRefundReason | null>(null);
  // Lo que dijo el SERVIDOR sobre «enviado»: manda sobre el detalle (que pudo quedarse viejo).
  const [serverShipped, setServerShipped] = useState<boolean | null>(null);
  const [focusLegend, setFocusLegend] = useState(0);
  const [error, setError] = useState<{ text: string; link?: { href: string; label: string } } | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const legendRef = useRef<HTMLLegendElement>(null);
  const orderId = order?.id ?? null;

  const detail = useQuery({
    queryKey: [...ADMIN_ORDER_KEY, orderId, 'refund-dialog'],
    queryFn: () => getAdminOrder(orderId!),
    enabled: open && !!orderId,
  });
  const isVault = (detail.data?.fulfillmentMode ?? order?.fulfillmentMode) === 'vault';
  const remaining = detail.data && typeof detail.data.refundedCents === 'number' ? detail.data.breakdown.totalCents - detail.data.refundedCents : (order?.totalCents ?? 0);
  // §40.2: con el detalle en error el diálogo se comporta como «no enviado» y el `422` es la red.
  const shipped = !isVault && (serverShipped ?? detail.data?.shipmentShipped === true);
  const piecesRequired = required?.required.includes('pieces_with_customer') ?? false;

  useEffect(() => {
    if (open) {
      setReason('');
      setRequired(null);
      setConfirmPieces(false);
      setShippedReason(null);
      setServerShipped(null);
      setError(null);
      setTimeout(() => cancelRef.current?.focus(), 0);
    }
  }, [open, orderId]);
  useEffect(() => {
    if (focusLegend > 0) setTimeout(() => legendRef.current?.focus(), 0);
  }, [focusLegend]);

  const refund = useMutation({
    mutationFn: () => {
      const body: RefundOrderRequest = { reason: reason.trim() };
      if (confirmPieces) body.confirmPiecesWithCustomer = true;
      // ⛔ Con el pedido sin salir el cuerpo NO lleva la clave (si la llevara: `409 …NOT_APPLICABLE`).
      if (shipped && shippedReason) body.shippedReason = shippedReason;
      return refundOrder(orderId!, body);
    },
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['admin-orders'] });
      void qc.invalidateQueries({ queryKey: ADMIN_ORDER_KEY });
      void qc.invalidateQueries({ queryKey: ['admin-preparation-queue'] });
      void qc.invalidateQueries({ queryKey: PICKING_SUMMARY_KEY });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      onDone(res, { shippedReason: shipped ? shippedReason : null });
    },
    onError: (e) => {
      const err = e instanceof ApiClientError ? e : null;
      if (err?.status === 422 && err.code === 'REFUND_CONFIRMATION_REQUIRED') {
        const details = err.details as Partial<RefundConfirmationRequiredDetails> | undefined;
        if (details?.required?.includes('shipped_reason')) {
          // El pedido salió con el diálogo abierto: modo enviado, la nota se queda, foco a la `legend`.
          setServerShipped(true);
          setShippedReason(null);
          void qc.invalidateQueries({ queryKey: ADMIN_ORDER_KEY });
          const st = details.shipmentStatus;
          setError({ text: ts('error.required', { status: st && tShip.has(st) ? tShip(st) : (st ?? '—') }) });
          setFocusLegend((n) => n + 1);
          return;
        }
        setRequired({ required: ['pieces_with_customer'], items: details?.items ?? [] });
        setConfirmPieces(false);
        setError({ text: tv('confirmPiecesMissing') });
        return;
      }
      if (err?.status === 409 && err.code === 'SHIPPED_REFUND_REASON_NOT_APPLICABLE') {
        setServerShipped(false);
        setShippedReason(null);
        void qc.invalidateQueries({ queryKey: ADMIN_ORDER_KEY });
        setError({ text: ts('error.notApplicable') });
        return;
      }
      if (err?.status === 400 && err.code === 'VALIDATION_ERROR' && err.details?.field === 'shippedReason') {
        setError({ text: ts('error.invalid') });
        return;
      }
      if (err?.status === 409 && err.code === 'VAULT_PIECE_IN_PACKED_WITHDRAWAL') {
        const items = (err.details as Partial<VaultPieceInPackedWithdrawalDetails> | undefined)?.items ?? [];
        const ref = items[0]?.shipmentId ?? '—';
        setError({
          text: tv('error.inPackedWithdrawal', { count: Math.max(1, items.length), ref }),
          link: items[0]?.shipmentId ? { href: '/admin/m4', label: tv('error.inPackedWithdrawalLink', { ref }) } : undefined,
        });
        return;
      }
      if (err?.status === 409 && err.code === 'CONFLICT') {
        setError({ text: tv('error.nothingLeft') });
        return;
      }
      setError({ text: getError(e) });
    },
  });

  const canSubmit =
    !detail.isLoading &&
    reason.trim() !== '' &&
    (!piecesRequired || confirmPieces) &&
    (!shipped || shippedReason !== null) &&
    !refund.isPending;
  const pieceItems = required?.items ?? [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('refund')}
      footer={
        <>
          <Button ref={cancelRef} variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button variant="destructive" disabled={!canSubmit} loading={refund.isPending} onClick={() => refund.mutate()} data-testid="m3-refund-confirm">
            {t('refundConfirm', { amount: formatMoneyCents(remaining, locale) })}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p>{t('refundQuestion')}</p>
        {shipped && (
          <Banner variant="warning" title={ts('title')}>
            <span data-testid="m3-shipped-warning">{ts('warning')}</span>
          </Banner>
        )}
        {detail.isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : (
          <>
            <p className="tabular text-sm text-text">{tv('remaining', { amount: formatMoneyCents(remaining, locale) })}</p>
            <p className="text-sm text-text">{shipped ? ts('body') : isVault ? tv('body') : tv('directBody')}</p>
            {isVault && detail.data?.vaultPieces && detail.data.vaultPieces.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">{tv('piecesTitle')}</p>
                <VaultPiecesList pieces={detail.data.vaultPieces} highlightIds={pieceItems.map((i) => i.inventoryItemId)} compact />
              </div>
            )}
          </>
        )}
        {shipped ? (
          <>
            <ShippedReasonFieldset
              name="m3-refund-shipped-reason"
              legend={ts('legend')}
              legendRef={legendRef}
              value={shippedReason}
              onChange={setShippedReason}
              testId="m3-refund-shipped-reason"
            />
            {shippedReason === null && <p className="text-xs text-muted">{ts('pickOne')}</p>}
            <Textarea
              label={ts('noteLabel')}
              hint={ts('noteHint')}
              value={reason}
              maxLength={500}
              counter={{ max: 500 }}
              onChange={(e) => setReason(e.target.value)}
            />
          </>
        ) : (
          <Input label={t('refundReasonLabel')} hint={t('refundReasonHint')} type="text" value={reason} onChange={(e) => setReason(e.target.value)} />
        )}
        {piecesRequired && (
          <label className="flex items-start gap-3 text-sm text-text">
            <input type="checkbox" className="mt-0.5 h-5 w-5 accent-text" checked={confirmPieces} onChange={(e) => setConfirmPieces(e.target.checked)} data-testid="m3-confirm-pieces" />
            {tv('confirmPieces', { count: Math.max(1, pieceItems.length), items: pieceItems.map((i) => i.folio).join(', ') || '—' })}
          </label>
        )}
        <p className="text-xs text-muted">{tm('moneyOutNote')}</p>
        {error && (
          <Banner variant="danger" role="alert" title={tc('errorTitle')}>
            <p>{error.text}</p>
            {error.link && (
              <Link href={error.link.href} className="text-text underline underline-offset-4 hover:text-accent">
                {error.link.label}
              </Link>
            )}
          </Banner>
        )}
      </div>
    </Modal>
  );
}
