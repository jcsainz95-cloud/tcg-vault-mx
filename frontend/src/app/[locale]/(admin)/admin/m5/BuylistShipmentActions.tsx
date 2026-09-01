'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { captureBuylistGuide, confirmBuylistShipment } from '@/lib/api';
import type { AppLocale } from '@/i18n/routing';
import type { AdminBuylistDTO } from '@/types/contract';
import { formatDateTimeMx } from '@/lib/format';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { useErrorMessage } from '@/components/ui/QueryState';

/** Pesos tecleados → centavos. `undefined` si el campo está vacío (es opcional). */
function pesosToCents(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  const pesos = Number.parseFloat(trimmed);
  return Number.isFinite(pesos) && pesos >= 0 ? Math.round(pesos * 100) : undefined;
}

/**
 * **GUÍA Y CONFIRMACIÓN DE ENVÍO** (contrato §M5 · D19/D20/D21, criterios 122/123/137/138).
 *
 * > **El corazón del diseño, y por qué son DOS actos y no uno.** El plazo mide **una acción del
 * > vendedor** —que deposite el paquete— pero **nos enteramos por una acción nuestra** —que alguien
 * > lo confirme—. Sin separarlos, quien deposita el día 3 pierde su venta si el operador confirma
 * > el día 4, **y encima ya gastamos la guía**.
 *
 * De ahí las tres reglas que esta pantalla tiene que hacer evidentes, no solo respetar:
 *
 * 1. **Capturar la guía NO mueve el estado.** Solo **congela el plazo del vendedor**, y el reloj
 *    arranca **con la entrega de la guía, no con la aceptación**: *sería injusto correrle el reloj
 *    mientras espera una etiqueta que depende de nosotros.* Mientras no haya guía, `shipDeadlineAt`
 *    es `null` ⇒ **la solicitud no expira**, y eso es correcto.
 * 2. **Solo CONFIRMAR mueve a `en_transito`** — y es lo único que hace que estas cartas empiecen a
 *    contar como «en camino» en la mesa de decisión **de otras solicitudes**.
 * 3. **El «ya lo mandé» del vendedor no mueve nada**: detiene **su** reloj. Se pinta como un
 *    renglón informativo, **nunca como un estado ni como un badge** — un segundo badge invitaría a
 *    leerlo como estado y a contarlo como inventario en camino, que es justo lo prohibido.
 */
