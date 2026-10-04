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
 * que no debe repetirse: `chargebackNeedsManual` (primera pasada: si la orden fue liquidada alguna vez —v1.80.8.3—; siguientes: solo si reclamó ≥1),
 * la bitácora (`order.full_refund_closed` / `order.vault_reclaimed`) y el `AV-3` (una vez).
 *
 * **Llamadores exactos (`C-FULLREF-1`):** M3 `refund` / `retry` (vía `executeRefund`, la tx de confirmación),
 * `onChargeRefunded` (webhook `charge.refunded` total), `unprepare` de un retiro (`'unprepared'`,
 * `onlyItemIds`) y `reclaim-vault` (`'reclaim'`, el único que pasa `unpackedConfirmed`/`unpackedItemIds`).
 * 💰 v1.80.8.6: `shippedReason` lo pasa SOLO M3 `refund` (`requestFullRefund`, en su tx1, rama directo).
 *
 * 💰 v1.80.8.6 (§M4-SHIP.18.12) — «depende de si ya salió»: el corte «enviado» se lee BAJO el candado de los envíos y
 * se congela en `Order.fullRefundAfterShipment` con el sello; una orden NUNCA liquidada (estado bajo candado ∈
 * `SETTLEABLE`) devuelve sus piezas `reserved` a la venta en la misma tx (`releaseReservedOfUnsettledRefund`, SSL-R1).
 *
 * **Orden de candados:** envíos (`FOR UPDATE`, id asc.) → piezas (id asc.) → `Order` → libro. El mismo que el
 * preparado (§M4-SHIP.5) ⇒ M3, preparado y webhook se serializan sin interbloqueo. **Dos excepciones** (techlead C-2,
 * 2026-10-04), ambas en la rama DIRECTO:
 *  1. **(4-bis, SRF-11 — aceptada por el arquitecto):** tras `Order FOR UPDATE` se bloquean los envíos que NACIERON
 *     entre el paso (1) y ese candado. Es segura porque el único que crea un envío de la orden (el settle de un
 *     `succeeded` tardío) lo hace BAJO el candado de `Order`, que ya es nuestro: cuando lo vemos, su creador confirmó y
 *     nadie más puede tenerlo bloqueado esperando `Order`.
 *  2. **(M3 directo):** M3 tx1 (`order-refund.service.ts`) toma envíos → `Order` y DESPUÉS llama a `onFullRefund`, cuyo
 *     `lockReservedOfOrder` bloquea piezas `reserved` por la orden ⇒ piezas DESPUÉS de `Order`. En una orden `settled`
 *     la consulta no devuelve filas (no bloquea nada); solo con la anomalía sembrada de SRF-11 (liquidada con una pieza
 *     aún `reserved`) bloquearía, y podría interbloquear (`40P01`) con quien tome pieza → `Order`. ⚠ NO MEDIDA como
 *     carrera; anotada para el arquitecto en BACKEND_NOTES §21.
 */
import { Injectable, Logger } from '@nestjs/common';
import { OrderStatus, Prisma, ShippedRefundReason } from '@prisma/client';
import { CurrentPiece, currentPiecesOf, resolveOriginsBatch } from './origin';
import { isSettleableOrderStatus } from '../settleable-order-statuses';
import { lockReservedOfOrder, releaseReservedOfUnsettledRefund, reservedIdsOfOrder } from './release-unsettled-refund';
import { isShippedOut, lockShipmentsOfOrder, SHIPPED_OUT_STATUSES } from './refund-review';

export type FullRefundTrigger = 'm3' | 'charge_refunded' | 'unprepared' | 'reclaim';
export type FullRefundTarget = { orderId: string } | { shipmentRequestId: string };

