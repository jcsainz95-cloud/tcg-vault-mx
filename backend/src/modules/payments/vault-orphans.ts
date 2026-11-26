import { Prisma } from '@prisma/client';

/**
 * vault-orphans.ts — §BOVEDA-COBRADA-SIN-PIEZAS. LA consulta de la invariante «pedido liquidado ⇒ cada pieza suya está donde el
 * comprador la espera». UNA sola definición para el contador del panel, el filtro «con desajuste» de Pedidos, el renglón de
 * `GET /admin/vaults`, `GET /admin/vault-orphans` y la reparación (⛔ ni dos consultas que puedan divergir).
 *
 * Una línea está SIN ASIGNAR cuando su pedido está `settled` (bóveda o envío directo), la línea no tiene reembolso vivo ni caso de
 * reposición, y:
 *  - ya está marcada «requiere atención» (`fulfillmentFailedAt`, cualquier motivo, también `double_charge`): sigue sin resolver; o
 *  - bóveda: su pieza NO es HOY del comprador (dueño cliente = comprador y fuera de pool/reserva), en CUALQUIER estado;
 *  - envío directo: su pieza está en pool/reserva, es de un cliente, o va en el envío vivo de OTRO pedido.
 * Un caso «Por reponer» excluye SOLO la línea que lo originó (`originOrderItemId`), no toda línea que toque la misma pieza. Se define por dueño/pedido, no por lista de estados: la pieza del propio comprador ya retirada/enviada es legítima. SQL fijo, sin entrada del usuario
 * salvo `orderIds` (parametrizado).
 */
export interface UnassignedLine {
  orderId: string;
  orderNumber: string | null;
  userId: string | null;
  fulfillmentMode: 'vault' | 'direct_ship';
  settledAt: Date | null;
  orderItemId: string;
  inventoryItemId: string;
  folio: string;
  itemStatus: string;
  unitPriceCents: number;
  /** `null` ⇒ aún sin evaluar por la función de liquidación. */
  fulfillmentFailedAt: Date | null;
  fulfillmentFailedReason: string | null;
}

type RawDb = { $queryRaw: <T = unknown>(query: Prisma.Sql) => Promise<T> };

export async function findUnassignedLines(db: RawDb, opts: { orderIds?: string[]; userId?: string; limit?: number } = {}): Promise<UnassignedLine[]> {
  const onlyOrders = opts.orderIds ? Prisma.sql`AND o.id IN (${Prisma.join(opts.orderIds.length ? opts.orderIds : [''])})` : Prisma.empty;
  const onlyUser = opts.userId ? Prisma.sql`AND o."userId" = ${opts.userId}` : Prisma.empty;
  const limit = Prisma.sql`LIMIT ${opts.limit ?? 5000}`;
  return db.$queryRaw<UnassignedLine[]>(Prisma.sql`
    SELECT o.id AS "orderId", o."orderNumber" AS "orderNumber", o."userId" AS "userId",
           o."fulfillmentMode"::text AS "fulfillmentMode", o."settledAt" AS "settledAt",
           oi.id AS "orderItemId", oi."inventoryItemId" AS "inventoryItemId", oi."unitPriceCents" AS "unitPriceCents",
           oi."fulfillmentFailedAt" AS "fulfillmentFailedAt", oi."fulfillmentFailedReason" AS "fulfillmentFailedReason",
           ii.folio AS "folio", ii.status::text AS "itemStatus"
      FROM "Order" o
      JOIN "OrderItem" oi ON oi."orderId" = o.id
      JOIN "InventoryItem" ii ON ii.id = oi."inventoryItemId"
     WHERE o.status = 'settled'
       AND o."fulfillmentMode" IN ('vault', 'direct_ship')
       AND NOT EXISTS (SELECT 1 FROM "PaymentRefund" r WHERE r."orderItemId" = oi.id AND r.status <> 'failed')
       AND NOT EXISTS (SELECT 1 FROM "ReplacementCase" rc WHERE rc."originOrderItemId" = oi.id)
       AND (
            oi."fulfillmentFailedAt" IS NOT NULL
         OR (
              NOT EXISTS (SELECT 1 FROM "VaultPlacementItem" v WHERE v."orderItemId" = oi.id AND v."prepStatus" = 'missing')
              AND CASE
                WHEN o."fulfillmentMode" = 'vault' THEN
                  NOT (ii."ownerType" = 'customer' AND ii."ownerUserId" = o."userId" AND ii.status NOT IN ('listed', 'in_stock', 'reserved'))
                ELSE
                  (ii.status IN ('listed', 'in_stock', 'reserved') OR ii."ownerType" = 'customer'
                   OR EXISTS (SELECT 1 FROM "ShipmentItem" si JOIN "ShipmentRequest" sr ON sr.id = si."shipmentRequestId"
                               WHERE si."inventoryItemId" = ii.id AND sr.status <> 'cancelado' AND sr."orderId" IS DISTINCT FROM o.id))
              END
            )
       )
       ${onlyOrders}
       ${onlyUser}
     ORDER BY o."settledAt" ASC NULLS LAST, o.id ASC, ii.folio ASC, oi.id ASC
     ${limit}`);
}

/** Pedidos distintos con al menos una línea sin asignar (el contador del panel y de la reparación). */
export function distinctOrders(lines: Pick<UnassignedLine, 'orderId'>[]): string[] {
  return [...new Set(lines.map((l) => l.orderId))];
}

export type LineFulfillmentState = 'assigned' | 'replaced' | 'needs_attention' | 'unassigned';

/** Estado por línea para la ficha del pedido. «Repuesta X→Y» gana sobre «asignada» cuando la línea llegó por reposición. */
export function lineFulfillmentState(l: {
  fulfillmentFailedAt: Date | null;
  replacedInventoryItemId: string | null;
  unassigned: boolean;
}): LineFulfillmentState {
  if (l.fulfillmentFailedAt) return 'needs_attention';
  if (l.unassigned) return 'unassigned';
  if (l.replacedInventoryItemId) return 'replaced';
  return 'assigned';
}
