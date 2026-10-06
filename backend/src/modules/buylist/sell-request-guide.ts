/**
 * sell-request-guide.ts — 💰 rev BSD-1 (API_CONTRACT §BSD.4.7, I-BSD-2): `writeSellRequestGuide`, **UN cuerpo** para
 * escribir la guía en la solicitud de venta.
 *
 * Se **extrajo** de `BuylistService.adminGuide` (la parte de la transacción) **sin cambiar su conducta**. Dos llamadores:
 *  - `adminGuide` (captura a mano, `source='manual'`);
 *  - `persistLabeled` de la fila de entrada (`source='skydropx'`, en SU transacción, tras el CAS) — B-2.
 * Así el par paquetería/número de la solicitud (lo que ve el vendedor y ancla su plazo, criterio 123) y el de la fila de
 * entrada (lo que lee el motor de Skydropx) los escribe **un** escritor en **una** transacción: la segunda copia
 * aceptada a ojos abiertos de ARCHITECTURE §4.BSD (b).
 * ⭐ Errata BSD-1.1 C-6 (I-BSD-2): el NÚMERO es igual en las dos filas; el `carrier` de la solicitud es el NOMBRE LEGIBLE
 * de la tarifa elegida (`carrierLabel`, o `carrierName` si viene vacío), no el código de la fila de entrada. La firma no
 * cambia: el nombre legible lo pasa el llamador (`persistLabeled`, B-2).
 *
 * Fichero LIGERO a propósito (solo Prisma y `business-days`): lo importa `shipments/` sin arrastrar `buylist.service`.
 * Aquí vive también el predicado del sello de AV-7 (`guideNoticeSealWhere`, errata BSD-1.4 punto 4).
 */
import { Prisma } from '@prisma/client';
import { addBusinessDays } from '../../common/business-days';

export type SellRequestGuideSource = 'manual' | 'skydropx';

/**
 * ⭐ Errata BSD-1.4 punto 4 (`API_CONTRACT §BSD.18`, AV-7): **EL predicado del sello `guideNoticeSentAt`, uno solo.** Lo usan
 * los dos sellos de AV-7 — la captura a mano (`BuylistService.claimAndNotifySellRequest`) y la guía de entrada de Skydropx
 * (`InboundGuideNoticeService.notifyLabeled`) — y vive aquí, junto al reinicio del sello por valor (`writeSellRequestGuide`),
 * porque los dos lados de la misma regla tienen que leerse juntos.
 *
 *  - `guideNoticeSentAt: null` — una vez por par paquetería/número (el reinicio lo hace `writeSellRequestGuide`).
 *  - `status: 'aceptada'` ∧ `closedAt: null` — si «Declinar» o la regla 8 cerraron entre la guía y el post-commit, el vendedor
 *    recibe BSD-M1 y ⛔ no una guía que ya se canceló.
 *  - **`shipmentTrackingNumber: trackingNumber`** — el número que el correo VA A ANUNCIAR sigue siendo el de la solicitud.
 *    Sin él (la copia manual de antes), capturar A, corregir a B y que el post-commit de A corra el último sellaba y
 *    mandaba A, el número equivocado, y el de B ya no casaba (BSD-B40 (b), medido en rojo sobre el código previo).
 *
 * ⛔ Ningún otro `where` sobre `sellRequest` con `guideNoticeSentAt: null` en `backend/src` (candado BSD-B40 (a)).
 */
export function guideNoticeSealWhere(sellRequestId: string, trackingNumber: string): Prisma.SellRequestWhereInput {
  return { id: sellRequestId, guideNoticeSentAt: null, status: 'aceptada', closedAt: null, shipmentTrackingNumber: trackingNumber };
}

export interface SellRequestGuideWrite {
  /** `1` ⇔ la solicitud admitía la guía y quedó escrita (o ya era ésta). `0` ⇒ no admite guía: el llamador decide. */
  readonly count: number;
}

/**
 * Escribe la guía en la solicitud `sellRequestId`, dentro de la transacción del llamador.
 *
 * - **Guarda en el `WHERE`** (patrón `count === 1`, nunca un `if` sobre una lectura): `status='aceptada'` ∧
 *   `closedAt IS NULL`; con `source='skydropx'` además `shipmentTrackingNumber IS NULL` (una guía de Skydropx no pisa una
 *   manual).
 * - `guideSentAt = now`; `shipDeadlineAt = addBusinessDays(now, shipDeadlineBusinessDays)` **solo si era `null`**
 *   (re-capturar corrige el número, no mueve el plazo — criterio 157).
 * - **Reinicio de `guideNoticeSentAt` por VALOR, en el `WHERE`** (§R.4.b, 2026-09-14): solo la escritura que deja el par
 *   `(carrier, número)` DISTINTO limpia el sello de AV-7; re-capturar el mismo número no reenvía el correo. ⚠️ Las ramas
 *   `: null` del `OR` son obligatorias (`NULL <> 'x'` no casa en SQL).
 *
 * `shipDeadlineBusinessDays` = el dial `buylist_ship_deadline_business_days`, leído por el llamador FUERA de la transacción
 * (como hacía `adminGuide`). ⚠️ Es el único parámetro que §BSD.4.7 no lista: el dial no se puede leer sin el servicio de
 * ajustes, y este fichero no lo arrastra a propósito.
 *
 * `count ≠ 1` en `persistLabeled` ⇒ la transacción entera vuelve (`'cas0'`) y decide `casZero` (§BSD.4.7).
 */
export async function writeSellRequestGuide(
  tx: Prisma.TransactionClient,
  sellRequestId: string,
  carrier: string,
  trackingNumber: string,
  now: Date,
  source: SellRequestGuideSource,
  shipDeadlineBusinessDays: number,
): Promise<SellRequestGuideWrite> {
  const c = carrier.trim();
  const t = trackingNumber.trim();
  const before = await tx.sellRequest.findUnique({ where: { id: sellRequestId }, select: { shipDeadlineAt: true } });
  if (!before) return { count: 0 };
  const legal: Prisma.SellRequestWhereInput = {
    id: sellRequestId,
    status: 'aceptada',
    closedAt: null,
    ...(source === 'skydropx' ? { shipmentTrackingNumber: null } : {}),
  };
  const labelWhere: Prisma.SellRequestWhereInput = {
    OR: [
      { shipmentCarrier: null },
      { shipmentCarrier: { not: c } },
      { shipmentTrackingNumber: null },
      { shipmentTrackingNumber: { not: t } },
    ],
  };
  const data = {
    shipmentCarrier: c,
    shipmentTrackingNumber: t,
    guideSentAt: now,
    // Solo se congela si NO había fecha: re-capturar corrige el número, no mueve el plazo.
    ...(before.shipDeadlineAt == null ? { shipDeadlineAt: addBusinessDays(now, shipDeadlineBusinessDays) } : {}),
  };
  // La guarda de negocio es del MOTOR, y el reinicio del ciclo del aviso viaja DENTRO de ella, condicionado al valor viejo.
  let guard = await tx.sellRequest.updateMany({ where: { ...legal, ...labelWhere }, data: { ...data, guideNoticeSentAt: null } });
  if (guard.count !== 1) {
    // No casó: o la etiqueta ya era ésta (re-captura idempotente ⇒ ⛔ NO se toca el sello), o la solicitud no admite guía.
    // Lo segundo lo distingue este segundo intento sin la cláusula de etiqueta.
    guard = await tx.sellRequest.updateMany({ where: legal, data });
  }
  return { count: guard.count };
}
