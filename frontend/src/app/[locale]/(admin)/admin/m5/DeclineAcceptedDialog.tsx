'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { declineAcceptedBuylistRequest, getAdminBuylistRequest } from '@/lib/api';
import { asApiError } from '@/lib/api-client';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Textarea } from '@/components/ui/Textarea';
import { useErrorMessage } from '@/components/ui/QueryState';
import type { AdminBuylistDTO } from '@/types/contract';
import { useSellStatusLabel } from '../m4/capture/sell-status';

const REASON_MIN = 3;
const REASON_MAX = 500;

/** La guía VIVA de Skydropx de la solicitud (para la línea `bodySdx`). */
export function liveSkydropxGuide(req: Pick<AdminBuylistDTO, 'inboundShipment'>) {
  const s = req.inboundShipment;
  return s && s.labelSource === 'skydropx' && s.status === 'guia' && !s.providerCanceledAt ? s : null;
}

export type DeclineAcceptedOutcome =
  | { kind: 'done'; text: string }
  /** `409`: no se declinó; el texto va en `Banner warning` sobre la ficha releída. */
  | { kind: 'conflict'; text: string };

/**
 * 💰 rev BSD-1 — **«Declinar» en «Aceptada»** (DESIGN_SYSTEM §BSD-UX.6b · contrato §BSD.6, `POST
 * /admin/buylist/:id/decline-accepted`).
 *
 * ⛔ **Quien lo abre decide con `declineAcceptedAllowed === true`** (BSD-F5): el botón no existe por `status`.
 * ⛔ **El motivo es INTERNO** (BX6): va a la bitácora; el rótulo lo dice.
 * ⛔ **Un clic, una petición.** Ante `5xx`/red NO se reintenta: se RELEE la solicitud (`GET /admin/buylist/:id`) y se
 * decide por su estado — `expirada` ⇒ hecho; si no ⇒ «No se declinó». Un segundo `POST` daría `409`, no otro correo, pero
 * la pantalla no adivina.
 * La cuenta de 3 caracteres es formato del control (botón apagado con su razón visible y unida, §15.9); el `400` del
 * servidor sigue mandando.
 */
export function DeclineAcceptedDialog({
  req,
  open,
  onClose,
  onOutcome,
}: {
  req: AdminBuylistDTO;
  open: boolean;
  onClose: () => void;
  onOutcome: (o: DeclineAcceptedOutcome) => void;
}) {
  const t = useTranslations('admin.m5.declineAccepted');

  const tm5 = useTranslations('admin.m5');
  const getError = useErrorMessage('operator');
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const reasonWhyId = useId();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; field?: boolean } | null>(null);

  useEffect(() => {
    if (!open) return;
    setReason('');
    setError(null);
    // Foco inicial en «Motivo»: es lo único que falta para confirmar (el `Modal` enfoca su marco al abrir).
    const h = setTimeout(() => reasonRef.current?.focus(), 0);
    return () => clearTimeout(h);
  }, [open]);

  const trimmed = reason.trim();
  const tooShort = trimmed.length < REASON_MIN;
  const tooLong = trimmed.length > REASON_MAX;
  const canConfirm = !tooShort && !tooLong && !busy;
  const statusLabel = useSellStatusLabel();

  const sdx = liveSkydropxGuide(req);
  // Solo UNA línea de guía: Skydropx viva > compra en curso > manual. ⛔ Ninguna cifra del costo (no es decisión de dinero).
  const guideLine = sdx
    ? t('bodySdx', { carrier: sdx.carrier ?? '—', tracking: sdx.trackingNumber ?? '—' })
    : req.inboundShipment?.labelProcessing
      ? t('bodyInProgress')
      : req.shipmentTrackingNumber
        ? t('bodyManual', { carrier: req.shipmentCarrier ?? '—', tracking: req.shipmentTrackingNumber })
        : null;

  async function confirm() {
    if (!canConfirm) return;
    setBusy(true);
    setError(null);
    try {
      await declineAcceptedBuylistRequest(req.id, { reason: trimmed });
      onOutcome({ kind: 'done', text: t('done', { id: req.id }) });
      onClose();
    } catch (e) {
      const err = asApiError(e);
      const d = (err?.details ?? {}) as Record<string, unknown>;
      if (err && err.status === 409) {
        const text =
          d.reason === 'seller_declared_shipped'
            ? t('error.sellerShipped')
            : d.reason === 'shipment_confirmed'
              ? t('error.shipmentConfirmed')
              : t('error.status', { status: statusLabel(d.status) });
        onOutcome({ kind: 'conflict', text });
        onClose();
      } else if (err && err.status === 400) {
        setError({ text: t('error.reason'), field: true });
        reasonRef.current?.focus();
      } else if (err && err.status === 403) {
        setError({ text: t('error.forbidden') });
      } else if (err && err.status < 500) {
        setError({ text: getError(e) });
      } else {
        // 5xx / red: «no sabemos» ⇒ RELEER y decidir por el estado (⛔ reintento a ciegas).
        setError({ text: t('error.unknown') });
        try {
          const fresh = await getAdminBuylistRequest(req.id);
          if (fresh.status === 'expirada') {
            onOutcome({ kind: 'done', text: t('done', { id: req.id }) });
            onClose();
          } else {
            setError({ text: t('error.notDone') });
          }
        } catch {
          setError({ text: t('error.notDone') });
        }
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title={t('title')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('back')}
          </Button>
          <Button
            variant="primary"
            disabled={!canConfirm}
            loading={busy}
            aria-describedby={tooShort || tooLong ? reasonWhyId : undefined}
            onClick={confirm}
            data-testid="m5-decline-accepted-confirm"
          >
            {t('confirm')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="m5-decline-accepted-dialog">
        <p className="leading-[1.7]">{t('body')}</p>
        {guideLine && (
          <p className="leading-[1.7]" data-testid="m5-decline-accepted-guide">
            {guideLine}
          </p>
        )}
        <Textarea
          ref={reasonRef}
          label={t('reasonLabel')}
          hint={t('reasonHint')}
          error={error?.field ? error.text : undefined}
          aria-required="true"
          maxLength={REASON_MAX + 50}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          data-testid="m5-decline-accepted-reason"
        />
        {(tooShort || tooLong) && (
          <p id={reasonWhyId} className="text-sm text-muted" data-testid="m5-decline-accepted-why">
            {tooLong ? tm5('desk.reasonTooLong') : t('reasonTooShort')}
          </p>
        )}
        {error && !error.field && (
          <Banner variant="danger" role="alert">
            {error.text}
          </Banner>
        )}
      </div>
    </Modal>
  );
}
