import { InventoryItem, MovementReason, Prisma } from '@prisma/client';
import { clearReservation, failPendingOrder, releaseReservationData, reservationGuard } from '../orders/reservation';
import { releaseAccessoryReservations } from '../orders/accessory-stock';

/**
 * settle-line.ts — §BOVEDA-COBRADA-SIN-PIEZAS (DECISIONES). UNA sola función por línea para las DOS ramas de liquidación
 * (`vault` y `direct_ship`): ⛔ nunca dos cuerpos. Reemplaza al `continue` mudo / «anomalía y no se mueve».
 *
 * Una orden COBRADA siempre entrega algo o queda «requiere atención»; ⛔ nunca queda «liquidada normal» sin pieza.
 * Por línea, EN ESTE ORDEN y dentro de la MISMA transacción que ganó el CAS de la orden:
 *  (a) reservada por ESTA orden (o legada) ⇒ como siempre;
 *  (b) ya entregada a este comprador (reintento) ⇒ idempotente (salvo que OTRA orden liquidada la reclame ⇒ doble cobro);
 *  R2  reservada por OTRA orden del MISMO usuario: `pending`/`failed` ⇒ se TRANSFIERE a esta (la otra pasa a `failed` por CAS);
 *      `settled` ⇒ doble cobro, ambas «requieren atención» (sin automatismo: es dinero ya movido);
 *  (c) libre de plataforma ⇒ se asigna (CAS);
 *  (d) no disponible (de otro / vendida / retirada) ⇒ COPIA EQUIVALENTE libre de plataforma (nunca de un cliente);
 *  (e) sin copia ⇒ «requiere atención» (`OrderItem.fulfillmentFailedAt/Reason`), SIN reembolso automático.
 * ⛔ Nunca cambia lo cobrado ni el costo de cada pieza. ⛔ Nunca mueve dinero.
 */

export type SettleMode = 'vault' | 'direct_ship';
export type AttentionReason = 'no_equivalent_copy' | 'double_charge' | 'item_missing';

export type SettleLineOutcome =
  | { kind: 'reserved' }
  | { kind: 'already' }
  | { kind: 'recovered'; was: string }
  | { kind: 'transferred'; was: string; fromOrderId: string }
  | { kind: 'replaced'; was: string; copyId: string; copyFolio: string; originalFolio: string }
  | { kind: 'attention'; was: string; reason: AttentionReason; otherOrderId?: string }
  /** Solo la reparación: la reposición por copia no aplica a este pedido (anterior al despliegue); no se escribe NADA. */
  | { kind: 'skipped'; was: string };

export interface SettleLineResult {
  outcome: SettleLineOutcome;
  /** La pieza que ahora respalda la línea (la copia si hubo reposición; la original en cualquier otro caso). */
  inventoryItemId: string;
  /** `false` ⇒ esta llamada no escribió nada nuevo (p. ej. una línea YA marcada «requiere atención» que sigue sin copia). */
  changed?: boolean;
}

export interface SettleLineContext {
  tx: Prisma.TransactionClient;
  order: { id: string; userId: string | null; orderNumber: string | null };
  mode: SettleMode;
  now: Date;
  /** `false` ⇒ solo (a)/(b)/R2/(c): la reposición por copia queda para quien decida (reparación de pedidos anteriores). */
  allowReplace: boolean;
  source: 'settle' | 'repair';
  /** Órdenes `pending` que ESTA tx puso en `failed` por R2 (para soltar lo que sobre y cancelar su PI post-commit). */
  failedHere: Set<string>;
}

export interface SettleLineLike {
  id: string;
  inventoryItemId: string;
  fulfillmentFailedAt?: Date | null;
}

/** Pieza LIBRE de plataforma: la única que se puede asignar o usar de copia. ⛔ Una reserva viva de otro pedido NO cumple. */
export const FREE_PLATFORM_WHERE = {
  status: { in: ['listed', 'in_stock'] },
  ownerType: 'platform',
  ownerUserId: null,
  reservedByOrderId: null,
} as const satisfies Prisma.InventoryItemWhereInput;

