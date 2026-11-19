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
  }, [target]);

  const needsFetch = !!target && target.feeCents === undefined;
  const full = useQuery({
    queryKey: ['admin-shipment-in-person', target?.id ?? ''],
    queryFn: () => getAdminShipment(target!.id),
    enabled: needsFetch,
    gcTime: 0,
  });

  const mutation = useMutation({
    mutationFn: (id: string) => deliverShipmentInPerson(id),
    onSuccess: (_d, id) => {
      for (const queryKey of SHIPMENT_QUEUE_KEYS) void qc.invalidateQueries({ queryKey: [...queryKey] });
      if (target && target.id === id) onDone(target);
      onClose();
    },
    onError: (e, id) => {
      const tg = target;
      onClose();
      const err = e instanceof ApiClientError ? e : null;
      const text =
        err?.status === 409 && err.code === 'SHIPMENT_NOT_PREPARED'
          ? t('statusActions.inPerson.errNotPrepared')
          : err?.status === 409 && err.code === 'SHIPMENT_HAS_LABEL'
            ? t('statusActions.inPerson.errHasLabel')
            : err?.status === 409 && err.code === 'CONFLICT'
              ? t('statusActions.inPerson.errConflict')
              : getError(e);
      if (tg && tg.id === id) onFail(tg, text);
      void qc.invalidateQueries({ queryKey: ['admin-shipments'] });
      void qc.invalidateQueries({ queryKey: ['admin-preparation-queue'] });
    },
  });

  const fee = (target?.feeCents !== undefined ? target.feeCents : full.data?.shippingFeeChargedCents) ?? 0;
  const recipientRaw = target?.recipient ?? (full.data?.addressSnapshot?.recipientName as string | undefined) ?? full.data?.recipientName;
  const recipient = recipientRaw?.trim() ? recipientRaw.trim() : t('statusActions.recipientUnknown');
  const loading = needsFetch && full.isLoading;
  const loadFailed = needsFetch && full.isError;

  return (
    <Modal
      open={target !== null}
      onClose={onClose}
      title={target ? t('statusActions.inPerson.title', { ref: target.ref }) : ''}
      footer={
        <>
          <Button ref={cancelRef} variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button
            loading={mutation.isPending}
            disabled={loading || loadFailed}
            onClick={() => target && mutation.mutate(target.id)}
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
