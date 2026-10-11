'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { refundDeliveredItem } from '@/lib/api';
import { asApiError } from '@/lib/api-client';
import { formatMoneyCents } from '@/lib/format';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { Textarea } from '@/components/ui/Textarea';
import { useErrorMessage } from '@/components/ui/QueryState';
import type { AppLocale } from '@/i18n/routing';
import type { PaymentRefundDTO, ShippedRefundReason } from '@/types/contract';
import { ShippedReasonFieldset } from './ShippedReasonFieldset';

export interface DeliveredRefundTarget {
  orderId: string;
  orderItemId: string;
  cardName: string;
  cardMeta: string;
  /** La cifra del SERVIDOR (`deliveredRefund.amountCents`). ⛔ La pantalla no la calcula ni la edita. */
  amountCents: number;
}

/** El resultado que el padre pinta en su aviso de página (§60.3 b «201»). */
export interface DeliveredRefundDone {
  refund: PaymentRefundDTO;
  cardName: string;
  reason: ShippedRefundReason;
}

/**
 * 💰 «Reembolsar una carta entregada» (DESIGN_SYSTEM §60.3 b · contrato v1.82 §PNL.2, súper-admin). Carta → cifra
 * → motivo (dos, ninguno marcado) → nota (3–500) → efectos → botones. El cuerpo manda `expectedRefundCents` =
 * la cifra mostrada, ⛔ nunca `amountCents` (IDR-UI-1). `409 REFUND_PREVIEW_STALE` ⇒ el diálogo SIGUE abierto con
 * la cifra nueva y conserva motivo y nota (IDR-UI-2). Los demás rechazos cierran y los pinta el padre (`onClosedWith`).
 */
export function RefundDeliveredItemDialog({
  target,
  onClose,
  onDone,
  onClosedWith,
  onStale,
}: {
  target: DeliveredRefundTarget | null;
  onClose: () => void;
  onDone: (d: DeliveredRefundDone) => void;
  /** Rechazo que cierra el diálogo: el padre lo pinta como error de página e invalida el detalle. */
  onClosedWith: (message: string) => void;
  /** `409 REFUND_PREVIEW_STALE`: el padre invalida el detalle (la cifra nueva ya la trae el error). */
  onStale: () => void;
}) {
  const t = useTranslations('admin.m3.deliveredRefund');
  const tm = useTranslations('admin');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const getError = useErrorMessage('operator');
  const [reason, setReason] = useState<ShippedRefundReason | null>(null);
  const [note, setNote] = useState('');
  const [amountCents, setAmountCents] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  const firstRadioWrap = useRef<HTMLDivElement>(null);

  const open = target !== null;
  useEffect(() => {
    if (!target) return;
    setReason(null);
    setNote('');
    setAmountCents(target.amountCents);
    setError(null);
    setNoteError(null);
    // §60.3 b: foco inicial en el primer radio.
    setTimeout(() => firstRadioWrap.current?.querySelector<HTMLInputElement>('input[type="radio"]')?.focus(), 0);
  }, [target]);

  const shown = amountCents ?? target?.amountCents ?? 0;
  const money = formatMoneyCents(shown, locale);

  const mutation = useMutation({
    mutationFn: () =>
      refundDeliveredItem(target!.orderId, target!.orderItemId, {
        reason: reason!,
        note: note.trim(),
        expectedRefundCents: shown,
      }),
    onMutate: () => {
      setError(null);
      setNoteError(null);
    },
    onSuccess: (res) => onDone({ refund: res.refund, cardName: target!.cardName, reason: reason! }),
    onError: (e) => {
      const err = asApiError(e);
      if (err?.status === 409 && err.code === 'REFUND_PREVIEW_STALE') {
        const fresh = err.details?.refundCents;
        if (typeof fresh === 'number' && Number.isInteger(fresh) && fresh > 0) {
          setAmountCents(fresh);
          setError(t('error.stale', { amount: formatMoneyCents(fresh, locale) }));
        } else setError(getError(e));
        onStale();
        return;
      }
      if (err?.status === 409 && err.code === 'ITEM_REFUND_NOT_AVAILABLE') {
        const r = err.details?.reason;
        const key = typeof r === 'string' ? `error.notAvailable.${r}` : '';
        onClosedWith(key && t.has(key) ? t(key) : getError(e));
        return;
      }
      if (err?.status === 403 && err.code === 'MONEY_OUT_FORBIDDEN') return setError(t('error.forbidden'));
      if (err?.status === 400 && err.code === 'VALIDATION_ERROR') {
        if (err.details?.field === 'note') setNoteError(t('error.invalidNote'));
        else setError(t('error.invalidReason'));
        return;
      }
      if (err?.status === 409 && err.code === 'CONFLICT') return setError(t('error.conflict'));
      setError(getError(e));
    },
  });

  const canConfirm = reason !== null && note.trim().length >= 3 && !mutation.isPending;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('title')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button
            variant="destructive"
            disabled={!canConfirm}
            loading={mutation.isPending}
            onClick={() => mutation.mutate()}
            data-testid="m3-item-refund-confirm"
          >
            {t('confirm', { amount: money })}
          </Button>
        </>
      }
    >
      {target && (
        <div className="flex flex-col gap-4 text-sm text-text">
          <div>
            <p lang="en" className="font-serif text-lg">
              {target.cardName}
            </p>
            {target.cardMeta && <p className="font-mono text-[11px] text-muted">{target.cardMeta}</p>}
          </div>
          <div>
            <p className="tabular font-serif text-2xl" data-testid="m3-item-refund-amount">
              {t('amount', { amount: money })}
            </p>
            <p className="text-muted">{t('amountHint')}</p>
          </div>
          <div ref={firstRadioWrap}>
            <ShippedReasonFieldset name="m3-item-refund-reason" legend={t('legend')} value={reason} onChange={setReason} />
          </div>
          <Textarea
            label={t('noteLabel')}
            hint={t('noteHint')}
            error={noteError ?? undefined}
            value={note}
            maxLength={500}
            counter={{ max: 500 }}
            onChange={(e) => setNote(e.target.value)}
          />
          <p>{t('effects')}</p>
          <p className="text-xs text-muted">{tm('moneyOutNote')}</p>
          {error && (
            <Banner variant="danger" role="alert">
              <span data-testid="m3-item-refund-error">{error}</span>
            </Banner>
          )}
        </div>
      )}
    </Modal>
  );
}
