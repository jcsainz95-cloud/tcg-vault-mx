'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { AppLocale } from '@/i18n/routing';
import type { AdminBuylistDTO } from '@/types/contract';
import { formatUpdatedMx, movedBySystem, readInboundCarrier } from '@/lib/buylist-inbound-carrier';

/**
 * §BUYLIST-RASTREO — estado de la paquetería de la guía de entrada.
 *  - `line` (cinta): estado · fecha estimada, hora de actualización, «marcado en tránsito por la paquetería»; sin
 *    datos ⇒ «Aún sin movimiento de la paquetería» (guía nuestra) o «Sin rastreo automático» (guía del vendedor / error).
 *  - `notes` (ficha, `aceptada` y `en_transito`): «Falta recibirlo», incidencia, «Va de regreso al vendedor».
 */
export function InboundCarrierStatus({ req, mode = 'line' }: { req: AdminBuylistDTO; mode?: 'line' | 'notes' }) {
  const t = useTranslations('admin.m5.carrier');
  const locale = useLocale() as AppLocale;
  const c = readInboundCarrier(req);

  if (mode === 'notes') {
    if (!c?.kind && c?.stalledDays == null) return null;
    return (
      <div className="flex flex-col gap-0.5" data-testid="m5-inbound-carrier-notes">
        {c?.stalledDays != null && <p className="text-sm text-accent" data-testid="m5-stalled">{t('stalled', { n: c.stalledDays })}</p>}
        {c?.kind === 'delivered' && <p className="text-sm text-text">{t('deliveredWaiting')}</p>}
        {c?.kind === 'incident' && <p className="text-sm text-accent">{t('incidentNote')}</p>}
        {c?.kind === 'returning' && <p className="text-sm text-accent">{t('returningNote')}</p>}
      </div>
    );
  }

  const auto = movedBySystem(req);
  const label = c?.kind ? t(c.kind) : null;
  // `estimatedDeliveryAt` llega siempre null del servidor: no se pinta «llega …».
  const headline = label;
  // Sin escaneo: la guía es nuestra (hay envío de entrada) y el rastreo no falló ⇒ «aún sin movimiento»; si no, «sin rastreo automático».
  const fallback = headline ? null : req.inboundShipment && !c?.pollError ? t('idle') : t('none');

  return (
    <div className="flex flex-col gap-0.5" data-testid="m5-inbound-carrier">
      {headline && (
        <p
          className={c?.kind === 'incident' ? 'text-sm font-medium text-accent' : 'text-sm font-medium text-text'}
          data-testid="m5-inbound-carrier-line"
        >
          {headline}
        </p>
      )}
      {fallback && (
        <p className="text-sm text-muted" data-testid="m5-inbound-carrier-none">
          {fallback}
        </p>
      )}
      {c?.statusAt && (
        <p className="tabular text-xs text-muted">{t('updated', { when: formatUpdatedMx(c.statusAt, locale) })}</p>
      )}
      {c?.pollError && headline && <p className="text-xs text-muted">{t('none')}</p>}
      {auto && (
        <p className="text-xs text-muted" data-testid="m5-auto-transit">
          {t('autoTransit')}
        </p>
      )}
    </div>
  );
}
