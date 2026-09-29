/**
 * §M4-SHIP.3 / §M4-SHIP.17.7 — EL ORIGEN DEL DINERO DE UNA CARTA, un cuerpo (`resolveOrigin`), y la CADENA
 * DE REPOSICIÓN (`currentPieceOf`). Lo usan el preparado del envío (§M4-SHIP.5), el apartado «Por reponer»
 * (§M4-SHIP.15), `classifyItems` de `POST /shipments` (§5, SEC-SHIP-A5 (b)), el contracargo de bóveda y el
 * reembolso total de bóveda (§M4-SHIP.18.4). ⛔ Ninguna segunda implementación.
 *
 * **`resolveOrigin(pieza, clienteId)` (retiro y cadena; SEC-SHIP-M3):** el origen es el **evento de
 * adquisición MÁS RECIENTE** de esa pieza por ese cliente, entre casos `replaced` (instante `resolvedAt`,
 * origen `originOrderItemId`) y compras `vault` liquidadas (instante `settledAt`, cualquiera que sea su estado
 * HOY: el evento ocurrió). Empate ⇒ la compra (hecho primario). Sin candidatos ⇒ `null` (`no_origin_order`).
 * *Por qué no «si hay caso ⇒ el caso»:* una repuesta que un contracargo devolvió a la plataforma y el mismo
 * cliente RE-COMPRÓ tenía como origen el caso viejo (la orden disputada) — PS-52.
 *
 * **Directo:** la `OrderItem` de `ShipmentRequest.orderId` con `inventoryItemId` = la de la línea.
 *
 * **`currentPieceOf(orderItem)`:** `p = orderItem.inventoryItemId`; repetir: casos `{ status:'replaced',
 * originalInventoryItemId: p, originOrderItemId: orderItem.id }` — solo `replaced`, solo de ESA compra —;
 * 0 ⇒ fin; 1 ⇒ `p = replacementInventoryItemId`; >1 ⇒ `needsManual`. Visitados (ciclo) + profundidad máxima
 * `REPLACEMENT_CHAIN_MAX_DEPTH = 16` ⇒ `ambiguous` + `log error`, ⛔ ninguna escritura sobre esas piezas.
 *
 * Todo se resuelve POR LOTE (una consulta de casos, una de líneas de orden), ⛔ sin N+1.
 */
import { OrderStatus, Prisma } from '@prisma/client';

export const REPLACEMENT_CHAIN_MAX_DEPTH = 16;

/** Lo que el resto necesita saber del origen de una carta. */
export interface OriginRef {
  orderItemId: string;
  orderId: string;
  orderStatus: OrderStatus;
  orderNumber: string | null;
  unitPriceCents: number;
  /** El instante del evento de adquisición (para explicar la elección; no lo consume nadie más). */
  acquiredAt: Date;
  via: 'purchase' | 'replaced_case';
}

export type OriginDb = Pick<Prisma.TransactionClient, 'replacementCase' | 'orderItem'>;

/**
 * Origen de VARIAS piezas de UN cliente (retiro / cadena / bóveda). Devuelve un mapa pieza ⇒ origen (o
 * `null` = `no_origin_order`). Dos consultas en total.
 */
export async function resolveOriginsBatch(
  db: OriginDb,
  customerUserId: string,
  inventoryItemIds: string[],
): Promise<Map<string, OriginRef | null>> {
  const out = new Map<string, OriginRef | null>();
  const ids = [...new Set(inventoryItemIds)];
  if (ids.length === 0) return out;
  const [cases, lines] = await Promise.all([
    db.replacementCase.findMany({
      where: {
        status: 'replaced',
        customerUserId,
        replacementInventoryItemId: { in: ids },
        originOrderItemId: { not: null },
      },
      select: {
        replacementInventoryItemId: true,
        resolvedAt: true,
        originOrderItem: {
          select: {
            id: true,
            unitPriceCents: true,
            order: { select: { id: true, status: true, orderNumber: true } },
          },
        },
      },
    }),
    db.orderItem.findMany({
      where: {
        inventoryItemId: { in: ids },
        order: { fulfillmentMode: 'vault', userId: customerUserId, settledAt: { not: null } },
      },
      select: {
        id: true,
        inventoryItemId: true,
        unitPriceCents: true,
        order: { select: { id: true, status: true, orderNumber: true, settledAt: true } },
      },
    }),
  ]);
  const best = new Map<string, OriginRef>();
  const consider = (pieceId: string, cand: OriginRef) => {
    const cur = best.get(pieceId);
    if (!cur) {
      best.set(pieceId, cand);
      return;
    }
    const t = cand.acquiredAt.getTime();
    const c = cur.acquiredAt.getTime();
    // Gana el instante más reciente; empate ⇒ la compra (hecho primario).
    if (t > c || (t === c && cand.via === 'purchase' && cur.via !== 'purchase')) best.set(pieceId, cand);
  };
  for (const l of lines) {
    consider(l.inventoryItemId, {
      orderItemId: l.id,
      orderId: l.order.id,
      orderStatus: l.order.status,
      orderNumber: l.order.orderNumber,
      unitPriceCents: l.unitPriceCents,
      acquiredAt: l.order.settledAt as Date,
      via: 'purchase',
    });
  }
  for (const c of cases) {
    if (!c.originOrderItem || !c.replacementInventoryItemId || !c.resolvedAt) continue;
    consider(c.replacementInventoryItemId, {
      orderItemId: c.originOrderItem.id,
      orderId: c.originOrderItem.order.id,
      orderStatus: c.originOrderItem.order.status,
      orderNumber: c.originOrderItem.order.orderNumber,
      unitPriceCents: c.originOrderItem.unitPriceCents,
      acquiredAt: c.resolvedAt,
      via: 'replaced_case',
    });
  }
  for (const id of ids) out.set(id, best.get(id) ?? null);
  return out;
}

