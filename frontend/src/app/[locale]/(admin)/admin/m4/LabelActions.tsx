'use client';

import { useEffect, useId, useRef, useState } from 'react';
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
import { formatDateTimeMx, formatMoneyCents, formatTimeMx } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { AppLocale } from '@/i18n/routing';
import {
  LABEL_T_STUCK_MINUTES,
  type InFlightUncertainReason,
  type LabelAlertDTO,
  type LabelPendingDTO,
} from '@/types/contract';
import { TAG } from './prep-shared';
import { useSellStatusLabel } from './capture/sell-status';

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
    // 💰 rev BSD-1: la guía de ENTRADA se ve en M5 (ficha y lista).
    void qc.invalidateQueries({ queryKey: ['admin-buylist'] });
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

/**
 * El destinatario y la dirección que «Liberar» enseña para cuadrar en el panel (§43.19.6): del snapshot que ya tiene la
 * superficie (`addressSnapshot` en «Envíos», `shipTo` en «Preparar»). ⛔ Sin teléfono ni referencias.
 */
export interface ReleaseRecipient {
  recipientName: string | null;
  line1: string | null;
  neighborhood: string | null;
  postalCode: string | null;
}

/** La frase de un `InFlightUncertainReason` (§43.19.5), compartida por ventana, alerta y «Liberar». */
export function useReasonText() {
  const t = useTranslations('admin.m4.tracking.sdx.reason');
  return (reason: InFlightUncertainReason | null | undefined, withPeriod = true) => {
    const text = reason && t.has(reason) ? t(reason) : t('none');
    return withPeriod ? text : text.replace(/\.\s*$/, '');
  };
}

interface AlertProps {
  shipmentId: string;
  alert: LabelAlertDTO;
  trackingNumber: string | null;
  /** 💰 §43.19.6: el reclamo vigente (folio, precio, paquetería, quién) para cuadrar en el panel. */
  labelPending?: LabelPendingDTO | null;
  recipient?: ReleaseRecipient | null;
  testId?: string;
}

