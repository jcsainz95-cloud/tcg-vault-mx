/**
 * §M4-SHIP.17.2 / §M4-SHIP.18 (v1.80.3 → v1.80.6) — EL CIERRE POR REEMBOLSO TOTAL, un solo punto de entrada.
 *
 * `onFullRefund(tx, target, trigger, actorUserId, opts?)` despacha por `FulfillmentMode` (⛔ nunca cae por
 * defecto en una rama, ARCHITECTURE §4.21d):
 *  - PI de un RETIRO (`target.shipmentRequestId`) ⇒ `closeShipmentsOnFullRefund` rama retiro;
 *  - orden `direct_ship` ⇒ `closeShipmentsOnFullRefund` rama directo (envío vivo ⇒ `cancelado`, piezas
 *    `picking` CONGELADAS, `chargebackNeedsManual=true`);
 *  - orden `vault` ⇒ `reclaimVaultOnFullRefund` (la venta se deshace: cada carta vigente en custodia del
 *    cliente vuelve a la plataforma `picking` CONGELADA con `refund_return`, la colocación `pending` se cancela
 *    con `full_refund`, la orden queda en `chargebackNeedsManual`).
 *
 * **El sello `Order.fullRefundClosedAt` (§18.2, SEC-SHIP-A5 (a)) YA NO ES UN NO-OP TOTAL:** en TODA pasada la
 * rama `vault` corre la clasificación y el CAS por pieza (idempotente por el `WHERE`); el sello decide SOLO lo
 * que no debe repetirse: `chargebackNeedsManual` (primera pasada: siempre; siguientes: solo si reclamó ≥1),
 * la bitácora (`order.full_refund_closed` / `order.vault_reclaimed`) y el `AV-3` (una vez).
 *
 * **Llamadores exactos (`C-FULLREF-1`):** M3 `refund` / `retry` (vía `executeRefund`, la tx de confirmación),
 * `onChargeRefunded` (webhook `charge.refunded` total), `unprepare` de un retiro (`'unprepared'`,
 * `onlyItemIds`) y `reclaim-vault` (`'reclaim'`, el único que pasa `unpackedConfirmed`/`unpackedItemIds`).
 *
 * **Orden de candados (⛔ ninguno nuevo):** envíos (`FOR UPDATE`, id asc.) → piezas (id asc.) → `Order` → libro.
 * El mismo que el preparado (§M4-SHIP.5) ⇒ M3, preparado y webhook se serializan sin interbloqueo.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CurrentPiece, currentPiecesOf, resolveOriginsBatch } from './origin';

export type FullRefundTrigger = 'm3' | 'charge_refunded' | 'unprepared' | 'reclaim';
export type FullRefundTarget = { orderId: string } | { shipmentRequestId: string };

export interface FullRefundOpts {
  /** `unprepare`: acota la pasada a estas piezas (no toma otros retiros). */
  onlyItemIds?: string[];
  /** SOLO `reclaim-vault`: «saqué de su caja las cartas de retiros preparados o con guía». */
  unpackedConfirmed?: boolean;
  /** SOLO `reclaim-vault` (v1.80.6, SEC-SHIP-B12): acota `unpackedConfirmed` a estas piezas. */
  unpackedItemIds?: string[];
}

/** §M4-SHIP.18.6 — clase L derivada (⛔ no es enum de schema). */
export type VaultPieceState =
  | 'in_custody'
  | 'returned'
  | 'in_packed_withdrawal'
  | 'already_withdrawn'
  | 'open_case'
  | 'not_customer'
  | 'ambiguous'
  | 'other_purchase';

export interface VaultPieceClassification {
  orderItemId: string;
  inventoryItemId: string;
  folio: string;
  cardName: string;
  state: VaultPieceState;
  /** `returned` ∧ plataforma `picking` ∧ `reclaimedBy` esta orden ∧ `chargebackNeedsManual`. */
  pendingConfirmation: boolean;
  /** Solo dentro de una pasada: esta pasada la reclamó. */
  reclaimedNow: boolean;
  shipment: { id: string; status: string; preparedAt: Date | null } | null;
}