/** Estados desde los que una pieza de un pedido liquidado NO está donde debía (el eje de la invariante). */
export const POOL_OR_RESERVED_STATUSES = ['listed', 'in_stock', 'reserved'] as const;

function deliveredData(mode: SettleMode, buyerId: string | null): Prisma.InventoryItemUncheckedUpdateManyInput {
  return mode === 'vault'
    ? { status: 'in_custody', ownershipStatus: 'settled', ownerType: 'customer', ownerUserId: buyerId, ...clearReservation }
    : { status: 'picking', ...clearReservation };
}

/** Condición de la copia EQUIVALENTE: misma carta y versión, mismo acabado/idioma y la identidad por tipo. */
export function equivalentCopyWhere(orig: InventoryItem): Prisma.InventoryItemWhereInput {
  const where: Prisma.InventoryItemWhereInput = {
    cardId: orig.cardId,
    cardProductId: orig.cardProductId,
    productType: orig.productType,
    finish: orig.finish,
    language: orig.language,
  };
  if (orig.productType === 'raw') where.rawCondition = orig.rawCondition;
  else if (orig.productType === 'graded') {
    where.gradingCompany = orig.gradingCompany;
    where.gradeValue = orig.gradeValue;
  } else {
    where.sealedSubtype = orig.sealedSubtype;
    where.sealedCondition = orig.sealedCondition;
    where.sealedProductId = orig.sealedProductId;
  }
  return where;
}

const MAX_COPY_ATTEMPTS = 25;

async function audit(
  ctx: SettleLineContext,
  action: string,
  after: Record<string, unknown>,
): Promise<void> {
  await ctx.tx.auditLog.create({
    data: { actorUserId: null, actorRole: null, action, entityType: 'Order', entityId: ctx.order.id, after: after as Prisma.InputJsonValue },
  });
}

async function markAttention(
  ctx: SettleLineContext,
  oi: SettleLineLike,
  item: InventoryItem | null,
  reason: AttentionReason,
  otherOrderId?: string,
): Promise<SettleLineResult> {
  const was = item?.status ?? 'missing';
  // Idempotente: la PRIMERA marca manda (un reintento que sigue sin copia no reescribe la fecha ni vuelve a auditar).
  const marked = await ctx.tx.orderItem.updateMany({
    where: { id: oi.id, fulfillmentFailedAt: null },
    data: { fulfillmentFailedAt: ctx.now, fulfillmentFailedReason: reason },
  });
  if (marked.count === 1) {
    await audit(ctx, 'order.settle_item_attention', {
      orderItemId: oi.id,
      inventoryItemId: oi.inventoryItemId,
      was,
      reason,
      source: ctx.source,
      ...(otherOrderId ? { otherOrderId } : {}),
    });
  }
  return {
    outcome: { kind: 'attention', was, reason, ...(otherOrderId ? { otherOrderId } : {}) },
    inventoryItemId: oi.inventoryItemId,
    changed: marked.count === 1,
  };
}

async function clearAttention(ctx: SettleLineContext, oi: SettleLineLike): Promise<void> {
  if (!oi.fulfillmentFailedAt) return;
  await ctx.tx.orderItem.updateMany({
    where: { id: oi.id },
    data: { fulfillmentFailedAt: null, fulfillmentFailedReason: null },
  });
}

async function movement(
  ctx: SettleLineContext,
  itemId: string,
  fromStatus: InventoryItem['status'],
  data: Prisma.InventoryItemUncheckedUpdateManyInput,
  note: string,
  reason: MovementReason = MovementReason.settle,
): Promise<void> {
  await ctx.tx.inventoryMovement.create({
    data: { itemId, fromStatus, toStatus: (data.status as InventoryItem['status']) ?? fromStatus, reason, note },
  });
}

/** ¿OTRA orden liquidada, con línea viva (sin reembolso), reclama esta pieza? ⇒ doble cobro. */
async function claimedBySettledOrder(ctx: SettleLineContext, itemId: string) {
  return ctx.tx.orderItem.findFirst({
    where: { inventoryItemId: itemId, orderId: { not: ctx.order.id }, refund: null, order: { status: 'settled' } },
    select: { id: true, orderId: true, fulfillmentFailedAt: true },
  });
}

