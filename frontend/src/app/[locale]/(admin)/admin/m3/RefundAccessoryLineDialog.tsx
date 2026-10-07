'use client';

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { refundAccessoryLineDelivered } from '@/lib/api';
import { asApiError } from '@/lib/api-client';
import { formatMoneyCents } from '@/lib/format';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Textarea';
import { useErrorMessage } from '@/components/ui/QueryState';
import { QuantityStepper } from '@/components/domain/accessories/QuantityStepper';
import type { AppLocale } from '@/i18n/routing';
import type { ShippedRefundReason } from '@/types/contract';
import { ShippedReasonFieldset } from './ShippedReasonFieldset';

export interface AccessoryRefundTarget {
  orderId: string;
  lineId: string;
  name: string;
  isBundle: boolean;
  /** `deliveredRefund.amountByQtyCents` del SERVIDOR; largo = `refundableQty`. ⛔ La pantalla no calcula importes. */
  amountByQtyCents: number[];
}

/**
 * 💰 «Reembolsar unidades» de un renglón de accesorio entregado (`API_CONTRACT §AC.10 (2)` con la errata v1.86.2,
 * `DESIGN_SYSTEM §AC-UX.13`; AC-F19). Cantidad 1..`refundableQty` (paquete: siempre 1, sin selector), importe =
 * `amountByQtyCents[k−1]` LEÍDO, motivo (ninguno marcado al abrir), nota obligatoria 3–500. El cuerpo lleva
 * `expectedRefundCents` = la cifra mostrada. `409 REFUND_PREVIEW_STALE` ⇒ el diálogo sigue abierto con `refundCents`
 * y pide confirmar de nuevo (⛔ nunca reintenta solo).
 */
export function RefundAccessoryLineDialog({
  target,
  onClose,
  onDone,
}: {
  target: AccessoryRefundTarget | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('admin.m3.accessories');
  const tdr = useTranslations('admin.m3.deliveredRefund');
  const tc = useTranslations('admin.m3.accessories');
  const locale = useLocale() as AppLocale;
  const getError = useErrorMessage('operator');
  const [k, setK] = useState(1);
  const [reason, setReason] = useState<ShippedRefundReason | null>(null);
  const [note, setNote] = useState('');
  /** La cifra del 409 REFUND_PREVIEW_STALE, para la cantidad con la que se pidió; manda sobre la lista. */
  const [stale, setStale] = useState<{ k: number; cents: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    setK(1);
    setReason(null);
    setNote('');
    setStale(null);
    setError(null);
  }, [target]);

  const max = target ? (target.isBundle ? 1 : target.amountByQtyCents.length) : 1;
  const amount = stale && stale.k === k ? stale.cents : (target?.amountByQtyCents[k - 1] ?? 0);
  const noteOk = note.trim().length >= 3 && note.trim().length <= 500;

  const mutation = useMutation({
    mutationFn: () =>
      refundAccessoryLineDelivered(target!.orderId, target!.lineId, {
        quantity: k,
        reason: reason!,
        note: note.trim(),
        expectedRefundCents: amount,
      }),
    onMutate: () => setError(null),
    onSuccess: () => onDone(),
    onError: (e) => {
      const err = asApiError(e);
      if (err?.code === 'REFUND_PREVIEW_STALE') {
        const fresh = Number(err.details?.refundCents);
        if (Number.isInteger(fresh) && fresh > 0) {
          setStale({ k, cents: fresh });
          return setError(t('stale', { amount: formatMoneyCents(fresh, locale) }));
        }
      }
      if (err?.code === 'ACCESSORY_REFUND_EXCEEDS') return setError(t('exceeds', { n: Number(err.details?.refundableQty ?? 0) }));
      if (err?.code === 'BUNDLE_REFUND_REQUIRES_DECK') return setError(t('bundleRequiresDeck'));
      if (err?.code === 'MONEY_OUT_FORBIDDEN') return setError(tdr('error.forbidden'));
      setError(getError(e));
    },
  });

  return (
    <Modal
      open={target !== null}
      onClose={onClose}
      title={target ? t('dialogTitle', { name: target.name }) : ''}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button
            variant="secondary"
            disabled={!reason || !noteOk}
            loading={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {t('confirm', { k, amount: formatMoneyCents(amount, locale) })}
          </Button>
        </>
      }
    >
      {target && (
        <div className="flex flex-col gap-4">
          {!target.isBundle && (
            <QuantityStepper label={t('howMany')} value={k} min={1} max={max} onChange={setK} compact />
          )}
          <p className="tabular text-sm text-text">{t('amount', { amount: formatMoneyCents(amount, locale) })}</p>
          <ShippedReasonFieldset name={`acc-refund-${target.lineId}`} legend={t('reasonLegend')} value={reason} onChange={setReason} />
          <Textarea
            label={t('note')}
            hint={t('noteHelp')}
            value={note}
            maxLength={500}
            counter={{ max: 500 }}
            onChange={(e) => setNote(e.target.value)}
          />
          {error && (
            <p role="alert" className="text-sm text-accent">
              {error}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