export interface FullRefundPassResult {
  mode: 'direct_ship' | 'vault' | 'withdrawal';
  /** Esta pasada escribió el sello (primera pasada) ⇒ quien la corrió manda `AV-3`. */
  sealedNow: boolean;
  /** Piezas devueltas a la plataforma EN ESTA pasada (vault). */
  reclaimedItemIds: string[];
  untouched: { inventoryItemId: string; state: VaultPieceState }[];
  placementCancelled: boolean;
  /** Envíos cerrados en esta pasada (directo / retiro) y sus piezas congeladas. */
  closedShipmentIds: string[];
  frozenItemIds: string[];
  chargebackNeedsManual: boolean;
  pieces: VaultPieceClassification[];
}

type Tx = Prisma.TransactionClient;

const LIVE: readonly ('solicitado' | 'picking' | 'guia')[] = ['solicitado', 'picking', 'guia'];

@Injectable()
export class FullRefundService {
  private readonly logger = new Logger(FullRefundService.name);

  // ============================================================ el despachador (§18.2)

  async onFullRefund(
    tx: Tx,
    target: FullRefundTarget,
    trigger: FullRefundTrigger,
    actorUserId: string | null,
    opts: FullRefundOpts = {},
  ): Promise<FullRefundPassResult> {
    if ('shipmentRequestId' in target) {
      if (trigger === 'unprepared' || trigger === 'reclaim') {
        throw new Error(`onFullRefund: trigger '${trigger}' only reclaims vault orders (got a shipment target)`);
      }
      return this.closeShipmentsOnFullRefund(tx, target, trigger, actorUserId);
    }
    const order = await tx.order.findUnique({
      where: { id: target.orderId },
      select: { id: true, fulfillmentMode: true },
    });
    if (!order) throw new Error(`onFullRefund: order ${target.orderId} not found`);
    switch (order.fulfillmentMode) {
      case 'direct_ship':
        if (trigger === 'unprepared' || trigger === 'reclaim') {
          throw new Error(`onFullRefund: trigger '${trigger}' only reclaims vault orders (got direct_ship)`);
        }
        return this.closeShipmentsOnFullRefund(tx, target, trigger, actorUserId);
      case 'vault':
        return this.reclaimVaultOnFullRefund(tx, target.orderId, trigger, actorUserId, opts);
      default: {
        const mode: string = order.fulfillmentMode;
        this.logger.error(`onFullRefund: fulfillmentMode '${mode}' sin rama de cierre (orden ${order.id}).`);
        throw new Error(`Unsupported fulfillmentMode in onFullRefund: ${mode}`);
      }
    }
  }

  // ============================================================ directo / retiro (§17.2)

