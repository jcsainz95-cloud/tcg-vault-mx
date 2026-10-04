'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { cancelShipmentLabel, releaseShipmentLabel } from '@/lib/api';
import { asApiError } from '@/lib/api-client';
import { PICKING_SUMMARY_KEY } from '@/hooks/usePickingSummary';
import { useErrorMessage } from '@/components/ui/QueryState';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Textarea } from '@/components/ui/Textarea';
import { formatDateTimeMx, formatTimeMx } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { AppLocale } from '@/i18n/routing';
import { LABEL_T_STUCK_MINUTES, type LabelAlertDTO } from '@/types/contract';
import { TAG } from './prep-shared';

/**
 * Las piezas de la guía de Skydropx que comparten la tarjeta de «Preparar» y la fila de «Envíos»
 * (`DESIGN_SYSTEM §43.8b–c` · contrato `§M4-SHIP.19.8`, `§19.18.4`, `§19.20.2`): las cuatro alertas de guía,
 * «Liberar» (⇔ `labelAlert.canRelease`, ⛔ nunca por el rol de la sesión), «Reintentar cancelación» y el
 * diálogo de «Cancelar guía y comprar otra».
 */

function useInvalidateShipments() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['admin-shipments'] });
    void qc.invalidateQueries({ queryKey: ['admin-preparation-queue'] });
    void qc.invalidateQueries({ queryKey: PICKING_SUMMARY_KEY });
    void qc.invalidateQueries({ queryKey: ['departure-board'] });
  };
}

/** `{desde}` = `since` en `America/Mexico_City`, con fecha si no es hoy (§43.8c). */
export function useSince() {
  const locale = useLocale() as AppLocale;
  return (iso: string) => {
    const d = new Date(iso);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(d);
    return day === today ? formatTimeMx(iso, locale) : formatDateTimeMx(iso, locale);
  };
}

interface AlertProps {
  shipmentId: string;
  alert: LabelAlertDTO;
  /** Referencia del envío (`orderNumber ?? id`) para el cuerpo de «Liberar». */
  refText: string;
  trackingNumber: string | null;
  testId?: string;
}

/** Una alerta de guía (`labelAlert`), con su acción si la tiene. `role="status"`: llega con la lista. */
export function LabelAlertBlock({ shipmentId, alert, refText, trackingNumber, testId }: AlertProps) {
  const t = useTranslations('admin.m4.labelAlert');
  const tLabel = useTranslations('admin.m4.label');
  const since = useSince()(alert.since);
  const [dialog, setDialog] = useState<'release' | 'retry' | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const number = trackingNumber ?? t('liveOnCancelled.noNumber');

  let title: string;
  let body: React.ReactNode;
  let action: React.ReactNode = null;
  switch (alert.kind) {
    case 'label_unknown':
      title = t('unknown.title');
      body = (
        <>
          <p>{t('unknown.body', { since })}</p>
          {!alert.canRelease && <p>{t('unknown.ownerOnly')}</p>}
        </>
      );
      // UX-SDX-16: el botón existe ⇔ `canRelease` (⛔ ni apagado sin él).
      if (alert.canRelease) {
        action = (
          <Button size="sm" variant="ghost" onClick={() => setDialog('release')}>
            {tLabel('release.cta')}
          </Button>
        );
      }
      break;
    case 'label_processing_stuck':
      title = t('stuck.title');
      body = <p>{t('stuck.body', { minutes: LABEL_T_STUCK_MINUTES, since })}</p>;
      // A-6 (§43.17) abierta: que `label/cancel` acepte una guía sin número es NO MEDIDO ⇒ la alerta va SIN botón.
      break;
    case 'label_cancel_failed':
      title = t('cancelFailed.title');
      body = <p>{t('cancelFailed.body', { since })}</p>;
      action = (
        <Button size="sm" variant="secondary" onClick={() => setDialog('retry')}>
          {t('cancelFailed.retry')}
        </Button>
      );
      break;
    case 'label_live_on_cancelled':
    default:
      title = t('liveOnCancelled.title');
      body = <p>{t('liveOnCancelled.body', { number, since })}</p>;
      break;
  }

  return (
    <div className="flex flex-col gap-2" data-testid={testId ?? `label-alert-${shipmentId}`}>
      <Banner variant="warning" role="status" action={action ?? undefined}>
        <p className={cn(TAG, 'text-text')}>{title}</p>
        <div className="text-sm">{body}</div>
      </Banner>
      {result && (
        <p role="status" className="text-sm text-text">
          {result}
        </p>
      )}
      <ReleaseDialog open={dialog === 'release'} shipmentId={shipmentId} refText={refText} onClose={() => setDialog(null)} onDone={setResult} />
      <CancelLabelDialog
        open={dialog === 'retry'}
        variant="retry"
        shipmentId={shipmentId}
        trackingNumber={number}
        onClose={() => setDialog(null)}
        onDone={setResult}
      />
    </div>
  );
}

