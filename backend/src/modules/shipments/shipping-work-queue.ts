/**
 * shipping-work-queue.ts — 💰 D2f: `workQueue.shipping` del tablero (API_CONTRACT §19.13; §19.32.5 y §19.33.6 para
 * `withCarrierAlert`). Lectura pura; ⛔ escribe nada.
 *
 *  - `withCarrierAlert` = envíos con `carrierAlertActive` (el cuerpo de `label-view.ts`, el MISMO que pinta `carrierAlert` en el
 *    DTO y filtra `?alert=true`). La consulta SQL es solo un superconjunto ancho (`carrierStatus` en la lista de la alerta o
 *    `canceled`, con la lista importada de `label-view.ts`); quién cuenta lo decide la función. ⛔ Ninguna segunda lista de
 *    estados ni de «envío vivo» (PS-171, censo). Con §19.33.2 el estado desconocido llega como `exception` y entra solo.
 *  - `labelProcessing` = envíos con la guía EN PROCESO: `labelProcessingSince ≠ null` (la misma condición que `labelPending`,
 *    `toLabelPendingDTO`: compra en vuelo o en proceso con id).
 *  - ⭐ v1.80.12.16 (§19.35.5 fila 1, B-3) `withLabelAlert` = envíos con **`labelAlertOf(fila, now) ≠ null`** — el MISMO cuerpo
 *    que llena `labelAlert` en `AdminShipmentDTO` (§19.20.2), con el MISMO reloj (`SHIPMENTS_LABEL_CLOCK`) y el MISMO
 *    `tUnknownMs` (`LABEL_VERIFY_CONFIG`) que el DTO y `?alert=true`. La consulta SQL es solo un superconjunto ancho (los
 *    predicados de las cinco alertas sin umbral de tiempo) y las huérfanas de 7 días de la bitácora, como el DTO; quién cuenta lo
 *    decide la función. ⛔ Ningún umbral propio (PS-173). Un envío con las dos alertas cuenta en las dos cifras.
 *  - `lowBalance` = saldo < dial `skydropx_low_balance_cents`, con la lectura CACHEADA 5 min de `ProviderBalanceService` (una
 *    cifra, una fuente; esa lectura llama `observeBalance`, AG-7). `null` ⇔ proveedor `off` (⛔ ni una llamada) o sin respuesta.
 *    El operador recibe el booleano, ⛔ nunca la cifra (T.11): este objeto no la lleva para nadie.
 */
import { Prisma } from '@prisma/client';
import { CARRIER_ALERT_STATUSES, carrierAlertActive, labelAlertOf } from './label-view';
import { ORPHAN_ALERT_TTL_MS } from './label-verify.constants';
import { OUTBOUND_ONLY } from './label-subject';

type Db = Pick<Prisma.TransactionClient, 'shipmentRequest'>;
type AlertDb = Pick<Prisma.TransactionClient, 'shipmentRequest' | 'auditLog'>;

// La ventana de `label_orphan` (§19.28.6, 7 días) es `ORPHAN_ALERT_TTL_MS` (`label-verify.constants.ts`): UNA constante para
// el DTO (`ShipmentsService.labelFieldsOf`), `?alert=true` y el tablero (C-TL-1 del gate techlead sobre 31af0883).

export interface ShippingWorkQueueDTO {
  lowBalance: boolean | null;
  withCarrierAlert: number;
  /** ⭐ v1.80.12.16 (§19.35.5 fila 1): envíos con `labelAlert ≠ null`. */
  withLabelAlert: number;
  labelProcessing: number;
}

export interface ShippingWorkQueueDeps {
  /** `SettingKey.SHIPPING_PROVIDER`. */
  provider: string | null;
  thresholdCents: number;
  /** La lectura cacheada del saldo (`ProviderBalanceService.read`); `null` ⇔ sin respuesta. */
  readBalance: () => Promise<number | null>;
  /** El reloj de la guía (`SHIPMENTS_LABEL_CLOCK`): el MISMO que pinta `labelAlert` en el DTO. */
  now: Date;
  /** `LABEL_VERIFY_CONFIG.tUnknownMs`: la MISMA constante inyectada que usa el DTO. */
  tUnknownMs: number;
}