export function BuylistShipmentActions({ request }: { request: AdminBuylistDTO }) {
  const t = useTranslations('admin.m5.shipment');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const queryClient = useQueryClient();
  const getErrorMessage = useErrorMessage();

  const [carrier, setCarrier] = useState(request.shipmentCarrier ?? '');
  const [tracking, setTracking] = useState(request.shipmentTrackingNumber ?? '');
  const [actualCost, setActualCost] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState<'guide' | 'shipment' | null>(null);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-buylist'] });
    void queryClient.invalidateQueries({ queryKey: ['buylist-pending-shipment'] });
  };

  const guide = useMutation({
    mutationFn: () =>
      captureBuylistGuide(request.id, { carrier: carrier.trim(), trackingNumber: tracking.trim() }),
    onSuccess: () => {
      setDone('guide');
      invalidate();
    },
  });

  const confirm = useMutation({
    mutationFn: () =>
      confirmBuylistShipment(request.id, {
        ...(pesosToCents(actualCost) != null ? { guideActualCostCents: pesosToCents(actualCost) } : {}),
      }),
    onSuccess: () => {
      setConfirming(false);
      setDone('shipment');
      invalidate();
    },
  });

  const hasGuide = !!request.guideSentAt;
  const canCapture = carrier.trim().length > 0 && tracking.trim().length > 0;

  return (
    <section className="rule-note-quiet flex flex-col gap-4 py-2" data-testid="shipment-actions">
      <h4 className="eyebrow">{t('title')}</h4>

      {done === 'guide' && <Banner variant="info" role="status">{t('captured', { carrier, tracking })}</Banner>}
      {done === 'shipment' && <Banner variant="info" role="status">{t('confirmed')}</Banner>}

      {/* --- 1. La guía. NO mueve el estado, y el copy lo dice antes de que se pulse nada. --- */}
      <div className="flex flex-col gap-2">
        <p className="text-xs leading-[1.6] text-muted">{t('guideNote')}</p>
        <div className="flex flex-wrap items-end gap-3">
          <Input
            label={t('carrier')}
            value={carrier}
            maxLength={100}
            onChange={(e) => setCarrier(e.target.value)}
            className="w-44"
          />
          <Input
            label={t('trackingNumber')}
            value={tracking}
            maxLength={100}
            onChange={(e) => setTracking(e.target.value)}
            className="w-56"
          />
          <Button
            size="sm"
            variant="secondary"
            className="mb-1"
            disabled={!canCapture}
            loading={guide.isPending}
            onClick={() => guide.mutate()}
          >
            {hasGuide ? t('recaptureCta') : t('captureCta')}
          </Button>
        </div>
        {/* El plazo del vendedor: si no hay guía se DICE que no ha arrancado, en vez de dejar un
            hueco que se lea como «sin plazo» o, peor, como «ya venció». */}
        <p className="tabular text-xs text-muted">
          {request.shipDeadlineAt
            ? t('shipDeadline', { date: formatDateTimeMx(request.shipDeadlineAt, locale) })
            : t('noShipDeadline')}
        </p>
        {guide.isError && (
          <Banner variant="danger" role="alert">
            {getErrorMessage(guide.error)}
          </Banner>
        )}
      </div>

      {/* --- 2. El «ya lo mandé»: renglón informativo, NUNCA un badge. --- */}
      {request.sellerShippedDeclaredAt && (
        <div className="flex flex-col gap-1" data-testid="seller-declared">
          <span className="eyebrow">{t('declaredTitle')}</span>
          <p className="tabular text-xs text-text">
            {t('declaredAt', { date: formatDateTimeMx(request.sellerShippedDeclaredAt, locale) })}
          </p>
          <p className="text-xs leading-[1.6] text-muted">{t('declaredNote')}</p>
        </div>
      )}

      {/* --- 3. Confirmar: lo ÚNICO que mueve a `en_transito`. --- */}
      <div className="flex flex-col gap-2">
        <span className="eyebrow">{t('confirmTitle')}</span>
        <p className="text-xs leading-[1.6] text-muted">{t('confirmNote')}</p>
        <div className="flex flex-wrap items-end gap-3">
          <Input
            label={t('actualCostLabel')}
            type="number"
            inputMode="decimal"
            step="0.01"
            min={0}
            value={actualCost}
            onChange={(e) => setActualCost(e.target.value)}
            className="w-44"
          />
          <Button size="sm" className="mb-1" onClick={() => setConfirming(true)}>
            {t('confirmCta')}
          </Button>
        </div>
        {/* ⚠️ La frontera money-safe, dicha en la pantalla donde alguien podría creer lo contrario. */}
        <p className="text-xs leading-[1.6] text-muted">{t('actualCostHint')}</p>
        {confirm.isError && (
          <Banner variant="danger" role="alert">
            {getErrorMessage(confirm.error)}
          </Banner>
        )}
      </div>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t('confirmDialogTitle')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              {tc('cancel')}
            </Button>
            <Button loading={confirm.isPending} onClick={() => confirm.mutate()}>
              {t('confirmCta')}
            </Button>
          </>
        }
      >
        <p className="leading-[1.7]">{t('confirmDialogBody')}</p>
        {/* `guideSentAt` NO es precondición: si el paquete llegó sin guía capturada, negar la
            confirmación **no devuelve el paquete**. Se avisa, se confirma y queda anotado. */}
        {!hasGuide && (
          <p className="mt-3 text-xs leading-[1.6] text-accent">{t('confirmDialogNoGuide')}</p>
        )}
      </Modal>
    </section>
  );
}