/** Una alerta de guía (`labelAlert`), con su acción si la tiene. `role="status"`: llega con la lista. */
export function LabelAlertBlock({ shipmentId, alert, trackingNumber, labelPending, recipient, testId }: AlertProps) {
  const t = useTranslations('admin.m4.labelAlert');
  const tLabel = useTranslations('admin.m4.label');
  const reasonText = useReasonText();
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
      // §43.19.5: el cuerpo gana el motivo; sin `canRelease`, «un súper-admin» (⛔ no «el dueño»: P-SDX-REL en (a)).
      body = (
        <>
          <p>{t('unknown.body', { since, reason: reasonText(alert.reason) })}</p>
          {!alert.canRelease && <p>{t('unknown.superAdminOnly')}</p>}
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
    case 'label_orphan':
      // 🔒💰 §43.19.5 (§19.28.6): ⛔ sin botón (no hay verbo para adoptar ni cancelar una huérfana desde aquí) y sin «Liberar».
      title = t('orphan.title');
      body = <p>{t('orphan.body', { since })}</p>;
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
      {alert.kind === 'label_unknown' && alert.canRelease && (
        <ReleaseDialog
          open={dialog === 'release'}
          shipmentId={shipmentId}
          alert={alert}
          labelPending={labelPending ?? null}
          recipient={recipient ?? null}
          onClose={() => setDialog(null)}
          onDone={setResult}
        />
      )}
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

/**
 * 💰 «¿Liberar este envío?» — `POST …/label/release` con la nota obligatoria (§43.8c + §43.19.6). Enseña los datos para
 * cuadrar en el panel de Skydropx (el folio «Pedido ENV-…» primero: es lo único NUESTRO que Skydropx guarda) y, con un
 * conflicto (`reason='conflict'` o `409 provider_conflict`), la casilla `confirmConflict`: sin marcar ⇒ 0 peticiones.
 */
export function ReleaseDialog({
  open,
  shipmentId,
  alert,
  labelPending,
  recipient,
  onClose,
  onDone,
}: {
  open: boolean;
  shipmentId: string;
  alert: LabelAlertDTO;
  labelPending: LabelPendingDTO | null;
  recipient: ReleaseRecipient | null;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const t = useTranslations('admin.m4.label.release');
  const tCancel = useTranslations('admin.m4.label.cancel');
  const tv = useTranslations('admin.m4.tracking.sdx.verify');
  const locale = useLocale() as AppLocale;
  const reasonText = useReasonText();
  const getError = useErrorMessage('operator');
  const invalidate = useInvalidateShipments();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** §43.19.6: la casilla aparece con `reason='conflict'` o cuando el servidor la pidió (`409 provider_conflict`). */
  const [conflictAsked, setConflictAsked] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [checkError, setCheckError] = useState(false);
  const [copied, setCopied] = useState(false);
  const backRef = useRef<HTMLButtonElement>(null);
  const checkRef = useRef<HTMLInputElement>(null);
  const checkErrId = useId();
  useEffect(() => {
    if (open) {
      setNote('');
      setError(null);
      setConflictAsked(false);
      setConfirmed(false);
      setCheckError(false);
      setCopied(false);
      backRef.current?.focus();
    }
  }, [open]);
  const showConflict = alert.reason === 'conflict' || conflictAsked;
  const m = useMutation({
    // ⛔ Sin casilla pintada, el cuerpo NO lleva `confirmConflict` (lo decide `releaseShipmentLabel`).
    mutationFn: () => releaseShipmentLabel(shipmentId, note.trim(), showConflict && confirmed),
    onSuccess: (res) => {
      invalidate();
      const l = res.shipment.label;
      const v = res.verdict;
      onDone(
        res.outcome === 'adopted'
          ? t('adopted', { carrier: l?.chosen.carrierLabel ?? res.shipment.carrier ?? '', number: l?.trackingNumber ?? res.shipment.trackingNumber ?? '' })
          : v?.outcome === 'not_charged'
            ? t('releasedVerified')
            : v?.outcome === 'not_sent'
              ? t('releasedNotSent')
              : v && (v.outcome === 'pending' || v.outcome === 'uncertain')
                ? t('releasedUnverified', { reason: reasonText(v.reason, false) })
                : t('released'),
      );
      onClose();
    },
    onError: (e) => {
      const err = asApiError(e);
      const d = (err?.details ?? {}) as Record<string, unknown>;
      if (err?.code === 'LABEL_NOT_RELEASABLE') {
        if (d.reason === 'provider_conflict') {
          setConflictAsked(true);
          return setError(t('providerConflict'));
        }
        if (d.reason === 'not_in_progress') return setError(t('notInProgress'));
        if (d.reason === 'has_provider_id') return setError(t('hasProviderId'));
        if (d.reason === 'too_early') return setError(t('tooEarly', { minutes: Math.ceil(Number(d.retryAfterSeconds ?? 60) / 60) }));
      }
      setError(getError(e));
    },
  });
  function submit() {
    if (showConflict && !confirmed) {
      // ⛔ 0 peticiones: el error bajo la casilla y el foco a ella.
      setCheckError(true);
      checkRef.current?.focus();
      return;
    }
    m.mutate();
  }
  const none = t('data.none');
  const reference = labelPending?.providerReference ?? null;
  const refText = reference ? `Pedido ${reference}` : null;
  const address = recipient
    ? [[recipient.line1, recipient.neighborhood].map((x) => x?.trim()).filter(Boolean).join(', '), recipient.postalCode ? t('data.postalCode', { cp: recipient.postalCode }) : null]
        .filter(Boolean)
        .join(' · ')
    : '';
  const carrier = [labelPending?.carrierLabel, labelPending?.serviceName].filter(Boolean).join(' · ');
  const chosenBy = labelPending?.chosenBy
    ? `${labelPending.chosenBy.name?.trim() || none} · ${formatDateTimeMx(labelPending.since, locale)}`
    : labelPending
      ? formatDateTimeMx(labelPending.since, locale)
      : '';
  const DT = cn(TAG, 'text-muted');
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
          <Button loading={m.isPending} onClick={submit}>
            {t('confirm')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text">{t('intro', { reason: reasonText(alert.reason) })}</p>
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]" data-testid="release-data">
          <dt className={DT}>{t('data.reference')}</dt>
          <dd className="text-sm text-text">
            {refText ? (
              <span className="flex flex-wrap items-baseline gap-3">
                <span className="select-all font-mono text-[15px]">{refText}</span>
                <Button size="sm" variant="ghost" onClick={() => void navigator.clipboard?.writeText(refText).then(() => setCopied(true))}>
                  {copied ? tv('copied') : tv('copy')}
                </Button>
              </span>
            ) : (
              t('data.noReference')
            )}
          </dd>
          <dt className={DT}>{t('data.recipient')}</dt>
          <dd className="text-sm text-text">{recipient?.recipientName?.trim() || none}</dd>
          <dt className={DT}>{t('data.address')}</dt>
          <dd className="text-sm text-text">{address || none}</dd>
          <dt className={DT}>{t('data.carrier')}</dt>
          <dd className="text-sm text-text">{carrier || none}</dd>
          <dt className={DT}>{t('data.price')}</dt>
          <dd className="tabular text-sm text-text">{labelPending?.priceCents != null ? formatMoneyCents(labelPending.priceCents, locale) : none}</dd>
          <dt className={DT}>{t('data.chosenBy')}</dt>
          <dd className="text-sm text-text">{chosenBy || none}</dd>
        </dl>
        <p className="text-sm text-text">{t('body')}</p>
        {showConflict && (
          <div className="flex flex-col gap-1">
            <label className="flex items-start gap-2 text-sm text-text">
              <input
                ref={checkRef}
                type="checkbox"
                className="mt-1"
                checked={confirmed}
                aria-invalid={checkError || undefined}
                aria-describedby={checkError ? checkErrId : undefined}
                onChange={(e) => {
                  setConfirmed(e.target.checked);
                  if (e.target.checked) setCheckError(false);
                }}
              />
              <span>{t('conflict.label')}</span>
            </label>
            {checkError && (
              <p id={checkErrId} className="text-sm text-accent">
                {t('conflict.required')}
              </p>
            )}
          </div>
        )}
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
  inbound = false,
}: {
  open: boolean;
  variant: 'reissue' | 'retry';
  shipmentId: string;
  trackingNumber: string;
  onClose: () => void;
  onDone: (msg: string) => void;
  /** 💰 rev BSD-1 (§BSD-UX.6a, §BSD.4.6): la guía de ENTRADA (re-emitir re-ancla el cierre de la solicitud). */
  inbound?: boolean;
}) {
  const t = useTranslations('admin.m4.label.cancel');
  const sellStatus = useSellStatusLabel();
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
      // 💰 rev BSD-1: `done` dice «el envío volvió a preparado» (salida). En entrada devuelve `''` con `cancelled` y el panel
      // de M5 compone `inbound.reissueDone` con el id de la solicitud (✏ vBSD-1.1).
      else if (inbound) onDone(res.outcome === 'cancelled' ? '' : t('already'));
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
        // 💰 §BSD.4.6: las dos guardas de la SOLICITUD sobre la fila de entrada.
        if (d.reason === 'sell_request_status') {
          return setError(tSdx('inbound.reissueNotAccepted', { status: sellStatus(d.status) }));
        }
        if (d.reason === 'seller_declared_shipped') return setError(tSdx('inbound.reissueSellerShipped'));
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
        <p className="text-sm text-text">{variant === 'retry' ? tr('body') : inbound ? tSdx('inbound.reissueBody') : t('body')}</p>
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
