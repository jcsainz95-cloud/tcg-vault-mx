import { Prisma } from '@prisma/client';

/**
 * reservation.ts — LA RESERVA TIENE DUEÑO (v1.68, API_CONTRACT §4-R, ARCHITECTURE §4.48.2, M-53).
 *
 * Una pieza `reserved` sabe QUÉ orden la reservó (`reservedByOrderId`) y HASTA CUÁNDO
 * (`reservedUntil`). De aquí salen las tres piezas que TODA ruta de reserva/liberación comparte, para
 * que no haya dos cuerpos que puedan divergir:
 *
 *  - {@link ORDER_RESERVATION_TTL_MIN} — el único TTL (bóveda e invitado).
 *  - {@link reservationGuard} — el `where` de TODA salida de `reserved` (regla 2 de §4-R.2): solo el
 *    dueño libera/liquida. Sin esto, el webhook `payment_intent.canceled` del PI viejo liberaría la
 *    pieza que la orden nueva acaba de reservar tras una sustitución.
 *  - {@link lockReservationGate} — la PUERTA POR CLIENTE (`pg_advisory_xact_lock`), misma ceremonia
 *    que `lockFxGate` (§5.5): candado → releer POR EL MISMO `tx` → decidir → escribir. Sin ella, dos
 *    llamadas simultáneas del mismo cliente pasan el pre-scan sin ver la orden de la otra.
 */

/**
 * Minutos que una orden `pending` retiene la reserva antes del barrido (`order-reservation-sweep`).
 * Es `GUEST_ORDER_RESERVATION_TTL_MIN` RENOMBRADA (§4-R.1): aplica a las DOS rutas. Decisión del
 * arquitecto vetable por el dueño (§4.48.10): si quiere otro plazo, se cambia AQUÍ y solo aquí.
 */
export const ORDER_RESERVATION_TTL_MIN = 60;

/** Vencimiento de una reserva creada o RENOVADA en `now` (§4-R.2 regla 4: el reuso renueva). */
export function reservedUntilFrom(now: Date): Date {
  return new Date(now.getTime() + ORDER_RESERVATION_TTL_MIN * 60 * 1000);
}

/**
 * ⭐⭐ El `where` de TODA transición que SALE de `reserved` (compensación, webhook, contracargo,
 * barrido y liquidación): la pieza tiene que estar `reserved` Y ser de la orden que dispara la
 * transición. **Transitorio M-53:** admite además `reservedByOrderId IS NULL` (reserva LEGADA,
 * anterior a la migración). Esa rama se retira cuando
 * `SELECT count(*) FROM "InventoryItem" WHERE status='reserved' AND "reservedByOrderId" IS NULL`
 * sea `0` en producción (deuda con comprobación, ARCHITECTURE §4.48.7(5)).
 */
export function reservationGuard(orderId: string): Prisma.InventoryItemWhereInput {
  return {
    status: 'reserved',
    OR: [{ reservedByOrderId: orderId }, { reservedByOrderId: null }],
  };
}

/** `data` que LIMPIA el dueño y el vencimiento en toda salida de `reserved` (regla 2 de §4-R.2). */
export const clearReservation = {
  reservedByOrderId: null,
  reservedUntil: null,
} as const satisfies Prisma.InventoryItemUncheckedUpdateManyInput;

/**
 * `data` completo de una LIBERACIÓN (reserved → listed, pieza de vuelta a la plataforma). Es el
 * cuerpo único que usan compensación, webhook `failed|canceled`, barrido y sustitución. Escribe la
 * titularidad de plataforma SIEMPRE: en el envío directo es un no-op (la pieza nunca dejó de ser de
 * la plataforma) y evita tener dos cuerpos que puedan divergir (T2).
 */
export const releaseReservationData = {
  status: 'listed',
  ownerType: 'platform',
  ownerUserId: null,
  ownershipStatus: null,
  ...clearReservation,
} as const satisfies Prisma.InventoryItemUncheckedUpdateManyInput;

/**
 * Espacio de claves del advisory lock de la puerta de reserva. Dos enteros (`pg_advisory_xact_lock(int, int)`):
 * este namespace + `hashtext(<identidad del cliente>)`. Distinto de `FX_GATE_LOCK_KEY` (una sola
 * clave bigint): no colisionan.
 */
export const RESERVATION_GATE_NAMESPACE = 63_120_959;

/** Lo mínimo que necesita {@link lockReservationGate}: el handle de una transacción de Prisma. */
export interface ReservationGateLocker {
  $executeRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
}

/**
 * Identidad del CLIENTE que reintenta (§4-R.1): `userId` (con cuenta) o, para el invitado, el correo
 * normalizado (la titularidad la prueba después el `retryOfCheckoutToken`; el correo solo SERIALIZA).
 */
export type ReservationGateIdentity = { userId: string } | { guestEmail: string };

export function reservationGateKey(identity: ReservationGateIdentity): string {
  return 'userId' in identity ? `user:${identity.userId}` : `guest:${identity.guestEmail}`;
}

/**
 * ⭐⭐ Toma la PUERTA POR CLIENTE **dentro de la transacción `tx`**. Se libera sola al commit o al
 * rollback (`pg_advisory_xact_lock`). ⛔ Toda ruta que decida sobre reservas propias empieza por aquí,
 * ANTES de leer el estado que va a validar; y lee por el MISMO `tx` (§5.5: sin subir el nivel de
 * aislamiento — bajo READ COMMITTED la relectura ve el commit del que tenía el candado).
 */
export async function lockReservationGate(
  tx: ReservationGateLocker,
  identity: ReservationGateIdentity,
): Promise<void> {
  const key = reservationGateKey(identity);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${RESERVATION_GATE_NAMESPACE}, hashtext(${key}))`;
}
