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
import { formatMoneyCents } from '@/lib/format';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';
import type { AdminOrderDTO, RefundConfirmationRequiredDetails, RefundOrderResponse, VaultPieceInPackedWithdrawalDetails } from '@/types/contract';
import { VaultPiecesList } from './VaultPiecesList';

export const ADMIN_ORDER_KEY = ['admin-order'] as const;

/**
 * 💰 **El reembolso TOTAL de M3** (contrato §M3 v1.80/.80.4/.80.5 · `DESIGN_SYSTEM §37.10`), solo súper-admin.
 * Antes de confirmar una compra a **bóveda** se pintan `vaultPieces` (qué carta está dónde) y el cuerpo que
 * explica que las cartas vuelven a la plataforma **en almacén**; `409 VAULT_PIECE_IN_PACKED_WITHDRAWAL` nombra
 * el retiro con enlace y «deshaz el preparado»; `422 REFUND_CONFIRMATION_REQUIRED` vuelve con la casilla
 * «Sé que el cliente ya tiene estas cartas…» (sin marcar) y reenvía con `confirmPiecesWithCustomer:true`.
 */
export function RefundOrderDialog({
  order,
  open,
  onClose,
  onDone,
}: {
  order: AdminOrderDTO | null;
  open: boolean;
  onClose: () => void;
  onDone: (res: RefundOrderResponse) => void;
}) {
  const t = useTranslations('admin.m3');
  const tv = useTranslations('admin.m3.vaultRefund');
  const tm = useTranslations('admin');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const getError = useErrorMessage('operator');
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [required, setRequired] = useState<RefundConfirmationRequiredDetails | null>(null);
  const [confirmPieces, setConfirmPieces] = useState(false);
  const [error, setError] = useState<{ text: string; link?: { href: string; label: string } } | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const orderId = order?.id ?? null;

  const detail = useQuery({
    queryKey: [...ADMIN_ORDER_KEY, orderId, 'refund-dialog'],
    queryFn: () => getAdminOrder(orderId!),
    enabled: open && !!orderId,
  });
  const isVault = (detail.data?.fulfillmentMode ?? order?.fulfillmentMode) === 'vault';
  const remaining = detail.data && typeof detail.data.refundedCents === 'number' ? detail.data.totalCents - detail.data.refundedCents : (order?.totalCents ?? 0);

  useEffect(() => {
    if (open) {
      setReason('');
      setRequired(null);
      setConfirmPieces(false);
      setError(null);
      setTimeout(() => cancelRef.current?.focus(), 0);
    }
  }, [open, orderId]);

  const refund = useMutation({
    mutationFn: () => refundOrder(orderId!, { reason: reason.trim(), ...(confirmPieces ? { confirmPiecesWithCustomer: true } : {}) }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['admin-orders'] });
      void qc.invalidateQueries({ queryKey: ADMIN_ORDER_KEY });
      void qc.invalidateQueries({ queryKey: ['admin-preparation-queue'] });
      void qc.invalidateQueries({ queryKey: PICKING_SUMMARY_KEY });
      onDone(res);
    },
    onError: (e) => {
      const err = e instanceof ApiClientError ? e : null;
      if (err?.status === 422 && err.code === 'REFUND_CONFIRMATION_REQUIRED') {
        setRequired((err.details as unknown as RefundConfirmationRequiredDetails | undefined) ?? { required: ['pieces_with_customer'], items: [] });
        setConfirmPieces(false);
        setError({ text: tv('confirmPiecesMissing') });
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

  const canSubmit = reason.trim() !== '' && (!required || confirmPieces) && !refund.isPending;

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
        {detail.isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : (
          <>
            <p className="tabular text-sm text-text">{tv('remaining', { amount: formatMoneyCents(remaining, locale) })}</p>
            <p className="text-sm text-text">{isVault ? tv('body') : tv('directBody')}</p>
            {isVault && detail.data?.vaultPieces && detail.data.vaultPieces.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">{tv('piecesTitle')}</p>
                <VaultPiecesList pieces={detail.data.vaultPieces} highlightIds={required?.items.map((i) => i.inventoryItemId)} compact />
              </div>
            )}
          </>
        )}
        <Input label={t('refundReasonLabel')} hint={t('refundReasonHint')} type="text" value={reason} onChange={(e) => setReason(e.target.value)} />
        {required && (
          <label className="flex items-start gap-3 text-sm text-text">
            <input type="checkbox" className="mt-0.5 h-5 w-5 accent-text" checked={confirmPieces} onChange={(e) => setConfirmPieces(e.target.checked)} data-testid="m3-confirm-pieces" />
            {tv('confirmPieces', { count: Math.max(1, required.items.length), items: required.items.map((i) => i.folio).join(', ') || '—' })}
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
