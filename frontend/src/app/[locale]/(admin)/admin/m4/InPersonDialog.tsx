'use client';

import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { PICKING_SUMMARY_KEY } from '@/hooks/usePickingSummary';
import { getAdminShipment } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { deliverShipmentInPerson } from '@/lib/api/shipments-in-person';
import { useErrorMessage } from '@/components/ui/QueryState';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { formatMoneyCents } from '@/lib/format';
import type { AppLocale } from '@/i18n/routing';
import type { WithdrawalLineOriginRefundedDetails } from '@/types/contract';

/**
 * §PERSONA — «Entregado en persona»: UNA confirmación y UNA mutación para los tres lugares donde el dueño la usa
 * (fila de «Envíos», tarjeta de «Preparar» y ventana «Capturar guía»). El servidor decide (409 nombrados).
 * `feeCents` presente ⇒ el llamador ya tiene el envío completo; ausente ⇒ se lee `GET /admin/shipments/:id` para
 * mostrar el flete cobrado (la tarjeta de Preparar no lo trae). ⛔ El front no calcula nada.
 */
export interface InPersonTarget {
  id: string;
  ref: string;
  recipient?: string | null;
  feeCents?: number | null;
}

export const SHIPMENT_QUEUE_KEYS = [['admin-shipments'], ['admin-preparation-queue'], PICKING_SUMMARY_KEY, ['departure-board']] as const;

export function InPersonDialog({
  target,
  onClose,
  onDone,
  onFail,
}: {
  target: InPersonTarget | null;
  onClose: () => void;
  onDone: (t: InPersonTarget) => void;
  onFail: (t: InPersonTarget, text: string) => void;
}) {
  const t = useTranslations('admin.m4');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const getError = useErrorMessage('operator');
  const qc = useQueryClient();
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (target) cancelRef.current?.focus();
  }, [target?.id]);

  const needsFetch = !!target && target.feeCents === undefined;
  const full = useQuery({
    queryKey: ['admin-shipment-in-person', target?.id ?? ''],
    queryFn: () => getAdminShipment(target!.id),
    enabled: needsFetch,
    gcTime: 0,
  });

  const mutation = useMutation({
    mutationFn: (tg: InPersonTarget) => deliverShipmentInPerson(tg.id),
    // Los avisos viajan en las variables: no dependen de que `target` siga vivo al responder el servidor.
    onSuccess: (_d, tg) => {
      for (const queryKey of SHIPMENT_QUEUE_KEYS) void qc.invalidateQueries({ queryKey: [...queryKey] });
      onDone(tg);
      onClose();
    },
    onError: (e, tg) => {
      onClose();
      const err = e instanceof ApiClientError ? e : null;
      const d = err?.details as Record<string, unknown> | undefined;
      let text: string;
      if (err?.status === 409 && err.code === 'SHIPMENT_NOT_PREPARED') text = t('statusActions.inPerson.errNotPrepared');
      else if (err?.status === 409 && err.code === 'SHIPMENT_HAS_LABEL') text = t('statusActions.inPerson.errHasLabel');
      else if (err?.status === 409 && err.code === 'ORDER_NOT_SETTLED')
        text = t('statusActions.inPerson.errOrderNotSettled', { status: String(d?.orderStatus ?? '—') });
      else if (err?.status === 409 && err.code === 'WITHDRAWAL_LINE_ORIGIN_REFUNDED') {
        const items = (d?.items as WithdrawalLineOriginRefundedDetails['items'] | undefined) ?? [];
        text = t('statusActions.inPerson.errOriginRefunded', {
          count: Math.max(1, items.length),
          items: items.map((i) => `${i.folio ?? i.inventoryItemId} · ${i.orderNumber ?? i.orderId ?? '—'}`).join('; '),
        });
      } else if (err?.status === 409 && err.code === 'CONFLICT' && d?.reason === 'nothing_to_ship') text = t('statusActions.inPerson.errNothingToShip');
      else if (err?.status === 409 && err.code === 'CONFLICT') text = t('statusActions.inPerson.errConflict');
      else text = getError(e);
      onFail(tg, text);
      void qc.invalidateQueries({ queryKey: ['admin-shipments'] });
      void qc.invalidateQueries({ queryKey: ['admin-preparation-queue'] });
    },
  });
  // Mientras el servidor responde no se cierra (Cancelar, Esc o fondo): el aviso de éxito/error nunca se pierde.
  const guardedClose = () => {
    if (!mutation.isPending) onClose();
  };

  const fee = (target?.feeCents !== undefined ? target.feeCents : full.data?.shippingFeeChargedCents) ?? 0;
  const recipientRaw = target?.recipient ?? (full.data?.addressSnapshot?.recipientName as string | undefined) ?? full.data?.recipientName;
  const recipient = recipientRaw?.trim() ? recipientRaw.trim() : t('statusActions.recipientUnknown');
  const loading = needsFetch && full.isLoading;
  const loadFailed = needsFetch && full.isError;

  return (
    <Modal
      open={target !== null}
      onClose={guardedClose}
      title={target ? t('statusActions.inPerson.title', { ref: target.ref }) : ''}
      footer={
        <>
          <Button ref={cancelRef} variant="secondary" disabled={mutation.isPending} onClick={guardedClose}>
            {tc('cancel')}
          </Button>
          <Button
            loading={mutation.isPending}
            disabled={loading || loadFailed}
            onClick={() => target && mutation.mutate(target)}
          >
            {t('statusActions.inPerson.confirm')}
          </Button>
        </>
      }
    >
      {target && (
        <div className="flex flex-col gap-2 text-sm text-text">
          <p>{t('statusActions.inPerson.body', { recipient })}</p>
          {loadFailed && (
            <p role="alert" className="text-accent" data-testid="in-person-load-error">
              {getError(full.error)}
            </p>
          )}
          {fee > 0 && (
            <p className="font-medium text-accent" data-testid="in-person-fee">
              {t('statusActions.inPerson.feeCharged', { amount: formatMoneyCents(fee, locale) })}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