export interface FullRefundOpts {
  /** `unprepare`: acota la pasada a estas piezas (no toma otros retiros). */
  onlyItemIds?: string[];
  /** SOLO `reclaim-vault`: «saqué de su caja las cartas de retiros preparados o con guía». */
  unpackedConfirmed?: boolean;
  /** SOLO `reclaim-vault` (v1.80.6, SEC-SHIP-B12): acota `unpackedConfirmed` a estas piezas. */
  unpackedItemIds?: string[];
  /**
   * 💰 v1.80.8.6 (§M4-SHIP.18.12 (2)/(4)) — SOLO M3 `refund` (`requestFullRefund`, `C-FULLREF-1`): el motivo cerrado de un
   * reembolso total con el envío propio ya `enviado|entregado`, que la tx1 ya validó bajo el mismo candado. Se escribe
   * con el sello (primera pasada).
   */
  shippedReason?: { reason: ShippedRefundReason; note: string | null; byUserId: string };
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
  /**
   * 🔒💰 v1.80.8.3 — el `Order.status` leído bajo el `FOR UPDATE` de la pasada (`null` en la rama retiro, que no toma
   * la fila `Order`). `onChargeRefunded` decide con él la variante `vault` de `AV-3` (solo `settled`).
   */
  orderStatusUnderLock: OrderStatus | null;
  /**
   * 💰 v1.80.8.6 (§M4-SHIP.18.12 (2)) — ∃ envío propio de la orden en `enviado|entregado`, leído BAJO su candado en esta
   * pasada (`false` en bóveda y retiro). Lo congelado es `Order.fullRefundAfterShipment` (primera pasada).
   */
  afterShipment: boolean;
  /** 💰 v1.80.8.6 (§M4-SHIP.18.12 (3)) — piezas `reserved` por la orden nunca liquidada devueltas a la venta EN ESTA pasada. */
  releasedItemIds: string[];
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
      // v1.80.8.7 Q-1: el cobro de un RETIRO no tiene `Order` que marcar ⇒ ⛔ nunca motivo «tras envío».
      if (opts.shippedReason) throw new Error('onFullRefund: shippedReason only applies to an order (got a shipment target)');
      return this.closeShipmentsOnFullRefund(tx, target, trigger, actorUserId, opts);
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
        return this.closeShipmentsOnFullRefund(tx, target, trigger, actorUserId, opts);
      case 'vault':
        // P-S11-4: una orden `vault` NUNCA es «enviada» (no tiene envío propio) ⇒ ⛔ nunca motivo «tras envío».
        if (opts.shippedReason) throw new Error('onFullRefund: shippedReason does not apply to a vault order');
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
   *
   * 💰 v1.80.8.6 (§M4-SHIP.18.12 (2)/(3)) — rama DIRECTO:
   *  - (1) toma TODOS los envíos de la orden `FOR UPDATE` (id asc., cualquier estado) y lee su `status` DESPUÉS del
   *    candado ⇒ `afterShipment = ∃ isShippedOut`. (⛔ La lectura previa al candado no decide: un `→enviado` que
   *    confirma entre ella y el `FOR UPDATE` dejaría un paquete salido sin «por revisar» — SRF-9.)
   *  - (3) luego las piezas `reserved` por la orden `FOR UPDATE` (id asc.), (4) luego `Order FOR UPDATE`;
   *  - (4-bis) EXCEPCIÓN al orden de candados (aceptada por el arquitecto, SRF-11): los envíos nacidos entre (1) y (4)
   *    se bloquean DESPUÉS de `Order` y se tratan igual que los de (1) (cabecera del fichero, excepción 1);
   *  - si quien llama es M3 tx1, `Order` ya está bloqueada ANTES de entrar ⇒ (3) toma piezas después de `Order`
   *    (cabecera, excepción 2: vacía salvo anomalía; NO MEDIDA como carrera);
   *  - estado bajo candado ∈ `SETTLEABLE` (nunca liquidada) ⇒ `releaseReservedOfUnsettledRefund` (SSL-R1);
   *  - primera pasada: congela `fullRefundAfterShipment` (y, si M3 lo trae, el motivo) con el sello y escribe
   *    `order.full_refund_closed`. ⛔ Las pasadas siguientes no lo reescriben (criterio 250).
   */
  private async closeShipmentsOnFullRefund(
    tx: Tx,
    target: FullRefundTarget,
    trigger: FullRefundTrigger,
    actorUserId: string | null,
    opts: FullRefundOpts = {},
  ): Promise<FullRefundPassResult> {
    if (!('orderId' in target)) {
      const shipments = await tx.shipmentRequest.findMany({
        where: { id: target.shipmentRequestId, status: { in: ['picking', 'guia'] } },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      const ids = shipments.map((s) => s.id);
      if (ids.length > 0) {
        await tx.$queryRaw`SELECT id FROM "ShipmentRequest" WHERE id = ANY(${ids}::text[]) ORDER BY id FOR UPDATE`;
      }
      const closed: string[] = [];
      for (const id of ids) {
        if (await this.cancelShipment(tx, id, trigger, actorUserId, { shipmentRequestId: id }, [])) closed.push(id);
      }
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
        orderStatusUnderLock: null,
        afterShipment: false,
        releasedItemIds: [],
      };
    }
    const orderId = target.orderId;
    const closed: string[] = [];
    const frozen: string[] = [];
    // (1) TODOS los envíos de la orden, FOR UPDATE id asc., su estado leído DESPUÉS del candado, y (2) el CAS
    // `picking|guia → cancelado` de siempre.
    const first = await this.lockAndCloseShipments(tx, orderId, [], trigger, actorUserId, closed, frozen);
    let afterShipment = first.anyShippedOut;
    // (3) piezas `reserved` por la orden (id asc.), (4) `Order` FOR UPDATE + sello. v1.80.8.3: + `status`.
    const lockedReservedIds = await lockReservedOfOrder(tx, orderId);
    const [row] = await tx.$queryRaw<{ fullRefundClosedAt: Date | null; chargebackNeedsManual: boolean; status: OrderStatus; orderNumber: string | null }[]>`
      SELECT "fullRefundClosedAt", "chargebackNeedsManual", status, "orderNumber" FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
    // (4-bis) 💰 SRF-11 — un envío que NACIÓ entre (1) y el candado de `Order` (el settle de un `succeeded` tardío que
    // confirmó ENTERO en esa ventana: crea el envío `picking` bajo el candado de `Order`, que ahora es nuestro y ya
    // está confirmado). Sin esto la orden quedaría `refunded` con un envío vivo. Se bloquea y se cierra igual.
    // ⚠ Envíos DESPUÉS de `Order`: excepción 1 al orden de candados (cabecera del fichero), aceptada por el arquitecto.
    const late = await this.lockAndCloseShipments(tx, orderId, first.lockedIds, trigger, actorUserId, closed, frozen);
    if (late.anyShippedOut) afterShipment = true;
    // (5) SSL-R1: orden NUNCA liquidada ⇒ sus piezas apartadas vuelven a la venta en esta misma tx.
    const releasedItemIds = isSettleableOrderStatus(row.status)
      ? await releaseReservedOfUnsettledRefund(tx, orderId, trigger, actorUserId, { lockedReservedIds, orderNumber: row.orderNumber })
      : [];
    const sealedNow = row.fullRefundClosedAt === null;
    if (opts.shippedReason && (!sealedNow || !afterShipment)) {
      // Invariante: M3 decidió «enviado» bajo el MISMO candado y sobre una orden `settled` sin sello.
      throw new Error(`onFullRefund: shippedReason for order ${orderId} but afterShipment=${afterShipment}, sealedNow=${sealedNow}`);
    }
    let needsManual = row.chargebackNeedsManual;
    if (closed.length > 0) needsManual = true;
    const now = new Date();
    await tx.order.updateMany({
      where: { id: orderId },
      data: {
        ...(closed.length > 0 ? { chargebackNeedsManual: true } : {}),
        ...(sealedNow ? { fullRefundClosedAt: now, fullRefundAfterShipment: afterShipment } : {}),
        ...(sealedNow && afterShipment && opts.shippedReason
          ? {
              shippedRefundReason: opts.shippedReason.reason,
              shippedRefundNote: opts.shippedReason.note,
              shippedRefundReasonAt: now,
              shippedRefundReasonByUserId: opts.shippedReason.byUserId,
            }
          : {}),
      },
    });
    if (sealedNow) {
      await tx.auditLog.create({
        data: {
          actorUserId,
          actorRole: null,
          action: 'order.full_refund_closed',
          entityType: 'Order',
          entityId: orderId,
          after: {
            trigger,
            statusAtClose: row.status,
            closedShipmentIds: closed,
            frozenItemIds: frozen,
            afterShipment,
            shippedReason: opts.shippedReason?.reason ?? null,
            releasedItemIds,
          },
        },
      });
    }
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
      orderStatusUnderLock: row.status,
      afterShipment,
      releasedItemIds,
    };
  }

  /**
   * Rama directo, pasos (1)+(2) y (4-bis) — un solo cuerpo (techlead D-1, 2026-10-04): bloquea los envíos de la orden
   * salvo `exceptIds` (`lockShipmentsOfOrder`), anota si alguno ya salió (`isShippedOut`, leído BAJO el candado) y
   * cancela por CAS los `picking|guia` (acumula en `closed`/`frozen`).
   */
  private async lockAndCloseShipments(
    tx: Tx,
    orderId: string,
    exceptIds: readonly string[],
    trigger: FullRefundTrigger,
    actorUserId: string | null,
    closed: string[],
    frozen: string[],
  ): Promise<{ lockedIds: string[]; anyShippedOut: boolean }> {
    const locked = await lockShipmentsOfOrder(tx, orderId, exceptIds);
    const anyShippedOut = locked.some((s) => isShippedOut(s.status));
    for (const s of locked) {
      if (s.status !== 'picking' && s.status !== 'guia') continue;
      if (await this.cancelShipment(tx, s.id, trigger, actorUserId, { orderId }, frozen)) closed.push(s.id);
    }
    return { lockedIds: locked.map((s) => s.id), anyShippedOut };
  }

  /** El CAS `picking|guia → cancelado` de un envío + su bitácora; en un directo, junta sus piezas congeladas. */
  private async cancelShipment(
    tx: Tx,
    id: string,
    trigger: FullRefundTrigger,
    actorUserId: string | null,
    owner: { orderId: string } | { shipmentRequestId: string },
    frozen: string[],
  ): Promise<boolean> {
    const res = await tx.shipmentRequest.updateMany({
      where: { id, status: { in: ['picking', 'guia'] } },
      data: { status: 'cancelado' },
    });
    if (res.count !== 1) return false;
    if ('orderId' in owner) {
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
          ...owner,
          frozenItemIds: 'orderId' in owner ? frozen : [],
        },
      },
    });
    return true;
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
    // (c) piezas FOR UPDATE, id asc. 💰 v1.80.8.6: + las `reserved` POR la orden (§M4-SHIP.18.12 (3)), en el MISMO
    // candado (un solo `ORDER BY id`: dos sentencias romperían el orden global de piezas).
    const reservedBefore = await reservedIdsOfOrder(tx, orderId);
    const lockIds = [...new Set([...pieceIds, ...reservedBefore])].sort();
    if (lockIds.length > 0) {
      await tx.$queryRaw`SELECT id FROM "InventoryItem" WHERE id = ANY(${lockIds}::text[]) ORDER BY id FOR UPDATE`;
    }
    // Bajo el candado: las que SIGUEN `reserved` por la orden y bloqueamos (una nueva fuera del candado no se toca).
    const lockedSet = new Set(lockIds);
    const lockedReservedIds = (await reservedIdsOfOrder(tx, orderId)).filter((id) => lockedSet.has(id));
    // (d) Order FOR UPDATE + sello. v1.80.8.3: + `status` (`orderStatusUnderLock`, `statusAtClose`).
    const [head] = await tx.$queryRaw<{ fullRefundClosedAt: Date | null; chargebackNeedsManual: boolean; status: OrderStatus }[]>`
      SELECT "fullRefundClosedAt", "chargebackNeedsManual", status FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
    const firstPass = head.fullRefundClosedAt === null;
    // (d-bis) 💰 SSL-R1: orden NUNCA liquidada ⇒ sus piezas apartadas vuelven a la venta en esta misma tx.
    const releasedItemIds = isSettleableOrderStatus(head.status)
      ? await releaseReservedOfUnsettledRefund(tx, orderId, trigger, actorUserId, { lockedReservedIds, orderNumber: order.orderNumber })
      : [];
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
      // 🔒💰 v1.80.8.3 (§M4-SHIP.18.2, tabla del sello): solo una orden que fue LIQUIDADA alguna vez (estado bajo
      // candado ∉ SETTLEABLE: `settled`/`chargeback`/`refunded`) tiene algo físico que confirmar. Una nunca liquidada
      // (`pending`/`failed`) no tuvo custodia ni colocación, y `chargeback-inventory` no tendría verbo que bajara el
      // flag (`409 no frozen piece`) ⇒ un falso pendiente perpetuo.
      if (order.items.length > 0 && !isSettleableOrderStatus(head.status)) needsManual = true;
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
          after: {
            trigger,
            returnedItemIds: reclaimedNow,
            untouched,
            placementCancelled: placement.count === 1,
            statusAtClose: head.status,
            // 💰 v1.80.8.6 (§M4-SHIP.18.12 (2)): bóveda ⛔ nunca «enviada» (P-S11-4).
            afterShipment: false,
            shippedReason: null,
            releasedItemIds,
          },
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
          after: { trigger, returnedItemIds: reclaimedNow, untouched, unpackedConfirmed: opts.unpackedConfirmed === true, inventoryItemIds: opts.unpackedItemIds ?? null },
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
      orderStatusUnderLock: head.status,
      afterShipment: false,
      releasedItemIds,
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
      // 🔒 v1.80.6 (M6, PS-61): `returned` ⇔ hay un `refund_return` ≥ sello — y se QUEDA aunque después la pieza cambie
      // de estado (`recuperada` ⇒ listed sin movimiento; `no_recuperada` ⇒ lost con movimiento). `pendingConfirmation`
      // (⇔ sigue `picking` ∧ needsManual) es lo que dice si aún hay algo que confirmar. ⛔ Nada de «último movimiento».
      out.add(id);
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
        where: { inventoryItemId: { in: pieceIds }, shipmentRequest: { status: { in: [...SHIPPED_OUT_STATUSES] } } },
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
