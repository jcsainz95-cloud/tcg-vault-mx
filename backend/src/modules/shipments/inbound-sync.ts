/**
 * inbound-sync.ts — 💰 rev BSD-1, paso B-2: la COSTURA de la fila de entrada con la anonimización de cuenta (BSD-B27,
 * ARCHITECTURE §4.BSD (i)), dentro de la transacción del llamador (⛔ nunca red).
 *
 * La fila de entrada guarda el domicilio del VENDEDOR con `userId = null` (CHECK `shipment_kind_link`): la anonimización de
 * hoy (`admin.service.ts` `deleteUser`), que encuentra los envíos por `userId` / `order.userId`, **no la ve**. Se norma que
 * la encuentre por `SellRequest.userId`. Vive aquí porque escribe `ShipmentRequest` (el motor de la guía); el llamador es
 * `deleteUser` (borrado suave), que la cablea en su tx.
 *
 * ⚠️ Las otras dos costuras de §BSD.4.5 (la guarda de `adminGuide`/`pickup-address` y el re-sincronizado del domicilio) las
 * construyó B-3 en `buylist/` (`inbound-address-sync.ts`, `buylist.service.ts`): ⛔ no se duplican aquí.
 */
import { Prisma } from '@prisma/client';
import { INBOUND_ONLY } from './label-subject';

type Tx = Prisma.TransactionClient;

/**
 * BSD-B27 — el domicilio de las filas de entrada del vendedor `userId` queda VACÍO (`{}`: la columna no admite nulo) y sus
 * `ShipmentAddressRevision` se borran (se borran, no se redactan: quién y cuándo siguen en la bitácora, que no lleva
 * valores). ⛔ Montos, guía y libros (registro económico) se conservan. Devuelve cuántas filas vació.
 */
export async function scrubInboundShipmentPii(tx: Tx, userId: string): Promise<number> {
  await tx.shipmentAddressRevision.deleteMany({ where: { shipmentRequest: { ...INBOUND_ONLY, sellRequest: { userId } } } });
  const r = await tx.shipmentRequest.updateMany({ where: { ...INBOUND_ONLY, sellRequest: { userId } }, data: { addressSnapshot: {} } });
  return r.count;
}