/** `resolveOrigin` de UNA pieza (azúcar sobre el lote). */
export async function resolveOrigin(
  db: OriginDb,
  customerUserId: string,
  inventoryItemId: string,
): Promise<OriginRef | null> {
  return (await resolveOriginsBatch(db, customerUserId, [inventoryItemId])).get(inventoryItemId) ?? null;
}

/** Origen de las líneas de un DIRECTO: la `OrderItem` de la orden del envío con esa pieza. */
export async function resolveDirectOriginsBatch(
  db: OriginDb,
  orderId: string,
  inventoryItemIds: string[],
): Promise<Map<string, OriginRef | null>> {
  const out = new Map<string, OriginRef | null>();
  const ids = [...new Set(inventoryItemIds)];
  if (ids.length === 0) return out;
  const lines = await db.orderItem.findMany({
    where: { orderId, inventoryItemId: { in: ids } },
    select: {
      id: true,
      inventoryItemId: true,
      unitPriceCents: true,
      order: { select: { id: true, status: true, orderNumber: true, settledAt: true, createdAt: true } },
    },
  });
  for (const id of ids) out.set(id, null);
  for (const l of lines) {
    out.set(l.inventoryItemId, {
      orderItemId: l.id,
      orderId: l.order.id,
      orderStatus: l.order.status,
      orderNumber: l.order.orderNumber,
      unitPriceCents: l.unitPriceCents,
      acquiredAt: l.order.settledAt ?? l.order.createdAt,
      via: 'purchase',
    });
  }
  return out;
}

export type CurrentPiece =
  | { kind: 'piece'; inventoryItemId: string; depth: number }
  | { kind: 'ambiguous'; reason: 'cycle' | 'depth' | 'fork'; at: string };

/**
 * `currentPieceOf(orderItem)` para VARIAS líneas de una orden con UNA consulta de casos (todos los
 * `replaced` con `originOrderItemId ∈ líneas`), y la cadena resuelta en memoria.
 */
export async function currentPiecesOf(
  db: Pick<Prisma.TransactionClient, 'replacementCase'>,
  orderItems: { id: string; inventoryItemId: string }[],
): Promise<Map<string, CurrentPiece>> {
  const out = new Map<string, CurrentPiece>();
  if (orderItems.length === 0) return out;
  const cases = await db.replacementCase.findMany({
    where: { status: 'replaced', originOrderItemId: { in: orderItems.map((o) => o.id) } },
    select: { originOrderItemId: true, originalInventoryItemId: true, replacementInventoryItemId: true },
  });
  for (const oi of orderItems) {
    const mine = cases.filter((c) => c.originOrderItemId === oi.id);
    let p = oi.inventoryItemId;
    const visited = new Set<string>([p]);
    let depth = 0;
    let result: CurrentPiece | null = null;
    for (;;) {
      const next = mine.filter((c) => c.originalInventoryItemId === p);
      if (next.length === 0) {
        result = { kind: 'piece', inventoryItemId: p, depth };
        break;
      }
      if (next.length > 1) {
        result = { kind: 'ambiguous', reason: 'fork', at: p };
        break;
      }
      const q = next[0].replacementInventoryItemId as string;
      depth += 1;
      if (visited.has(q)) {
        result = { kind: 'ambiguous', reason: 'cycle', at: q };
        break;
      }
      if (depth > REPLACEMENT_CHAIN_MAX_DEPTH) {
        result = { kind: 'ambiguous', reason: 'depth', at: q };
        break;
      }
      visited.add(q);
      p = q;
    }
    out.set(oi.id, result);
  }
  return out;
}

/**
 * 🔒💰 v1.80.5 (SEC-SHIP-A5 (b)) — piezas de UN cliente cuya compra de origen (`resolveOrigin`) NO está `settled`
 * o tiene una fila `PaymentRefund{ kind:'order_full', status ≠ failed }` (reembolso total pedido, aún sin
 * confirmar). EL MISMO predicado para `classifyItems` (`POST /shipments`, `quote`), `HoldingDTO.withdrawable`
 * (§3) y la guarda del retiro (`WITHDRAWAL_LINE_ORIGIN_REFUNDED`, §M4-SHIP.6): lectura y escritura no divergen.
 * Sin origen (`no_origin_order`) ⇒ no bloquea (H8). Por lote, ⛔ sin N+1.
 */
export async function originsBeingRefunded(
  db: OriginDb & Pick<Prisma.TransactionClient, 'paymentRefund'>,
  customerUserId: string,
  inventoryItemIds: string[],
): Promise<Set<string>> {
  const out = new Set<string>();
  if (inventoryItemIds.length === 0) return out;
  const origins = await resolveOriginsBatch(db, customerUserId, inventoryItemIds);
  const orderIds = [...new Set([...origins.values()].filter((o): o is OriginRef => !!o).map((o) => o.orderId))];
  const pending = orderIds.length
    ? await db.paymentRefund.findMany({
        where: { orderId: { in: orderIds }, kind: 'order_full', status: { not: 'failed' } },
        select: { orderId: true },
      })
    : [];
  const pendingIds = new Set(pending.map((r) => r.orderId as string));
  for (const [id, o] of origins) {
    if (!o) continue;
    if (o.orderStatus !== 'settled' || pendingIds.has(o.orderId)) out.add(id);
  }
  return out;
}
