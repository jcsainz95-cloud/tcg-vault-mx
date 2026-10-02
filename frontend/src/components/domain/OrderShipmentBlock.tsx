'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';
import { formatDate } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { PipelineStepper } from '@/components/ui/PipelineStepper';
import { TRACKING_STATUS_KEY, TRACKING_STEPS, stepForStatus } from '@/app/[locale]/pedido/tracking-status';
import type { CustomerOrderShipmentDTO, FulfillmentMode, GuestOrderPublicStatus } from '@/types/contract';

/**
 * **«Tu envío»** en el detalle del pedido del cliente registrado (`DESIGN_SYSTEM §37.12` · contrato
 * `§M4-SHIP.16`, criterio 230). Paridad con el seguimiento del invitado: el progreso es el MISMO mapeo
 * (`tracking-status.ts`, extraído, ⛔ no copiado) y la lista de datos es la cerrada del contrato —
 * destinatario, ciudad, estado y CP; ⛔ sin calle, colonia ni teléfono.
 *
 * - `fulfillmentMode === 'vault'` ⇒ **«En tu bóveda»** + «Ver mi bóveda»; ⛔ sin paquetería ni dirección.
 * - Envío `cancelado` ⇒ ningún bloque propio: el rótulo del pedido (`reembolsado` / `en_revision`) ya lo
 *   dice; con `en_revision` se pinta la línea de soporte.
 * - Sin guía todavía ⇒ **«Guía: todavía no»** (S8, nunca «—»).
 */
export function OrderShipmentBlock({
  shipment,
  publicStatus,
  fulfillmentMode,
  className,
}: {
  shipment: CustomerOrderShipmentDTO | null | undefined;
  publicStatus: GuestOrderPublicStatus | undefined;
  fulfillmentMode: FulfillmentMode | undefined;
  className?: string;
}) {
  const t = useTranslations('orders.shipment');
  const tRoot = useTranslations();
  const locale = useLocale() as AppLocale;
  const [copied, setCopied] = useState(false);

  if (fulfillmentMode === 'vault') {
    return (
      <section aria-labelledby="order-shipment" className={className} data-testid="order-shipment-vault">
        <h2 id="order-shipment" className="eyebrow">
          {t('title')}
        </h2>
        <p className="mt-3 font-mono text-[11px] uppercase tracking-label text-text">{t('inVault')}</p>
        <Link href="/vault" className="mt-2 inline-block text-sm text-accent underline-offset-4 hover:text-text hover:underline">
          {t('seeVault')}
        </Link>
      </section>
    );
  }

  if (!shipment || shipment.status === 'cancelado') {
    if (publicStatus === 'en_revision') {
      return (
        <p className={className} data-testid="order-shipment-in-review">
          <span className="text-sm leading-relaxed text-muted">{t('inReview')}</span>
        </p>
      );
    }
    return null;
  }

  const step = publicStatus ? stepForStatus(publicStatus) : null;
  const dates: Partial<Record<(typeof TRACKING_STEPS)[number], string | null>> = {
    preparando: shipment.pickingAt,
    enviado: shipment.shippedAt,
    entregado: shipment.deliveredAt,
  };

  async function copy() {
    if (!shipment?.trackingNumber) return;
    try {
      await navigator.clipboard?.writeText(shipment.trackingNumber);
      setCopied(true);
    } catch {
      /* sin clipboard: la guía sigue visible y seleccionable */
    }
  }

  return (
    <section aria-labelledby="order-shipment" className={className} data-testid="order-shipment">
      <h2 id="order-shipment" className="eyebrow">
        {t('title')}
      </h2>
      <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm text-text">
        {shipment.carrier && <span>{t('carrier', { carrier: shipment.carrier })}</span>}
        {shipment.trackingNumber ? (
          <>
            <span className="tabular font-mono" data-testid="order-tracking-number">
              {t('tracking', { number: shipment.trackingNumber })}
            </span>
            <Button variant="ghost" size="sm" onClick={copy}>
              {copied ? t('copied') : t('copy')}
            </Button>
            {copied && (
              <span role="status" className="sr-only">
                {t('copied')}
              </span>
            )}
          </>
        ) : (
          <span className="font-mono text-[11px] uppercase tracking-label text-muted">{t('trackingNone')}</span>
        )}
      </div>
      {step && (
        <div className="mt-5">
          <PipelineStepper
            current={step}
            steps={TRACKING_STEPS.map((key) => {
              const date = dates[key];
              return { key, label: date ? `${tRoot(TRACKING_STATUS_KEY[key])} · ${formatDate(date, locale)}` : tRoot(TRACKING_STATUS_KEY[key]) };
            })}
          />
        </div>
      )}
      <p className="mt-4 text-sm text-text" data-testid="order-ship-to">
        {t('to', { name: shipment.shipTo.recipientName, city: shipment.shipTo.city, state: shipment.shipTo.state, zip: shipment.shipTo.postalCode })}
      </p>
      <p className="mt-2 font-mono text-[11px] text-muted">
        {t('reference', { id: shipment.id })} · {t('referenceHint')}
      </p>
      {shipment.missingCount > 0 && (
        <p className="mt-3 text-sm text-text" data-testid="order-shipment-missing">
          {t('missing', { count: shipment.missingCount })}
        </p>
      )}
    </section>
  );
}