async function flagOther(ctx: SettleLineContext, line: { id: string; orderId: string }, itemId: string): Promise<void> {
  await ctx.tx.orderItem.updateMany({
    where: { id: line.id, fulfillmentFailedAt: null },
    data: { fulfillmentFailedAt: ctx.now, fulfillmentFailedReason: 'double_charge' },
  });
  await ctx.tx.auditLog.create({
    data: {
      actorUserId: null,
      actorRole: null,
      action: 'order.settle_item_attention',
      entityType: 'Order',
      entityId: line.orderId,
      after: { orderItemId: line.id, inventoryItemId: itemId, was: 'in_custody', reason: 'double_charge', otherOrderId: ctx.order.id, source: ctx.source },
    },
  });
}

/** (d) — busca y toma (CAS) la copia equivalente más antigua; si pierde la carrera, pasa a la siguiente candidata. */
async function takeEquivalentCopy(
  ctx: SettleLineContext,
  orig: InventoryItem,
): Promise<Pick<InventoryItem, 'id' | 'folio' | 'status'> | null> {
  const tried: string[] = [orig.id];
  for (let i = 0; i < MAX_COPY_ATTEMPTS; i += 1) {
    const cand = await ctx.tx.inventoryItem.findFirst({
      where: {
        ...FREE_PLATFORM_WHERE,
        ...equivalentCopyWhere(orig),
        id: { notIn: tried },
        // Ni en un envío vivo ni reclamada por una línea de un pedido liquidado que aún no se reparó.
        shipmentItems: { none: { shipmentRequest: { status: { not: 'cancelado' } } } },
        orderItems: { none: { refund: null, order: { status: 'settled' } } },
      },
      orderBy: [{ createdAt: 'asc' }, { folio: 'asc' }],
      select: { id: true, folio: true, status: true },
    });
    if (!cand) return null;
    const won = await ctx.tx.inventoryItem.updateMany({
      where: { id: cand.id, ...FREE_PLATFORM_WHERE },
      data: deliveredData(ctx.mode, ctx.order.userId),
    });
    if (won.count === 1) return cand;
    tried.push(cand.id);
  }
  return null;
}

/**
 * La función compartida. Escribe SOLO dentro de `ctx.tx`; devuelve qué pasó y qué pieza respalda la línea. No lanza por «no hay
 * pieza»: ese caso es «requiere atención» (la orden ya cobró).
 */