/** Los envíos con `carrierAlert ≠ null` (§19.3): superconjunto ancho en SQL y, fila a fila, `carrierAlertActive`. */
export async function carrierAlertShipmentIds(db: Db): Promise<string[]> {
  const rows = await db.shipmentRequest.findMany({
    where: { ...OUTBOUND_ONLY, carrierStatus: { in: [...CARRIER_ALERT_STATUSES, 'canceled'] } },
    select: { id: true, status: true, labelSource: true, carrierStatus: true, providerCanceledAt: true },
  });
  return rows.filter((r) => carrierAlertActive(r)).map((r) => r.id);
}

export async function countCarrierAlerts(db: Db): Promise<number> {
  return (await carrierAlertShipmentIds(db)).length;
}

/**
 * Los envíos con `labelAlert ≠ null` (§19.20.2): superconjunto ancho en SQL y, fila a fila, `labelAlertOf` — el cuerpo del DTO.
 * `actorRole` no cambia si hay alerta (solo `canRelease`), así que se pasa `null`.
 */
export async function labelAlertShipmentIds(db: AlertDb, now: Date, tUnknownMs: number): Promise<string[]> {
  const orphans = await db.auditLog.findMany({
    where: { action: 'shipment.label_orphan', entityType: 'ShipmentRequest', createdAt: { gt: new Date(now.getTime() - ORPHAN_ALERT_TTL_MS) } },
    orderBy: { createdAt: 'desc' },
    select: { entityId: true, createdAt: true },
  });
  const orphanSince = new Map<string, Date>();
  for (const o of orphans) if (o.entityId && !orphanSince.has(o.entityId)) orphanSince.set(o.entityId, o.createdAt);
  const candidates = await db.shipmentRequest.findMany({
    where: {
      // rev BSD-1 (censo BSD-B23): alimenta `?alert=true` de la lista admin y el tablero de M4, que son de envíos.
      ...OUTBOUND_ONLY,
      OR: [
        { status: 'cancelado', labelSource: 'skydropx', providerCanceledAt: null },
        { providerShipmentId: { not: null }, providerCanceledAt: { not: null }, providerCancelConfirmedAt: null },
        { labelProcessingSince: { not: null } },
        ...(orphanSince.size > 0 ? [{ id: { in: [...orphanSince.keys()] } }] : []),
      ],
    },
  });
  return candidates
    .filter((row) => labelAlertOf(row, now, null, { tUnknownMs, orphanSince: orphanSince.get(row.id) ?? null }) !== null)
    .map((row) => row.id);
}

/**
 * `?alert=true` (§19.20.2 «Filtro y tablero»): `carrierAlert ≠ null ∨ labelAlert ≠ null` = la UNIÓN de los dos cuerpos de
 * arriba (C-TL-1). ⛔ Ninguna consulta ancha propia: el SQL de cada alerta vive en un solo sitio, el mismo que cuenta el
 * tablero. `actorRole` no cambia SI hay alerta (solo `canRelease`), así que no entra aquí.
 */
export async function alertShipmentIdsOf(db: AlertDb, now: Date, tUnknownMs: number): Promise<string[]> {
  const [carrier, label] = await Promise.all([carrierAlertShipmentIds(db), labelAlertShipmentIds(db, now, tUnknownMs)]);
  return [...new Set([...carrier, ...label])];
}

export async function countLabelAlerts(db: AlertDb, now: Date, tUnknownMs: number): Promise<number> {
  return (await labelAlertShipmentIds(db, now, tUnknownMs)).length;
}

export async function shippingWorkQueueOf(db: AlertDb, deps: ShippingWorkQueueDeps): Promise<ShippingWorkQueueDTO> {
  const [withCarrierAlert, withLabelAlert, labelProcessing, balanceCents] = await Promise.all([
    countCarrierAlerts(db),
    countLabelAlerts(db, deps.now, deps.tUnknownMs),
    db.shipmentRequest.count({ where: { ...OUTBOUND_ONLY, labelProcessingSince: { not: null } } }),
    deps.provider === 'skydropx' ? deps.readBalance() : Promise.resolve(null),
  ]);
  return { lowBalance: balanceCents === null ? null : balanceCents < deps.thresholdCents, withCarrierAlert, withLabelAlert, labelProcessing };
}
