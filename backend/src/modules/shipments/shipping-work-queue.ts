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
 *  - `lowBalance` = saldo < dial `skydropx_low_balance_cents`, con la lectura CACHEADA 5 min de `ProviderBalanceService` (una
 *    cifra, una fuente; esa lectura llama `observeBalance`, AG-7). `null` ⇔ proveedor `off` (⛔ ni una llamada) o sin respuesta.
 *    El operador recibe el booleano, ⛔ nunca la cifra (T.11): este objeto no la lleva para nadie.
 */
import { Prisma } from '@prisma/client';
import { CARRIER_ALERT_STATUSES, carrierAlertActive } from './label-view';

type Db = Pick<Prisma.TransactionClient, 'shipmentRequest'>;

export interface ShippingWorkQueueDTO {
  lowBalance: boolean | null;
  withCarrierAlert: number;
  labelProcessing: number;
}

export interface ShippingWorkQueueDeps {
  /** `SettingKey.SHIPPING_PROVIDER`. */
  provider: string | null;
  thresholdCents: number;
  /** La lectura cacheada del saldo (`ProviderBalanceService.read`); `null` ⇔ sin respuesta. */
  readBalance: () => Promise<number | null>;
}

export async function countCarrierAlerts(db: Db): Promise<number> {
  const rows = await db.shipmentRequest.findMany({
    where: { carrierStatus: { in: [...CARRIER_ALERT_STATUSES, 'canceled'] } },
    select: { status: true, labelSource: true, carrierStatus: true, providerCanceledAt: true },
  });
  return rows.filter((r) => carrierAlertActive(r)).length;
}

export async function shippingWorkQueueOf(db: Db, deps: ShippingWorkQueueDeps): Promise<ShippingWorkQueueDTO> {
  const [withCarrierAlert, labelProcessing, balanceCents] = await Promise.all([
    countCarrierAlerts(db),
    db.shipmentRequest.count({ where: { labelProcessingSince: { not: null } } }),
    deps.provider === 'skydropx' ? deps.readBalance() : Promise.resolve(null),
  ]);
  return { lowBalance: balanceCents === null ? null : balanceCents < deps.thresholdCents, withCarrierAlert, labelProcessing };
}
