import { Prisma } from '@prisma/client';

/**
 * vault-orphans.ts — §BOVEDA-COBRADA-SIN-PIEZAS. LA consulta de la invariante «pedido liquidado ⇒ cada pieza suya está donde el
 * comprador la espera». UNA sola definición para el contador del panel, el filtro «con desajuste» de Pedidos, el renglón de
 * `GET /admin/vaults`, `GET /admin/vault-orphans` y la reparación (⛔ ni dos consultas que puedan divergir).
 *
 * Una línea está SIN ASIGNAR cuando su pedido está `settled` (bóveda o envío directo), la línea no tiene reembolso vivo y su pieza:
 *  - está en el pool (`listed`/`in_stock`) o `reserved` (por otro pedido o por nadie), o
 *  - (solo bóveda) está `in_custody` pero NO es de un cliente / no es de ESTE comprador.
 * Incluye las líneas ya marcadas «requiere atención»: siguen sin pieza hasta que alguien decida. SQL fijo, sin entrada del usuario
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

export async function findUnassignedLines(db: RawDb, opts: { orderIds?: string[]; limit?: number } = {}): Promise<UnassignedLine[]> {
  const onlyOrders = opts.orderIds ? Prisma.sql`AND o.id IN (${Prisma.join(opts.orderIds.length ? opts.orderIds : [''])})` : Prisma.empty;
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
       AND (
            ii.status IN ('listed', 'in_stock', 'reserved')
         OR (o."fulfillmentMode" = 'vault' AND ii.status = 'in_custody'
             AND (ii."ownerType" <> 'customer' OR ii."ownerUserId" IS DISTINCT FROM o."userId"))
       )
       ${onlyOrders}
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