  /**
   * Cada envío del cobro en `picking | guia` ⇒ `cancelado` (CAS). Directo: sus piezas `picking` se quedan
   * `picking` (congeladas) y `chargebackNeedsManual=true`. Retiro: sus piezas no se tocan (nunca salieron de
   * la bóveda). Envío ya `cancelado|enviado|entregado` ⇒ no-op (idempotente). ⛔ Sin `AV-6`.
   */
  private async closeShipmentsOnFullRefund(
    tx: Tx,
    target: FullRefundTarget,
    trigger: FullRefundTrigger,
    actorUserId: string | null,
  ): Promise<FullRefundPassResult> {
    const isOrder = 'orderId' in target;
    const where: Prisma.ShipmentRequestWhereInput = isOrder
      ? { orderId: target.orderId }
      : { id: (target as { shipmentRequestId: string }).shipmentRequestId };
    const shipments = await tx.shipmentRequest.findMany({
      where: { ...where, status: { in: ['picking', 'guia'] } },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    const ids = shipments.map((s) => s.id);
    if (ids.length > 0) {
      await tx.$queryRaw`SELECT id FROM "ShipmentRequest" WHERE id = ANY(${ids}::text[]) ORDER BY id FOR UPDATE`;
    }
    const closed: string[] = [];
    const frozen: string[] = [];
    for (const id of ids) {
      const res = await tx.shipmentRequest.updateMany({
        where: { id, status: { in: ['picking', 'guia'] } },
        data: { status: 'cancelado' },
      });
      if (res.count !== 1) continue;
      closed.push(id);
      if (isOrder) {
        const lines = await tx.shipmentItem.findMany({
          where: { shipmentRequestId: id, inventoryItem: { status: 'picking', ownerType: 'platform' } },
          select: { inventoryItemId: true },
        });
        frozen.push(...lines.map((l) => l.inventoryItemId));
      }
      await tx.auditLog.create({
        data: {
          actorUserId,
          actorRole: null,
          action: 'shipment.closed_by_full_refund',
          entityType: 'ShipmentRequest',
          entityId: id,
          after: {
            trigger,
            ...(isOrder ? { orderId: target.orderId } : { shipmentRequestId: id }),
            frozenItemIds: isOrder ? frozen : [],
          },
        },
      });
    }
    if (!isOrder) {
      return {
        mode: 'withdrawal',
        sealedNow: false,
        reclaimedItemIds: [],
        untouched: [],
        placementCancelled: false,
        closedShipmentIds: closed,
        frozenItemIds: [],
        chargebackNeedsManual: false,
        pieces: [],
      };
    }
    // `Order` FOR UPDATE y el sello (§18.2): se escribe UNA vez.
    const [row] = await tx.$queryRaw<{ fullRefundClosedAt: Date | null; chargebackNeedsManual: boolean }[]>`
      SELECT "fullRefundClosedAt", "chargebackNeedsManual" FROM "Order" WHERE id = ${target.orderId} FOR UPDATE`;
    const sealedNow = row.fullRefundClosedAt === null;
    let needsManual = row.chargebackNeedsManual;
    if (closed.length > 0) needsManual = true;
    await tx.order.updateMany({
      where: { id: target.orderId },
      data: {
        ...(closed.length > 0 ? { chargebackNeedsManual: true } : {}),
        ...(sealedNow ? { fullRefundClosedAt: new Date() } : {}),
      },
    });
    return {
      mode: 'direct_ship',
      sealedNow,
      reclaimedItemIds: [],
      untouched: [],
      placementCancelled: false,
      closedShipmentIds: closed,
      frozenItemIds: frozen,
      chargebackNeedsManual: needsManual,
      pieces: [],
    };
  }

  // ============================================================ bóveda (§18.4, v1.80.6)

  /**
   * Un cuerpo para la pasada Y para la proyección `vaultPieces` (`classifyVaultPieces`): la pasada escribe
   * (CAS por pieza), la proyección solo clasifica. Candados: (a) lectura sin candado; (b) retiros vivos
   * `FOR UPDATE`; (c) piezas `FOR UPDATE`; (d) `Order` `FOR UPDATE` + sello; (e) relectura de retiros;
   * (f) la colocación al final.
   */
  private async reclaimVaultOnFullRefund(
    tx: Tx,
    orderId: string,
    trigger: FullRefundTrigger,
    actorUserId: string | null,
    opts: FullRefundOpts,
  ): Promise<FullRefundPassResult> {
    const now = new Date();
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { id: true, userId: true, orderNumber: true, items: { select: { id: true, inventoryItemId: true } } },
    });
    const customerUserId = order.userId as string;
    // (a) sin candado: cadena y retiros vivos.
    const chains = await currentPiecesOf(tx, order.items);
    let items = order.items;
    if (opts.onlyItemIds) {
      const only = new Set(opts.onlyItemIds);
      items = items.filter((oi) => {
        const c = chains.get(oi.id);
        return c?.kind === 'piece' && only.has(c.inventoryItemId);
      });
    }
    const pieceIds = items
      .map((oi) => chains.get(oi.id))
      .filter((c): c is Extract<CurrentPiece, { kind: 'piece' }> => !!c && c.kind === 'piece')
      .map((c) => c.inventoryItemId)
      .sort();
    const liveBefore = await this.liveWithdrawalsOf(tx, pieceIds);
    // (b) retiros vivos FOR UPDATE, id asc.
    const shipmentIds = [...new Set([...liveBefore.values()].map((s) => s.id))].sort();
    if (shipmentIds.length > 0) {
      await tx.$queryRaw`SELECT id FROM "ShipmentRequest" WHERE id = ANY(${shipmentIds}::text[]) ORDER BY id FOR UPDATE`;
    }
    // (c) piezas FOR UPDATE, id asc.
    if (pieceIds.length > 0) {
      await tx.$queryRaw`SELECT id FROM "InventoryItem" WHERE id = ANY(${pieceIds}::text[]) ORDER BY id FOR UPDATE`;
    }
    // (d) Order FOR UPDATE + sello.
    const [head] = await tx.$queryRaw<{ fullRefundClosedAt: Date | null; chargebackNeedsManual: boolean }[]>`
      SELECT "fullRefundClosedAt", "chargebackNeedsManual" FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
    const firstPass = head.fullRefundClosedAt === null;
    const sealAt = firstPass ? now : (head.fullRefundClosedAt as Date);
    // (e) relectura de retiros: uno que no estaba en (b) ⇒ «en caja» (conservador).
    const liveAfter = await this.liveWithdrawalsOf(tx, pieceIds);
    const locked = new Set(shipmentIds);

    const pieces: VaultPieceClassification[] = [];
    const reclaimedNow: string[] = [];
    const classified = await this.classifyUnderLock(tx, {
      orderId,
      customerUserId,
      items,
      chains,
      sealAt,
      chargebackNeedsManual: head.chargebackNeedsManual,
      live: liveAfter,
    });
    for (const c of classified) {
      const live = liveAfter.get(c.inventoryItemId);
      let state = c.state;
      let reclaim = false;
      if (state === 'in_custody') {
        const packed = !!live && (live.status === 'guia' || live.preparedAt !== null);
        const unlockedShipment = !!live && !locked.has(live.id);
        if (!live || (!packed && !unlockedShipment)) reclaim = true;
        else if (
          packed &&
          !unlockedShipment &&
          opts.unpackedConfirmed === true &&
          (!opts.unpackedItemIds || opts.unpackedItemIds.includes(c.inventoryItemId))
        ) {
          reclaim = true;
        } else {
          state = 'in_packed_withdrawal';
          this.logger.warn(
            `reembolso total ${order.orderNumber ?? orderId}: pieza ${c.inventoryItemId} en una caja (retiro ${live?.id}, ` +
              `${live?.status}); no se toca en esta pasada (${trigger}).`,
          );
        }
      }
      if (reclaim) {
        const before = await tx.inventoryItem.findUniqueOrThrow({
          where: { id: c.inventoryItemId },
          select: { locationId: true },
        });
        const res = await tx.inventoryItem.updateMany({
          where: {
            id: c.inventoryItemId,
            ownerType: 'customer',
            ownerUserId: customerUserId,
            ownershipStatus: 'settled',
            status: 'in_custody',
          },
          data: { ownerType: 'platform', ownerUserId: null, ownershipStatus: null, status: 'picking' },
        });
        if (res.count === 1) {
          await tx.inventoryMovement.create({
            data: {
              itemId: c.inventoryItemId,
              fromStatus: 'in_custody',
              toStatus: 'picking',
              fromLocationId: before.locationId,
              toLocationId: before.locationId,
              reason: 'refund_return',
              actorUserId,
              note:
                trigger === 'unprepared'
                  ? `reembolso total ${order.orderNumber ?? orderId} · reclamada al deshacer preparado`
                  : trigger === 'reclaim'
                    ? `reembolso total ${order.orderNumber ?? orderId} · reclamada a mano`
                    : `reembolso total ${order.orderNumber ?? orderId}`,
              createdAt: now,
            },
          });
          state = 'returned';
          reclaimedNow.push(c.inventoryItemId);
        } else {
          state = 'ambiguous';
          this.logger.error(`reembolso total ${orderId}: CAS de reclamo de ${c.inventoryItemId} contó 0.`);
        }
      }
      pieces.push({
        ...c,
        state,
        reclaimedNow: reclaimedNow.includes(c.inventoryItemId),
        pendingConfirmation: state === 'returned',
      });
    }
    const untouched = pieces.filter((p) => !p.reclaimedNow).map((p) => ({ inventoryItemId: p.inventoryItemId, state: p.state }));

    // Después del bucle: según el sello (tabla de §18.2).
    let needsManual = head.chargebackNeedsManual;
    if (firstPass) {
      if (order.items.length > 0) needsManual = true;
    } else if (reclaimedNow.length > 0) {
      needsManual = true;
    }
    // (f) la colocación pendiente, al final (§18.5). Idempotente por su `status:'pending'`.
    const placement = await tx.vaultPlacement.updateMany({
      where: { orderId, status: 'pending' },
      data: { status: 'cancelled', cancelledAt: now, cancelledByUserId: actorUserId, cancelReason: 'full_refund' },
    });
    await tx.order.updateMany({
      where: { id: orderId },
      data: {
        ...(needsManual !== head.chargebackNeedsManual ? { chargebackNeedsManual: needsManual } : {}),
        ...(firstPass ? { fullRefundClosedAt: now } : {}),
      },
    });
    if (firstPass) {
      await tx.auditLog.create({
        data: {
          actorUserId,
          actorRole: null,
          action: 'order.full_refund_closed',
          entityType: 'Order',
          entityId: orderId,
          after: { trigger, returnedItemIds: reclaimedNow, untouched, placementCancelled: placement.count === 1 },
        },
      });
    } else if (reclaimedNow.length > 0) {
      await tx.auditLog.create({
        data: {
          actorUserId,
          actorRole: null,
          action: 'order.vault_reclaimed',
          entityType: 'Order',
          entityId: orderId,
          after: { trigger, returnedItemIds: reclaimedNow, untouched, unpackedConfirmed: opts.unpackedConfirmed === true },
        },
      });
    }
    return {
      mode: 'vault',
      sealedNow: firstPass,
      reclaimedItemIds: reclaimedNow,
      untouched,
      placementCancelled: placement.count === 1,
      closedShipmentIds: [],
      frozenItemIds: [],
      chargebackNeedsManual: needsManual,
      pieces: pieces.map((p) => ({ ...p, pendingConfirmation: p.state === 'returned' && needsManual })),
    };
  }

  /** Retiros VIVOS (`solicitado|picking|guia`) que contienen cada pieza; el más viejo por id si hubiera dos. */
  private async liveWithdrawalsOf(
    tx: Tx,
    pieceIds: string[],
  ): Promise<Map<string, { id: string; status: 'solicitado' | 'picking' | 'guia'; preparedAt: Date | null }>> {
    const out = new Map<string, { id: string; status: 'solicitado' | 'picking' | 'guia'; preparedAt: Date | null }>();
    if (pieceIds.length === 0) return out;
    const rows = await tx.shipmentItem.findMany({
      where: { inventoryItemId: { in: pieceIds }, shipmentRequest: { status: { in: [...LIVE] } } },
      select: {
        inventoryItemId: true,
        shipmentRequest: { select: { id: true, status: true, preparedAt: true } },
      },
    });
    rows.sort((a, b) => (a.shipmentRequest.id < b.shipmentRequest.id ? -1 : 1));
    for (const r of rows) {
      if (out.has(r.inventoryItemId)) continue;
      out.set(r.inventoryItemId, {
        id: r.shipmentRequest.id,
        status: r.shipmentRequest.status as 'solicitado' | 'picking' | 'guia',
        preparedAt: r.shipmentRequest.preparedAt,
      });
    }
    return out;
  }

  /**
   * §18.6 (v1.80.6, SEC-SHIP-M6) — `reclaimedBy(order, pieza)`: existe `InventoryMovement{reason:'refund_return'}`
   * de la pieza con `createdAt ≥ fullRefundClosedAt` (el mismo `now` de la tx) y NINGÚN movimiento posterior
   * que cambie de estado (`fromStatus ≠ toStatus`): un `move` (`picking → picking`) no la saca del conjunto.
   */
  private async reclaimedByBatch(tx: Tx, pieceIds: string[], sealAt: Date): Promise<Set<string>> {
    const out = new Set<string>();
    if (pieceIds.length === 0) return out;
    const moves = await tx.inventoryMovement.findMany({
      where: { itemId: { in: pieceIds } },
      select: { itemId: true, reason: true, fromStatus: true, toStatus: true, createdAt: true, id: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const byItem = new Map<string, typeof moves>();
    for (const m of moves) {
      const list = byItem.get(m.itemId) ?? [];
      list.push(m);
      byItem.set(m.itemId, list);
    }
    for (const id of pieceIds) {
      const list = byItem.get(id) ?? [];
      let idx = -1;
      for (let i = list.length - 1; i >= 0; i -= 1) {
        if (list[i].reason === 'refund_return' && list[i].createdAt.getTime() >= sealAt.getTime()) {
          idx = i;
          break;
        }
      }
      if (idx < 0) continue;
      const later = list.slice(idx + 1).some((m) => m.fromStatus !== m.toStatus);
      if (!later) out.add(id);
    }
    return out;
  }

  /** La clasificación por carta (§18.4), sobre lecturas del `tx` dado (bajo candado en la pasada). */
  private async classifyUnderLock(
    tx: Tx,
    ctx: {
      orderId: string;
      customerUserId: string;
      items: { id: string; inventoryItemId: string }[];
      chains: Map<string, CurrentPiece>;
      sealAt: Date;
      chargebackNeedsManual: boolean;
      live: Map<string, { id: string; status: string; preparedAt: Date | null }>;
    },
  ): Promise<VaultPieceClassification[]> {
    const pieceIds = ctx.items
      .map((oi) => ctx.chains.get(oi.id))
      .filter((c): c is Extract<CurrentPiece, { kind: 'piece' }> => !!c && c.kind === 'piece')
      .map((c) => c.inventoryItemId);
    const [rows, origins, openCases, shippedOut, reclaimed] = await Promise.all([
      tx.inventoryItem.findMany({
        where: { id: { in: pieceIds } },
        select: {
          id: true,
          folio: true,
          status: true,
          ownerType: true,
          ownerUserId: true,
          ownershipStatus: true,
          card: { select: { name: true } },
        },
      }),
      resolveOriginsBatch(tx, ctx.customerUserId, pieceIds),
      tx.replacementCase.findMany({
        where: { status: 'open', originalInventoryItemId: { in: pieceIds } },
        select: { originalInventoryItemId: true },
      }),
      tx.shipmentItem.findMany({
        where: { inventoryItemId: { in: pieceIds }, shipmentRequest: { status: { in: ['enviado', 'entregado'] } } },
        select: { inventoryItemId: true },
      }),
      this.reclaimedByBatch(tx, pieceIds, ctx.sealAt),
    ]);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const withOpenCase = new Set(openCases.map((c) => c.originalInventoryItemId));
    const shipped = new Set(shippedOut.map((s) => s.inventoryItemId));
    const out: VaultPieceClassification[] = [];
    for (const oi of ctx.items) {
      const chain = ctx.chains.get(oi.id);
      if (!chain || chain.kind !== 'piece') {
        const original = await tx.inventoryItem.findUnique({
          where: { id: oi.inventoryItemId },
          select: { folio: true, card: { select: { name: true } } },
        });
        this.logger.error(`reembolso total ${ctx.orderId}: cadena ambigua en la línea ${oi.id} (${chain?.kind === 'ambiguous' ? chain.reason : 'sin cadena'}).`);
        out.push({
          orderItemId: oi.id,
          inventoryItemId: oi.inventoryItemId,
          folio: original?.folio ?? '',
          cardName: original?.card.name ?? '',
          state: 'ambiguous',
          pendingConfirmation: false,
          reclaimedNow: false,
          shipment: null,
        });
        continue;
      }
      const p = byId.get(chain.inventoryItemId);
      const live = ctx.live.get(chain.inventoryItemId) ?? null;
      const base = {
        orderItemId: oi.id,
        inventoryItemId: chain.inventoryItemId,
        folio: p?.folio ?? '',
        cardName: p?.card.name ?? '',
        pendingConfirmation: false,
        reclaimedNow: false,
        shipment: live ? { id: live.id, status: live.status, preparedAt: live.preparedAt } : null,
      };
      if (!p) {
        out.push({ ...base, state: 'ambiguous' });
        continue;
      }
      const origin = origins.get(chain.inventoryItemId) ?? null;
      const isCustomer = p.ownerType === 'customer' && p.ownerUserId === ctx.customerUserId;
      if (p.ownerType === 'platform') {
        const returned = reclaimed.has(p.id);
        out.push({
          ...base,
          state: returned ? 'returned' : 'not_customer',
          pendingConfirmation: returned && p.status === 'picking' && ctx.chargebackNeedsManual,
        });
        continue;
      }
      if (isCustomer && origin && origin.orderItemId !== oi.id) {
        out.push({ ...base, state: 'other_purchase' });
        continue;
      }
      if (p.status === 'withdrawn' || shipped.has(p.id)) {
        out.push({ ...base, state: 'already_withdrawn' });
        continue;
      }
      if (isCustomer && (p.status === 'lost' || p.status === 'damaged') && withOpenCase.has(p.id)) {
        out.push({ ...base, state: 'open_case' });
        continue;
      }
      if (isCustomer && p.status === 'in_custody' && p.ownershipStatus === 'settled') {
        out.push({ ...base, state: 'in_custody' });
        continue;
      }
      out.push({ ...base, state: 'ambiguous' });
    }
    return out;
  }

  // ============================================================ lecturas (§18.6 / §18.7)

  /**
   * `vaultPieces` de M3 y los objetivos de `chargeback-inventory` (bóveda): la MISMA clasificación de la
   * pasada, sin escribir. Con `forUpdate`, toma los candados de piezas (id asc.) antes de leer (§18.7).
   */
  async classifyVaultPieces(
    db: Tx,
    orderId: string,
    opts: { forUpdate?: boolean } = {},
  ): Promise<{ pieces: VaultPieceClassification[]; fullRefundClosedAt: Date | null; chargebackNeedsManual: boolean }> {
    const order = await db.order.findUniqueOrThrow({
      where: { id: orderId },
      select: {
        id: true,
        userId: true,
        fullRefundClosedAt: true,
        chargebackNeedsManual: true,
        items: { select: { id: true, inventoryItemId: true } },
      },
    });
    const chains = await currentPiecesOf(db, order.items);
    const pieceIds = order.items
      .map((oi) => chains.get(oi.id))
      .filter((c): c is Extract<CurrentPiece, { kind: 'piece' }> => !!c && c.kind === 'piece')
      .map((c) => c.inventoryItemId)
      .sort();
    if (opts.forUpdate && pieceIds.length > 0) {
      await db.$queryRaw`SELECT id FROM "InventoryItem" WHERE id = ANY(${pieceIds}::text[]) ORDER BY id FOR UPDATE`;
    }
    const live = await this.liveWithdrawalsOf(db, pieceIds);
    const pieces = await this.classifyUnderLock(db, {
      orderId,
      customerUserId: order.userId as string,
      items: order.items,
      chains,
      sealAt: order.fullRefundClosedAt ?? new Date(8640000000000000),
      chargebackNeedsManual: order.chargebackNeedsManual,
      live,
    });
    // Antes del reembolso el sello es null ⇒ `returned` no puede existir; con sello, una `in_custody` en
    // caja es la señal de que falta una pasada (§18.6).
    const out = pieces.map((p) => {
      if (p.state !== 'in_custody' || order.fullRefundClosedAt === null) return p;
      const s = p.shipment;
      const packed = !!s && (s.status === 'guia' || s.preparedAt !== null);
      return packed ? { ...p, state: 'in_packed_withdrawal' as const } : p;
    });
    return { pieces: out, fullRefundClosedAt: order.fullRefundClosedAt, chargebackNeedsManual: order.chargebackNeedsManual };
  }
}
