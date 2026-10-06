'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getAdminBuylistRequest, openBuylistInboundShipment } from '@/lib/api';
import { asApiError } from '@/lib/api-client';
import { formatMoneyCents } from '@/lib/format';
import type { AppLocale } from '@/i18n/routing';
import type { AdminBuylistDTO } from '@/types/contract';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { useErrorMessage } from '@/components/ui/QueryState';
import { CaptureLabelDialog, type CaptureSaved, type CaptureTarget } from '../m4/CaptureLabelDialog';
import { CancelLabelDialog, LabelAlertBlock } from '../m4/LabelActions';
import { openLabelPdf } from '../m4/capture/label-pdf';
import { inboundErrorView } from '../m4/capture/sdx-errors';
import { useSellStatusLabel } from '../m4/capture/sell-status';
import { BuylistShipmentActions } from './BuylistShipmentActions';
import { DeclineAcceptedDialog, liveSkydropxGuide, type DeclineAcceptedOutcome } from './DeclineAcceptedDialog';
import { GuideDueBlock } from './GuideDueMark';

/**
 * 💰 rev BSD-1 — **la ficha de una solicitud `aceptada` en M5** (DESIGN_SYSTEM §BSD-UX.6a–c · contrato §BSD.4–§BSD.6,
 * BSD-1.3 punto 4).
 *
 * Todo lo que decide qué se ve viene del SERVIDOR (BX5):
 *  - «Generar guía con Skydropx» ⇔ `inboundLabelOptions.provider === 'skydropx'` (solo en el DETALLE, por actor) ∧ sin
 *    guía (ni manual, ni de Skydropx viva, ni compra en curso). BSD-F1.
 *  - «Declinar» ⇔ `declineAcceptedAllowed === true` (BSD-F5: ⛔ por `status`).
 *  - La marca del cierre ⇔ `guideDueAt` / `guideDueSoon` / `guideDueInDays` (BSD-F6: ⛔ ningún reloj de pantalla).
 *  - La alerta de la guía de entrada ⇔ `inboundShipment.labelAlert` (el MISMO `labelAlertOf` de M4).
 * La ventana es la MISMA de M4 (`CaptureLabelDialog`, SK1) en modo entrada.
 */
