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