export async function settleLineOrReplace(ctx: SettleLineContext, oi: SettleLineLike): Promise<SettleLineResult> {
  const { tx, order, mode } = ctx;
  const item = await tx.inventoryItem.findUnique({ where: { id: oi.inventoryItemId } });
  if (!item) return markAttention(ctx, oi, null, 'item_missing');

  // (a) reservada por ESTA orden (o legada): la transición de siempre.
  const reservedData: Prisma.InventoryItemUncheckedUpdateManyInput =
    mode === 'vault' ? { status: 'in_custody', ownershipStatus: 'settled', ...clearReservation } : { status: 'picking', ...clearReservation };
  const moved = await tx.inventoryItem.updateMany({ where: { id: item.id, ...reservationGuard(order.id) }, data: reservedData });
  if (moved.count === 1) {
    await movement(ctx, item.id, item.status, reservedData, mode === 'vault' ? `order ${order.id} settled` : `guest order ${order.orderNumber ?? order.id} settled (direct_ship)`);
    await clearAttention(ctx, oi);
    return { outcome: { kind: 'reserved' }, inventoryItemId: item.id };
  }

  // (b) ya entregada a este comprador (reintento). Idempotente — salvo que OTRA orden liquidada la reclame (doble cobro).
  const deliveredToBuyer =
    mode === 'vault'
      ? item.ownerUserId === order.userId && !(POOL_OR_RESERVED_STATUSES as readonly string[]).includes(item.status)
      : ['picking', 'shipped', 'delivered'].includes(item.status) &&
        (await tx.shipmentItem.count({ where: { inventoryItemId: item.id, shipmentRequest: { orderId: order.id } } })) > 0;
  if (deliveredToBuyer) {
    const other = await claimedBySettledOrder(ctx, item.id);
    if (!other) {
      await clearAttention(ctx, oi);
      return { outcome: { kind: 'already' }, inventoryItemId: item.id };
    }
    await flagOther(ctx, other, item.id);
    return markAttention(ctx, oi, item, 'double_charge', other.orderId);
  }

  let cur: InventoryItem = item;

  // R2 — reservada por OTRA orden del MISMO usuario.
  if (cur.status === 'reserved' && cur.reservedByOrderId && cur.reservedByOrderId !== order.id && order.userId) {
    const other = await tx.order.findUnique({
      where: { id: cur.reservedByOrderId },
      select: { id: true, userId: true, status: true, orderNumber: true },
    });
    if (other && other.userId === order.userId) {
      if (other.status === 'settled') {
        const line = await tx.orderItem.findFirst({ where: { orderId: other.id, inventoryItemId: cur.id }, select: { id: true, orderId: true } });
        if (line) await flagOther(ctx, line, cur.id);
        return markAttention(ctx, oi, cur, 'double_charge', other.id);
      }
      if (other.status === 'pending' || other.status === 'failed') {
        const ok = ctx.failedHere.has(other.id) || other.status === 'failed' || (await failPendingOrder(tx, other.id));
        if (ok) {
          if (other.status === 'pending') ctx.failedHere.add(other.id);
          const data = deliveredData(mode, order.userId);
          const t = await tx.inventoryItem.updateMany({
            where: { id: cur.id, status: 'reserved', reservedByOrderId: other.id },
            data,
          });
          if (t.count === 1) {
            await movement(ctx, cur.id, cur.status, data, `transferida del pedido ${other.orderNumber ?? other.id} al pedido cobrado ${order.orderNumber ?? order.id}`);
            await audit(ctx, 'order.settle_item_transferred', { orderItemId: oi.id, inventoryItemId: cur.id, fromOrderId: other.id, source: ctx.source });
            await clearAttention(ctx, oi);
            return { outcome: { kind: 'transferred', was: 'reserved', fromOrderId: other.id }, inventoryItemId: cur.id };
          }
        } else {
          // Perdió el CAS: la otra orden se movió bajo nuestros pies. Si ya está liquidada ⇒ doble cobro.
          const again = await tx.order.findUnique({ where: { id: other.id }, select: { status: true } });
          if (again?.status === 'settled') {
            const line = await tx.orderItem.findFirst({ where: { orderId: other.id, inventoryItemId: cur.id }, select: { id: true, orderId: true } });
            if (line) await flagOther(ctx, line, cur.id);
            return markAttention(ctx, oi, cur, 'double_charge', other.id);
          }
        }
        cur = (await tx.inventoryItem.findUnique({ where: { id: cur.id } })) ?? cur;
      }
    }
  }

  // (c) libre de plataforma ⇒ se asigna con CAS.
  const freeData = deliveredData(mode, order.userId);
  // Libre = `FREE_PLATFORM_WHERE`, y además una reserva vencida/colgada de ESTA misma orden (su `reservedByOrderId` no se limpió).
  const { reservedByOrderId: _noOwner, ...freeBase } = FREE_PLATFORM_WHERE;
  const free = await tx.inventoryItem.updateMany({
    where: { id: cur.id, ...freeBase, OR: [{ reservedByOrderId: null }, { reservedByOrderId: order.id }] },
    data: freeData,
  });
  if (free.count === 1) {
    await movement(ctx, cur.id, cur.status, freeData, `ANOMALÍA: pieza no reservada al liquidar el pedido ${order.orderNumber ?? order.id} (estaba ${cur.status}); recuperada por pago confirmado`);
    await audit(ctx, 'order.settle_item_recovered', { orderItemId: oi.id, inventoryItemId: cur.id, was: cur.status, source: ctx.source });
    await clearAttention(ctx, oi);
    return { outcome: { kind: 'recovered', was: cur.status }, inventoryItemId: cur.id };
  }

  // (d) copia equivalente.
  if (ctx.allowReplace) {
    const copy = await takeEquivalentCopy(ctx, item);
    if (copy) {
      const data = deliveredData(mode, order.userId);
      await movement(ctx, copy.id, copy.status, data, `repuesta en lugar de ${item.folio} en el pedido ${order.orderNumber ?? order.id}`);
      await movement(ctx, item.id, item.status, { status: item.status }, `reemplazada por ${copy.folio} en el pedido ${order.orderNumber ?? order.id}`, MovementReason.replacement);
      await tx.orderItem.update({
        where: { id: oi.id },
        data: { inventoryItemId: copy.id, replacedInventoryItemId: item.id, fulfillmentFailedAt: null, fulfillmentFailedReason: null },
      });
      // Las filas que COPIAN el id de la pieza se reapuntan (la colocación de bóveda y el envío directo ya creados, si los hay).
      await tx.vaultPlacementItem.updateMany({ where: { orderItemId: oi.id }, data: { inventoryItemId: copy.id } });
      await tx.shipmentItem.updateMany({
        where: { inventoryItemId: item.id, shipmentRequest: { orderId: order.id } },
        data: { inventoryItemId: copy.id },
      });
      await audit(ctx, 'order.settle_item_replaced', {
        orderItemId: oi.id,
        originalInventoryItemId: item.id,
        originalFolio: item.folio,
        copyInventoryItemId: copy.id,
        copyFolio: copy.folio,
        was: item.status,
        source: ctx.source,
      });
      return {
        outcome: { kind: 'replaced', was: item.status, copyId: copy.id, copyFolio: copy.folio, originalFolio: item.folio },
        inventoryItemId: copy.id,
      };
    }
  }

  // La reparación diaria no repone pedidos anteriores al despliegue (siguen en la lista del dueño): ni se marca ni se escribe.
  if (!ctx.allowReplace) return { outcome: { kind: 'skipped', was: cur.status }, inventoryItemId: oi.inventoryItemId, changed: false };

  // (e) sin copia ⇒ «requiere atención».
  return markAttention(ctx, oi, cur, 'no_equivalent_copy');
}

