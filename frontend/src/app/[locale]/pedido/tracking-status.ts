import type { GuestOrderPublicStatus } from '@/types/contract';

/**
 * Estado público del pedido de invitado (contrato §4-G.5): la API devuelve el ENUM y el
 * texto legible vive aquí + i18n (`status.tracking.*`). El progreso normativo de PROJECT §J
 * es `pagado → preparando → guía → enviado → entregado`.
 */
export const TRACKING_STEPS = ['pagado', 'preparando', 'guia', 'enviado', 'entregado'] as const;
export type TrackingStep = (typeof TRACKING_STEPS)[number];

/** Clave i18n (namespace raíz) de la versalita de cada estado — §15.6. */
export const TRACKING_STATUS_KEY: Record<GuestOrderPublicStatus, string> = {
  pendiente_pago: 'status.tracking.pendingPayment',
  pagado: 'status.tracking.paid',
  preparando: 'status.tracking.preparing',
  guia: 'status.tracking.label',
  enviado: 'status.tracking.shipped',
  entregado: 'status.tracking.delivered',
  cancelado: 'status.tracking.cancelled',
  reembolsado: 'status.tracking.refunded',
  // `chargeback` NO se nombra hacia el invitado: la API ya lo entrega como `en_revision`
  // (§4-G.5) y aquí se pinta con el mismo tono neutro que una revisión operativa.
  en_revision: 'status.tracking.inReview',
};

/** Color del estado (redundante: el portador de la información es el texto en versalitas). */
export const TRACKING_STATUS_TONE: Record<GuestOrderPublicStatus, string> = {
  pendiente_pago: 'text-muted',
  pagado: 'text-success',
  preparando: 'text-accent',
  guia: 'text-muted',
  enviado: 'text-text',
  entregado: 'text-success',
  cancelado: 'text-muted',
  reembolsado: 'text-muted',
  en_revision: 'text-muted',
};

/**
 * Paso actual del stepper, o `null` si el estado está fuera de la línea de progreso
 * (pago pendiente, cancelado, reembolsado, en revisión): en esos casos §15.6 pide pintar
 * la versalita del estado + la línea de soporte, no un stepper a medias.
 */
export function stepForStatus(status: GuestOrderPublicStatus): TrackingStep | null {
  return (TRACKING_STEPS as readonly string[]).includes(status) ? (status as TrackingStep) : null;
}

/**
 * Un `OrderAccessToken` no dice de qué emisión viene (§4-G.7a: no hay columna de tipo; ambas
 * vidas son filas idénticas y solo las distingue `expiresAt`). Para la UI basta con mirar
 * cuánto le queda: si caduca dentro de este margen, es el **token de checkout** de 120 min
 * (el puente post-3DS), no el enlace de 90 días que llega por correo. Se usa solo para avisar
 * "este enlace es temporal", nunca para cambiar el acceso ni para ramificar errores.
 */
const CHECKOUT_TOKEN_TTL_MIN = 120; // GUEST_CHECKOUT_TOKEN_TTL_MIN del contrato
const MARGIN_MIN = 10; // holgura por reloj del cliente / latencia

export function isShortLivedCheckoutToken(tokenExpiresAt: string, now: Date = new Date()): boolean {
  const expires = new Date(tokenExpiresAt).getTime();
  if (Number.isNaN(expires)) return false;
  const minutesLeft = (expires - now.getTime()) / 60_000;
  return minutesLeft <= CHECKOUT_TOKEN_TTL_MIN + MARGIN_MIN;
}
