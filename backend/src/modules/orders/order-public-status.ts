/**
 * ⭐ v1.80.2 (§M4-SHIP.16) — UN cuerpo, DOS superficies: el estado PÚBLICO de un pedido (`§4-G.5` entero, incluida
 * la regla v1.80 «reembolsado» de §M4-SHIP.10) y el envío VIGENTE. Lo usan `POST /orders/guest/track` **y**
 * `GET /orders/:orderId` (y la lista). ⛔ Ninguna segunda tabla de mapeo: PO-3 mide la paridad de las dos superficies.
 *
 * `chargeback` NO se nombra hacia el invitado (`en_revision`): decir «contracargo» en una vista sin autenticar da
 * información operativa. `refunded` sí se nombra (el comprador ya lo sabe por su banco).
 */
import { OrderStatus, ShipmentStatus } from '@prisma/client';
import { GuestOrderPublicStatus } from './guest-checkout.constants';

/** Las filas del libro que cuentan como «devuelto por Stripe» (§M4-SHIP.10): `submitted|succeeded`. */
export function refundedCentsOf(rows: { status: string; amountCents: number }[]): number {
  return rows.filter((r) => r.status === 'submitted' || r.status === 'succeeded').reduce((a, r) => a + r.amountCents, 0);
}

export function publicStatus(
  orderStatus: OrderStatus,
  shipmentStatus?: ShipmentStatus | null,
  money?: { refundedCents: number; totalCents: number },
): GuestOrderPublicStatus {
  // ⭐ v1.80 (§M4-SHIP.10) — la regla ANTES de la tabla: todo devuelto ⇒ `reembolsado`, sin mirar el envío. Cubre el
  // hueco de «todas las cartas faltaron»: el envío queda `cancelado` y, hasta el `charge.refunded`, la fila
  // `settled + cancelado` decía `en_revision` a quien acaba de recibir el correo de reembolso. Un reembolso PARCIAL
  // no cambia el estado público: se ve por carta (`items[].refund`).
  if (money && money.totalCents > 0 && money.refundedCents >= money.totalCents) return 'reembolsado';
  switch (orderStatus) {
    case 'pending':
      return 'pendiente_pago';
    case 'failed':
      return 'cancelado';
    case 'refunded':
      return 'reembolsado';
    case 'chargeback':
      return 'en_revision';
    case 'settled':
      break;
  }
  switch (shipmentStatus) {
    case 'solicitado':
    case 'picking':
      return 'preparando';
    case 'guia':
      return 'guia';
    case 'enviado':
      return 'enviado';
    case 'entregado':
      return 'entregado';
    case 'cancelado':
      return 'en_revision';
    default:
      // Ventana entre el webhook y la creación del envío.
      return 'pagado';
  }
}

/**
 * Envío VIGENTE del pedido (ordenados por `requestedAt` desc): el más reciente no cancelado; si todos están
 * cancelados, el más reciente. Cubre la re-expedición. Invariante de aplicación: a lo más un envío ACTIVO por orden.
 */
export function activeShipment<T extends { status: ShipmentStatus }>(shipments: T[]): T | undefined {
  return shipments.find((s) => s.status !== 'cancelado') ?? shipments[0];
}

/** `items[].refund` del CLIENTE/INVITADO (§M4-SHIP.10): solo filas `submitted|succeeded`; ⛔ sin actor, `failureCode` ni componentes. */
export function clientRefundOf(
  r: { status: string; amountCents: number; missingReason: string | null; submittedAt: Date | null; succeededAt: Date | null } | null | undefined,
): { amountCents: number; reason: string | null; refundedAt: string | null } | null {
  if (!r || (r.status !== 'submitted' && r.status !== 'succeeded')) return null;
  return { amountCents: r.amountCents, reason: r.missingReason, refundedAt: (r.succeededAt ?? r.submittedAt)?.toISOString() ?? null };
}