/**
 * Tras recorrer TODAS las líneas: suelta SOLO lo que las órdenes sustituidas (R2) aún retienen y la cobrada no cubre. ⛔ Nunca lo
 * que ya se transfirió (su `reservedByOrderId` ya se limpió). Misma tx.
 */
export async function releaseSupersededLeftovers(tx: Prisma.TransactionClient, failedHere: Set<string>): Promise<void> {
  for (const id of failedHere) {
    await tx.inventoryItem.updateMany({
      where: { reservedByOrderId: id, status: 'reserved' },
      data: releaseReservationData,
    });
    await releaseAccessoryReservations(tx, id);
  }
}

/** Línea efectiva tras el recorrido: lo que alimenta `VaultPlacementItem`/`ShipmentItem`. */
export interface EffectiveLine {
  orderItemId: string;
  inventoryItemId: string;
  attention: boolean;
}

export interface SettleRecord {
  orderItemId: string;
  inventoryItemId: string;
  outcome: SettleLineOutcome;
}

/** Forma de `after.anomalies[]` de `order.settle_item_not_reserved` (la que lee el súper-admin en la bitácora). */
export function anomaliesOf(records: SettleRecord[]): { inventoryItemId: string; was: string; outcome: string }[] {
  const out: { inventoryItemId: string; was: string; outcome: string }[] = [];
  for (const r of records) {
    const o = r.outcome;
    if (o.kind === 'recovered' || o.kind === 'transferred' || o.kind === 'replaced' || o.kind === 'attention') {
      out.push({ inventoryItemId: r.inventoryItemId, was: o.was, outcome: o.kind });
    }
  }
  return out;
}