/** «¿Liberar este envío?» — `POST …/label/release` con la nota obligatoria (§43.8c). */
export function ReleaseDialog({
  open,
  shipmentId,
  refText,
  onClose,
  onDone,
}: {
  open: boolean;
  shipmentId: string;
  refText: string;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const t = useTranslations('admin.m4.label.release');
  const tCancel = useTranslations('admin.m4.label.cancel');
  const getError = useErrorMessage('operator');
  const invalidate = useInvalidateShipments();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) {
      setNote('');
      setError(null);
      backRef.current?.focus();
    }
  }, [open]);
  const m = useMutation({
    mutationFn: () => releaseShipmentLabel(shipmentId, note.trim()),
    onSuccess: (res) => {
      invalidate();
      const l = res.shipment.label;
      onDone(
        res.outcome === 'adopted'
          ? t('adopted', { carrier: l?.chosen.carrierLabel ?? res.shipment.carrier ?? '', number: l?.trackingNumber ?? res.shipment.trackingNumber ?? '' })
          : t('released'),
      );
      onClose();
    },
    onError: (e) => {
      const err = asApiError(e);
      const d = (err?.details ?? {}) as Record<string, unknown>;
      if (err?.code === 'LABEL_NOT_RELEASABLE') {
        if (d.reason === 'not_in_progress') return setError(t('notInProgress'));
        if (d.reason === 'has_provider_id') return setError(t('hasProviderId'));
        if (d.reason === 'too_early') return setError(t('tooEarly', { minutes: Math.ceil(Number(d.retryAfterSeconds ?? 60) / 60) }));
      }
      setError(getError(e));
    },
  });
  return (
    <Modal
      open={open}
      onClose={() => !m.isPending && onClose()}
      title={t('title')}
      footer={
        <>
          <Button ref={backRef} variant="secondary" onClick={onClose} disabled={m.isPending}>
            {tCancel('back')}
          </Button>
          <Button loading={m.isPending} onClick={() => m.mutate()}>
            {t('confirm')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text">{t('body', { ref: refText })}</p>
        <Textarea label={t('note')} hint={t('noteHint')} value={note} onChange={(e) => setNote(e.target.value)} />
        {error && (
          <Banner variant="danger" role="alert">
            {error}
          </Banner>
        )}
      </div>
    </Modal>
  );
}

/** «¿Cancelar la guía…?» (re-emitir) y su variante «Reintentar cancelación» (§43.8b–c). */
export function CancelLabelDialog({
  open,
  variant,
  shipmentId,
  trackingNumber,
  onClose,
  onDone,
}: {
  open: boolean;
  variant: 'reissue' | 'retry';
  shipmentId: string;
  trackingNumber: string;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const t = useTranslations('admin.m4.label.cancel');
  const tr = useTranslations('admin.m4.labelAlert.retryDialog');
  const tCarrier = useTranslations('admin.m4.carrierStatus');
  const tStatus = useTranslations('status.shipment');
  const tSdx = useTranslations('admin.m4.tracking.sdx');
  const getError = useErrorMessage('operator');
  const invalidate = useInvalidateShipments();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) {
      setReason('');
      setError(null);
      backRef.current?.focus();
    }
  }, [open]);
  const m = useMutation({
    mutationFn: () => cancelShipmentLabel(shipmentId, reason.trim()),
    onSuccess: (res) => {
      invalidate();
      if (variant === 'retry') onDone(res.outcome === 'cancelled' ? tr('done') : tr('already'));
      else onDone(res.outcome === 'cancelled' ? t('done') : t('already'));
      onClose();
    },
    onError: (e) => {
      const err = asApiError(e);
      const d = (err?.details ?? {}) as Record<string, unknown>;
      const status = (s: unknown) => (typeof s === 'string' && tStatus.has(s) ? tStatus(s) : String(s ?? '—'));
      const carrier = (s: unknown) => (typeof s === 'string' && tCarrier.has(s) ? tCarrier(s) : String(s ?? '—'));
      if (!err || err.status >= 500) return setError(t('providerDown'));
      if (err.code === 'SHIPPING_PROVIDER_REJECTED') {
        return setError([t('rejected'), typeof d.providerMessage === 'string' && d.providerMessage ? tSdx('error.providerSays', { message: d.providerMessage }) : ''].filter(Boolean).join(' '));
      }
      if (err.code === 'LABEL_NOT_CANCELLABLE') {
        if (d.reason === 'already_picked_up') return setError(t('pickedUp', { status: carrier(d.carrierStatus) }));
        if (d.reason === 'status') return setError(t('status', { status: status(d.status) }));
        if (d.reason === 'not_provider') return setError(t('notProvider'));
      }
      setError(getError(e));
    },
  });
  return (
    <Modal
      open={open}
      onClose={() => !m.isPending && onClose()}
      title={variant === 'retry' ? tr('title', { number: trackingNumber }) : t('title', { number: trackingNumber })}
      footer={
        <>
          <Button ref={backRef} variant="secondary" onClick={onClose} disabled={m.isPending}>
            {t('back')}
          </Button>
          <Button variant={variant === 'retry' ? 'primary' : 'destructive'} loading={m.isPending} onClick={() => m.mutate()}>
            {variant === 'retry' ? tr('confirm') : t('confirm')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text">{variant === 'retry' ? tr('body') : t('body')}</p>
        <Textarea label={t('reason')} hint={t('reasonHint')} value={reason} onChange={(e) => setReason(e.target.value)} />
        {error && (
          <Banner variant="danger" role="alert">
            {error}
          </Banner>
        )}
      </div>
    </Modal>
  );
}