export function AcceptedRequestPanel({
  req,
  onNotice,
}: {
  req: AdminBuylistDTO;
  /** Aviso a nivel de página (éxito) o sobre la ficha (`warning` tras un `409` de «Declinar»). */
  onNotice: (n: { variant: 'success' | 'warning'; text: string; requestId: string }) => void;
}) {
  const t = useTranslations('admin.m5.inbound');
  const tm5 = useTranslations('admin.m5');
  const tSdx = useTranslations('admin.m4.tracking.sdx');
  const tLabel = useTranslations('admin.m4.label');
  const tShipment = useTranslations('status.shipment');
  const sellStatusLabel = useSellStatusLabel();
  const locale = useLocale() as AppLocale;
  const qc = useQueryClient();
  const getError = useErrorMessage('operator');

  // El DETALLE trae `inboundLabelOptions` (por actor); la lista no. Mismo prefijo de clave ⇒ se invalida con la lista.
  const detail = useQuery({
    queryKey: ['admin-buylist', 'detail', req.id],
    queryFn: () => getAdminBuylistRequest(req.id),
    retry: false,
  });
  const r: AdminBuylistDTO = detail.data ? { ...req, ...detail.data } : req;

  const [target, setTarget] = useState<CaptureTarget | null>(null);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<{ text: string; hideButton: boolean } | null>(null);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [reissueOpen, setReissueOpen] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const inbound = r.inboundShipment ?? null;
  const sdx = liveSkydropxGuide(r);
  const processing = inbound?.labelProcessing === true;
  const hasManualGuide = !!r.shipmentTrackingNumber && !sdx;
  const sdxEnabled = r.inboundLabelOptions?.provider === 'skydropx';
  const canGenerate =
    sdxEnabled && !sdx && !processing && !hasManualGuide && !r.sellerShippedDeclaredAt && !openError?.hideButton;

  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin-buylist'] });

  async function generate() {
    if (opening) return;
    setOpening(true);
    setOpenError(null);
    try {
      const res = await openBuylistInboundShipment(r.id);
      setTarget({
        id: res.shipment.id,
        ref: r.id,
        folio: res.shipment.folio ?? null,
        carrier: null,
        trackingNumber: null,
        sellRequestId: r.id,
      });
    } catch (e) {
      const err = asApiError(e);
      if (err?.code === 'FEATURE_DISABLED') {
        setOpenError({ text: tSdx('inbound.error.featureDisabled'), hideButton: true });
      } else {
        const v = inboundErrorView(e, tSdx, {
          statusLabel: (s) => (typeof s === 'string' && tShipment.has(s) ? tShipment(s) : String(s ?? '—')),
          sellStatusLabel,
        });
        setOpenError({ text: v?.text || getError(e), hideButton: false });
        if (err?.code === 'GUIDE_NOT_ALLOWED') refresh();
      }
    } finally {
      setOpening(false);
    }
  }

  function openExisting() {
    if (!inbound) return;
    setTarget({ id: inbound.id, ref: r.id, folio: inbound.folio, carrier: inbound.carrier, trackingNumber: inbound.trackingNumber, sellRequestId: r.id });
  }

  function onSaved(s: CaptureSaved) {
    refresh();
    if (s.kind === 'skydropx') onNotice({ variant: 'success', requestId: r.id, text: t('bought', { id: r.id, carrier: s.carrier, tracking: s.number }) });
  }

  function onDeclined(o: DeclineAcceptedOutcome) {
    refresh();
    void qc.invalidateQueries({ queryKey: ['admin-buylist-closed'] });
    onNotice({ variant: o.kind === 'done' ? 'success' : 'warning', requestId: r.id, text: o.text });
  }

  return (
    <section className="flex flex-col gap-3" data-testid={`m5-accepted-panel-${r.id}`}>
      <GuideDueBlock req={r} />

      {/* La guía de Skydropx de entrada: viva, en proceso o con alerta. */}
      {sdx && (
        <div className="flex flex-col gap-1" data-testid="m5-inbound-live">
          <p className="text-sm text-text">{t('summary', { carrier: sdx.carrier ?? '—', tracking: sdx.trackingNumber ?? '—' })}</p>
          {/* C-5: bruto pagado (con IVA y seguro), tal cual; ⛔ la pantalla no suma el desglose. */}
          <p className="tabular text-sm text-text">{t('cost', { cost: formatMoneyCents(sdx.costCents, locale) })}</p>
          <div className="mt-1 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setPdfError(null);
                openLabelPdf(sdx.id, r.id.slice(0, 8), 'download').catch((e) =>
                  setPdfError(asApiError(e)?.code === 'LABEL_NOT_AVAILABLE' ? tLabel('notAvailable') : tSdx('label.printError')),
                );
              }}
            >
              {tSdx('label.download')}
            </Button>
            {!r.sellerShippedDeclaredAt && (
              <Button size="sm" variant="ghost" onClick={() => setReissueOpen(true)}>
                {tLabel('cancel.cta')}
              </Button>
            )}
          </div>
          {pdfError && <p className="text-sm text-accent">{pdfError}</p>}
          <CancelLabelDialog
            open={reissueOpen}
            variant="reissue"
            inbound
            shipmentId={sdx.id}
            trackingNumber={sdx.trackingNumber ?? '—'}
            onClose={() => setReissueOpen(false)}
            onDone={(msg) => {
              refresh();
              // ✏ vBSD-1.1 (§BSD-UX.6a): en entrada el diálogo devuelve `''` con `outcome:'cancelled'` (no conoce la
              // solicitud); la frase `reissueDone` la compone el panel. Otro desenlace trae su texto (`already`).
              onNotice({ variant: 'success', requestId: r.id, text: msg || tSdx('inbound.reissueDone', { id: r.id }) });
            }}
          />
        </div>
      )}
      {processing && !sdx && (
        <div className="flex flex-wrap items-center gap-3" data-testid="m5-inbound-processing">
          <p className="text-sm text-text">{t('processing')}</p>
          <Button size="sm" variant="ghost" onClick={openExisting}>
            {t('openLabel')}
          </Button>
        </div>
      )}
      {inbound?.labelAlert && (
        <div className="flex flex-col gap-2">
          <LabelAlertBlock
            shipmentId={inbound.id}
            alert={inbound.labelAlert}
            trackingNumber={inbound.trackingNumber}
            testId={`m5-inbound-alert-${r.id}`}
          />
          <Button size="sm" variant="ghost" className="self-start" onClick={openExisting}>
            {t('openLabel')}
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {canGenerate && (
          <Button size="sm" variant="primary" loading={opening} onClick={generate} data-testid={`m5-inbound-generate-${r.id}`}>
            {t('generate')}
          </Button>
        )}
        {/* §BSD-UX.6b: `secondary` (⛔ `destructive`: contestarle al vendedor no destruye nada suyo). ⛔ Por `status`. */}
        {r.declineAcceptedAllowed === true && (
          <Button size="sm" variant="secondary" onClick={() => setDeclineOpen(true)} data-testid={`m5-decline-accepted-${r.id}`}>
            {tm5('declineAccepted.action')}
          </Button>
        )}
      </div>
      <div role="status" aria-live="polite" className="text-sm text-text">
        {opening ? t('preparing') : null}
      </div>
      {openError && (
        <Banner variant="danger" role="alert">
          {openError.text}
        </Banner>
      )}

      {/* Captura a mano (§BSD-UX.6a): secundaria del botón de Skydropx, o único camino sin él. Con guía de Skydropx viva o
          compra en curso NO se pinta. «Confirmar envío» sigue; con guía de Skydropx sin campo de costo (lo dio Skydropx). */}
      <BuylistShipmentActions request={r} hideGuideCapture={!!sdx || processing} providerCostCents={sdx ? sdx.costCents : null} />

      <CaptureLabelDialog target={target} onClose={() => setTarget(null)} onSaved={onSaved} />
      <DeclineAcceptedDialog req={r} open={declineOpen} onClose={() => setDeclineOpen(false)} onOutcome={onDeclined} />
    </section>
  );
}
