import type { AdminBuylistDTO, InboundCarrierDTO } from '@/types/contract';

/**
 * §BUYLIST-RASTREO — ÚNICO punto de mapeo del estado de la paquetería de la guía de ENTRADA.
 * Los nombres del DTO (`inboundCarrier{status,statusAt,estimatedDeliveryAt,polledAt,deliveredAt,pollError}`)
 * están PENDIENTES de confirmar por backend: si cambian, solo cambia `readInboundCarrier`.
 * ⛔ La pantalla no decide estado ni dinero: solo traduce lo que el servidor manda.
 */
export type InboundCarrierKind = 'pickedUp' | 'onTheWay' | 'delivered' | 'incident' | 'returning';

export interface InboundCarrierView {
  kind: InboundCarrierKind | null;
  statusAt: string | null;
  estimatedDeliveryAt: string | null;
  deliveredAt: string | null;
  pollError: boolean;
}

const KIND_BY_STATUS: Record<string, InboundCarrierKind> = {
  picked_up: 'pickedUp',
  in_transit: 'onTheWay',
  last_mile: 'onTheWay',
  delivery_attempt: 'onTheWay',
  delivered_to_branch: 'delivered',
  delivered: 'delivered',
  exception: 'incident',
  retained: 'incident',
  destroyed: 'incident',
  in_return: 'returning',
};

/** `null` ⇒ el servidor no mandó nada (o la guía aún no se mueve): no se pinta nada nuevo. */
export function readInboundCarrier(src: { inboundCarrier?: InboundCarrierDTO | null }): InboundCarrierView | null {
  const c = src.inboundCarrier;
  if (!c) return null;
  const kind = (c.status && KIND_BY_STATUS[c.status]) || null;
  if (!kind && !c.pollError) return null;
  return {
    kind,
    statusAt: c.statusAt ?? null,
    estimatedDeliveryAt: c.estimatedDeliveryAt ?? null,
    deliveredAt: c.deliveredAt ?? null,
    pollError: c.pollError === true,
  };
}

/** `true` ⇔ el sistema (no una persona) movió la solicitud a «En tránsito». */
export function movedBySystem(r: Pick<AdminBuylistDTO, 'status' | 'shipmentConfirmedBy'>): boolean {
  return r.status === 'en_transito' && r.shipmentConfirmedBy === 'system:carrier';
}

/** «lun 30 nov» (zona de México, sin coma). */
export function formatShortDayMx(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'es-MX', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'America/Mexico_City',
  })
    .format(d)
    .replace(',', '')
    .replace(' de ', ' ')
    .replace('.', '');
}
