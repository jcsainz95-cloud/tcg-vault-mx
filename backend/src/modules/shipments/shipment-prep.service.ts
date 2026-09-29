/**
 * §M4-SHIP.3/.5/.6/.11 (v1.80 → v1.80.6) — «Pedidos por preparar», cubeta ENVÍO: la vista interactiva, los
 * TRES verbos (palomear, dar por preparado, deshacer preparado), las guardas de la guía/enviado, el
 * contador derivado y las proyecciones de identidad (§M4-SHIP.10).
 *
 * Puerta de cada verbo: el CANDADO DE LA FILA `ShipmentRequest` (`SELECT … FOR UPDATE`, primera sentencia de
 * la tx). Orden de candados normativo: envío → piezas (id asc.) → órdenes (id asc.) → libro.
 *
 * 💰 El importe lo calcula el SERVIDOR (`common/money.ts`); `expectedRefundCents` es la CONFIRMACIÓN de lo
 * que el operador vio (CA #16): distinto ⇒ `409 REFUND_PREVIEW_STALE`, cero escrituras.
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  InventoryStatus,
  MissingReason,
  NameSource,
  OrderStatus,
  PaymentRefund,
  PreparationItemStatus,
  Prisma,
  ReplacementCaseStatus,
  Role,
  ShipmentStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import {
  itemMissingRefundComponents,
  ivaIsIncluded,
  orderRemainingRefundComponents,
  shipmentFeeRefundComponents,
} from '../../common/money';
import { MAIL_PORT, MailPort } from '../mail/mail.port';
import { SettingsService } from '../settings/settings.service';
import { OriginRef, resolveDirectOriginsBatch, resolveOriginsBatch } from '../payments/refunds/origin';
import { FullRefundService } from '../payments/refunds/full-refund.service';
import {
  NON_FAILED,
  NewRefundRow,
  PaymentRefundDTO,
  RefundActor,
  RefundLedgerService,
} from '../payments/refunds/refund-ledger.service';
import { replacementPendingTemplate } from '../payments/refunds/mail/refund-notice.templates';
import { customerDisplayName } from '../vault/customer-display-name';
import { LocationView, lastNameOf, locationViewOf, nullIfBlank, preparationCardOf, PreparationCardDTO } from './preparation-view';
import { REPLACEMENT_CASE_DUE_MS } from '../vault/replacement-case.rules';

type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaService;

export type ShipmentKind = 'vault_withdrawal' | 'guest_direct_ship';

export interface ReplacementCaseRefDTO {
  id: string;
  status: ReplacementCaseStatus;
  missingReason: MissingReason;
  openedAt: string;
  resolvedAt: string | null;
  replacement: { inventoryItemId: string; folio: string } | null;
}

export type LineAvailability =
  | { kind: 'available' }
  | { kind: 'blocked'; reason: 'piece_not_available'; pieceStatus: InventoryStatus };

export type LineRefund =
  | { kind: 'refundable'; amountCents: number }
  | { kind: 'refunded'; refund: PaymentRefundDTO }
  | { kind: 'not_refundable'; reason: 'order_not_settled' | 'legacy_convention' | 'no_origin_order' }
  | { kind: 'to_replacement' }
  | { kind: 'replacement'; case: ReplacementCaseRefDTO };

export interface ShipPreparationItemDTO {
  shipmentItemId: string;
  inventoryItemId: string;
  folio: string;
  quantity: number;
  card: PreparationCardDTO;
  currentLocation: LocationView;
  prepStatus: PreparationItemStatus;
  missingReason: MissingReason | null;
  prepMarkedBy: { userId: string; name: string | null } | null;
  availability: LineAvailability;
  refund: LineRefund;
}

interface Counts {
  total: number;
  pending: number;
  picked: number;
  missing: number;
  blocked: number;
}

export type ShipPreparationStateDTO =
  | ({ status: 'in_progress'; refundPreviewCents: number } & Counts)
  | ({ status: 'prepared'; preparedAt: string; preparedBy: { userId: string; name: string | null } } & Counts & {
      openReplacements: number;
    });

export interface CustomerRefDTO {
  userId: string;
  fullName: string | null;
  email: string;
}

/** La línea con todo lo que los verbos deciden (interno; la DTO es `ShipPreparationItemDTO`). */
interface PrepLine {
  dto: ShipPreparationItemDTO;
  shipmentItemId: string;
  inventoryItemId: string;
  prepStatus: PreparationItemStatus;
  missingReason: MissingReason | null;
  available: boolean;
  pieceStatus: InventoryStatus;
  refundRow: PaymentRefund | null;
  caseRow: { id: string; status: ReplacementCaseStatus } | null;
  origin: OriginRef | null;
  unitPriceCents: number | null;
  cardName: string;
  setName: string | null;
}

export interface PrepView {
  shipment: Prisma.ShipmentRequestGetPayload<{ include: { order: true } }>;
  kind: ShipmentKind;
  lines: PrepLine[];
  items: ShipPreparationItemDTO[];
  preparation: ShipPreparationStateDTO;
  openCaseIds: string[];
  /** Plan de reembolso vigente (lo que `prepared` aceptaría ahora). */
  plan: { rows: NewRefundRow[]; cents: number; closes: boolean; notRefundable: { shipmentItemId: string; reason: string }[] };
}

export const SHIP_PREP_INCLUDE = {
  order: { include: { user: { select: { id: true, name: true, nameSource: true, email: true } } } },
  user: { select: { id: true, name: true, nameSource: true, email: true } },
  items: {
    include: { inventoryItem: { include: { card: { include: { set: true } }, location: true } } },
  },
} satisfies Prisma.ShipmentRequestInclude;
type ShipRow = Prisma.ShipmentRequestGetPayload<{ include: typeof SHIP_PREP_INCLUDE }>;

@Injectable()
export class ShipmentPrepService {
  private readonly logger = new Logger(ShipmentPrepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: RefundLedgerService,
    private readonly fullRefund: FullRefundService,
    private readonly settings: SettingsService,
    @Optional() @Inject(MAIL_PORT) private readonly mail?: MailPort,
  ) {}

  // ================================================================ lecturas comunes

  kindOf(s: { orderId: string | null; order: { fulfillmentMode: string } | null }): ShipmentKind {
    if (s.orderId == null) return 'vault_withdrawal';
    if (s.order?.fulfillmentMode === 'direct_ship') return 'guest_direct_ship';
    this.logger.error(`ShipmentRequest con orderId y orden '${s.order?.fulfillmentMode ?? 'INEXISTENTE'}': corrupción.`);
    throw BusinessException.conflict('CONFLICT', 'Unsupported fulfillmentMode for shipment');
  }

  /** §M4-SHIP.3 «Disponibilidad de la carta», un cuerpo. */
  static isAvailable(kind: ShipmentKind, shipmentUserId: string | null, p: { status: string; ownerType: string; ownerUserId: string | null; ownershipStatus: string | null }): boolean {
    if (kind === 'guest_direct_ship') return p.status === 'picking' && p.ownerType === 'platform';
    return p.status === 'in_custody' && p.ownerType === 'customer' && p.ownerUserId === shipmentUserId && p.ownershipStatus === 'settled';
  }

  /**
   * §M4-SHIP.3 «Fuente del cliente» (corrige H13): `userIdComprador = ShipmentRequest.userId ?? Order.userId`.
   * Con cuenta ⇒ `customerDisplayName(User)` (`derived` ⇒ `null`) y `User.email`; invitado ⇒
   * `shipTo.recipientName` y `Order.guestEmail`, `userId` null. ⛔ Nunca cascada de una fuente a otra. Lee las
   * relaciones YA incluidas (sin consulta extra).
   */
  customerOf(s: {
    userId: string | null;
    user?: { name: string; nameSource?: NameSource | null; email?: string } | null;
    order: { userId: string | null; guestEmail: string | null; user?: { name: string; nameSource?: NameSource | null; email?: string } | null } | null;
    addressSnapshot: Prisma.JsonValue;
  }): { userId: string | null; email: string | null; lastName: string | null; fullName: string | null } {
    const buyerId = s.userId ?? s.order?.userId ?? null;
    if (buyerId) {
      const u = s.userId ? s.user : s.order?.user;
      const fullName = u ? customerDisplayName(u) : null;
      return { userId: buyerId, email: u?.email ?? null, lastName: lastNameOf(fullName), fullName };
    }
    const snap = (s.addressSnapshot ?? {}) as { recipientName?: string };
    const fullName = nullIfBlank(snap.recipientName ?? null);
    return { userId: null, email: s.order?.guestEmail ?? null, lastName: lastNameOf(fullName), fullName };
  }

  async customerRefOf(db: Db, s: { userId: string | null; order: { userId: string | null } | null }): Promise<CustomerRefDTO | null> {
    const buyerId = s.userId ?? s.order?.userId ?? null;
    if (!buyerId) return null;
    const u = await db.user.findUnique({ where: { id: buyerId }, select: { email: true, name: true, nameSource: true } });
    if (!u) return null;
    return { userId: buyerId, fullName: customerDisplayName(u), email: u.email };
  }

  refundDtos(rows: PaymentRefund[]): Promise<PaymentRefundDTO[]> {
    return this.ledger.toDtos(rows);
  }

  async loadRow(db: Db, shipmentId: string): Promise<ShipRow | null> {
    // PROJECTION-EXEMPT: fila INTERNA de la vista; `buildView`/`shipmentSummary` proyectan antes de responder.
    return db.shipmentRequest.findUnique({ where: { id: shipmentId }, include: SHIP_PREP_INCLUDE });
  }

  /**
   * LA VISTA: líneas con disponibilidad, marca, fila del libro, caso y origen; conteos; y el PLAN de reembolso
   * (exactamente lo que `prepared` aceptaría ahora ⇒ `refundPreviewCents`). Sin N+1: una consulta por fuente.
   */
  async buildView(db: Db, row: ShipRow): Promise<PrepView> {
    const kind = this.kindOf(row);
    const shipmentItemIds = row.items.map((i) => i.id);
    const pieceIds = row.items.map((i) => i.inventoryItemId);
    const [refundRows, cases, origins, markers] = await Promise.all([
      db.paymentRefund.findMany({ where: { shipmentItemId: { in: shipmentItemIds } } }),
      db.replacementCase.findMany({
        where: { shipmentItemId: { in: shipmentItemIds } },
        select: {
          id: true,
          status: true,
          shipmentItemId: true,
          missingReason: true,
          openedAt: true,
          resolvedAt: true,
          replacementInventoryItem: { select: { id: true, folio: true } },
        },
      }),
      kind === 'guest_direct_ship'
        ? resolveDirectOriginsBatch(db, row.orderId as string, pieceIds)
        : resolveOriginsBatch(db, row.userId as string, pieceIds),
      (async () => {
        const ids = [...new Set(row.items.map((i) => i.prepMarkedByUserId).filter((x): x is string => !!x))];
        if (ids.length === 0) return new Map<string, string | null>();
        const us = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
        return new Map(us.map((u) => [u.id, nullIfBlank(u.name)]));
      })(),
    ]);
    const refundDtos = await this.ledger.toDtos(refundRows);
    const refundByLine = new Map(refundRows.map((r, i) => [r.shipmentItemId as string, { row: r, dto: refundDtos[i] }]));
    const caseByLine = new Map(cases.map((c) => [c.shipmentItemId as string, c]));
    const order = row.order;
    const lines: PrepLine[] = row.items.map((si) => {
      const p = si.inventoryItem;
      const available = ShipmentPrepService.isAvailable(kind, row.userId, p);
      const rf = refundByLine.get(si.id) ?? null;
      const cs = caseByLine.get(si.id) ?? null;
      const origin = origins.get(si.inventoryItemId) ?? null;
      let refund: LineRefund;
      if (kind === 'vault_withdrawal') {
        refund = cs
          ? {
              kind: 'replacement',
              case: {
                id: cs.id,
                status: cs.status,
                missingReason: cs.missingReason,
                openedAt: cs.openedAt.toISOString(),
                resolvedAt: cs.resolvedAt ? cs.resolvedAt.toISOString() : null,
                replacement: cs.replacementInventoryItem ? { inventoryItemId: cs.replacementInventoryItem.id, folio: cs.replacementInventoryItem.folio } : null,
              },
            }
          : { kind: 'to_replacement' };
      } else if (rf) {
        refund = { kind: 'refunded', refund: rf.dto };
      } else if (!origin || !order) {
        refund = { kind: 'not_refundable', reason: 'no_origin_order' };
      } else if (!ivaIsIncluded(order.priceConvention)) {
        refund = { kind: 'not_refundable', reason: 'legacy_convention' };
      } else if (order.status !== 'settled') {
        refund = { kind: 'not_refundable', reason: 'order_not_settled' };
      } else {
        refund = { kind: 'refundable', amountCents: itemMissingRefundComponents(order, origin.unitPriceCents).amountCents };
      }
      const dto: ShipPreparationItemDTO = {
        shipmentItemId: si.id,
        inventoryItemId: si.inventoryItemId,
        folio: p.folio,
        quantity: 1,
        card: preparationCardOf(p),
        currentLocation: locationViewOf(p.location),
        prepStatus: si.prepStatus,
        missingReason: si.missingReason,
        prepMarkedBy: si.prepMarkedByUserId ? { userId: si.prepMarkedByUserId, name: markers.get(si.prepMarkedByUserId) ?? null } : null,
        availability: available ? { kind: 'available' } : { kind: 'blocked', reason: 'piece_not_available', pieceStatus: p.status },
        refund,
      };
      return {
        dto,
        shipmentItemId: si.id,
        inventoryItemId: si.inventoryItemId,
        prepStatus: si.prepStatus,
        missingReason: si.missingReason,
        available,
        pieceStatus: p.status,
        refundRow: rf?.row ?? null,
        caseRow: cs ? { id: cs.id, status: cs.status } : null,
        origin,
        unitPriceCents: origin?.unitPriceCents ?? null,
        cardName: p.card.name,
        setName: p.card.set?.name ?? null,
      };
    });
    // Los conteos: la DISPONIBILIDAD manda sobre la marca (§M4-SHIP.18.4, PS-63/PS-66): una línea `picked` cuya pieza
    // fue reclamada por un reembolso total cuenta `blocked` (no va a salir), ⛔ no `picked`. La marca se conserva.
    const counts: Counts = { total: lines.length, pending: 0, picked: 0, missing: 0, blocked: 0 };
    for (const l of lines) {
      if (!l.available && l.prepStatus !== 'missing') counts.blocked += 1;
      else if (l.prepStatus === 'picked') counts.picked += 1;
      else if (l.prepStatus === 'missing') counts.missing += 1;
      else counts.pending += 1;
    }
    const openCaseIds = cases.filter((c) => c.status === 'open').map((c) => c.id);
    const plan = await this.planOf(db, row, kind, lines, openCaseIds.length);
    const preparedBy = row.preparedByUserId
      ? { userId: row.preparedByUserId, name: (await db.user.findUnique({ where: { id: row.preparedByUserId }, select: { name: true } }))?.name ?? null }
      : null;
    const preparation: ShipPreparationStateDTO =
      row.preparedAt && preparedBy
        ? { status: 'prepared', preparedAt: row.preparedAt.toISOString(), preparedBy: { userId: preparedBy.userId, name: nullIfBlank(preparedBy.name) }, ...counts, openReplacements: openCaseIds.length }
        : { status: 'in_progress', refundPreviewCents: plan.cents, ...counts };
    return { shipment: row, kind, lines, items: lines.map((l) => l.dto), preparation, openCaseIds, plan };
  }

  /**
   * §M4-SHIP.5 paso 5 — EL PLAN: directo ⇒ `item_missing` por cada `missing` disponible sin fila; cierre
   * (`order_remaining`) si tras el acto ninguna línea queda `picked` y TODA `OrderItem` queda reembolsada.
   * Retiro ⇒ las faltantes abren caso (⛔ cero filas); cierre (`shipment_fee`) SOLO si ninguna línea queda
   * `picked` porque todas están `blocked` con origen no `settled` (o con caso ya cerrado) y no hay caso `open`
   * (v1.80.6, SEC-SHIP-M7).
   */
  private async planOf(db: Db, row: ShipRow, kind: ShipmentKind, lines: PrepLine[], openCases: number) {
    const rows: NewRefundRow[] = [];
    const notRefundable: { shipmentItemId: string; reason: string }[] = [];
    const order = row.order;
    const blockedAcceptable = (l: PrepLine) =>
      !l.available && (l.refundRow !== null || l.caseRow !== null || l.origin === null || l.origin.orderStatus !== 'settled');
    if (kind === 'guest_direct_ship' && order) {
      for (const l of lines) {
        if (l.prepStatus !== 'missing' || !l.available || l.refundRow) continue;
        if (!l.origin) notRefundable.push({ shipmentItemId: l.shipmentItemId, reason: 'no_origin_order' });
        else if (!ivaIsIncluded(order.priceConvention)) notRefundable.push({ shipmentItemId: l.shipmentItemId, reason: 'legacy_convention' });
        else if (order.status !== 'settled') notRefundable.push({ shipmentItemId: l.shipmentItemId, reason: 'order_not_settled' });
        else {
          rows.push({
            idempotencyKey: `item:${l.shipmentItemId}`,
            kind: 'item_missing',
            orderId: order.id,
            orderItemId: l.origin.orderItemId,
            shipmentItemId: l.shipmentItemId,
            missingReason: l.missingReason,
            components: itemMissingRefundComponents(order, l.origin.unitPriceCents),
          });
        }
      }
      const nonePicked = lines.every((l) => l.prepStatus === 'missing' || blockedAcceptable(l) || (!l.available && l.prepStatus !== 'picked'));
      const anyPickedAvailable = lines.some((l) => l.prepStatus === 'picked' && l.available);
      const closes = lines.length > 0 && nonePicked && !anyPickedAvailable;
      let cents = rows.reduce((a, r) => a + r.components.amountCents, 0);
      if (closes && order.status === 'settled' && ivaIsIncluded(order.priceConvention)) {
        const existing = await db.paymentRefund.findMany({ where: { orderId: order.id, ...NON_FAILED } });
        const orderItems = await db.orderItem.findMany({ where: { orderId: order.id }, select: { id: true } });
        const coveredIds = new Set([
          ...existing.filter((r) => r.kind === 'item_missing').map((r) => r.orderItemId as string),
          ...rows.map((r) => r.orderItemId as string),
        ]);
        const allCovered = orderItems.every((oi) => coveredIds.has(oi.id));
        const alreadyRemaining = existing.some((r) => r.kind === 'order_remaining' || r.kind === 'order_full');
        if (allCovered && !alreadyRemaining) {
          const comp = orderRemainingRefundComponents(order, [...existing, ...rows.map((r) => r.components)]);
          if (comp.amountCents > 0) {
            rows.push({ idempotencyKey: `order-rest:${order.id}`, kind: 'order_remaining', orderId: order.id, components: comp });
            cents += comp.amountCents;
          }
        }
      }
      return { rows, cents, closes, notRefundable };
    }
    // retiro
    const anyPickedAvailable = lines.some((l) => l.prepStatus === 'picked' && l.available);
    const newCases = lines.filter((l) => l.prepStatus === 'missing' && l.available && !l.caseRow).length;
    const nothingToShip =
      lines.length > 0 &&
      !anyPickedAvailable &&
      newCases === 0 &&
      openCases === 0 &&
      lines.every((l) => blockedAcceptable(l) || (l.caseRow !== null && l.caseRow.status !== 'open'));
    let cents = 0;
    if (nothingToShip && row.totalCents > 0) {
      const existing = await db.paymentRefund.findMany({ where: { shipmentRequestId: row.id, ...NON_FAILED } });
      if (existing.length === 0) {
        const comp = shipmentFeeRefundComponents(row);
        rows.push({ idempotencyKey: `ship-fee:${row.id}`, kind: 'shipment_fee', shipmentRequestId: row.id, components: comp });
        cents = comp.amountCents;
      }
    }
    return { rows, cents, closes: nothingToShip, notRefundable };
  }

  private async lockShipment(tx: Tx, id: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM "ShipmentRequest" WHERE id = ${id} FOR UPDATE`;
  }

  private notInPreparation(status: ShipmentStatus): BusinessException {
    return BusinessException.conflict('SHIPMENT_NOT_IN_PREPARATION', 'Shipment is not in preparation', { status });
  }

  // ================================================================ PATCH …/prep-items/:id (§M4-SHIP.5)

  async markItem(shipmentId: string, shipmentItemId: string, body: unknown, actor: RefundActor) {
    const b = (body ?? {}) as { status?: unknown; missingReason?: unknown };
    const allowed = Object.values(PreparationItemStatus) as string[];
    if (typeof b.status !== 'string' || !allowed.includes(b.status)) {
      throw BusinessException.badRequest('VALIDATION_ERROR', 'invalid preparation status', { field: 'status', allowed });
    }
    const target = b.status as PreparationItemStatus;
    const reasons = Object.values(MissingReason) as string[];
    if (target === 'missing') {
      if (typeof b.missingReason !== 'string' || !reasons.includes(b.missingReason)) {
        throw BusinessException.badRequest('VALIDATION_ERROR', 'missingReason is required with status=missing', { field: 'missingReason', allowed: reasons });
      }
    } else if (b.missingReason !== undefined && b.missingReason !== null) {
      throw BusinessException.badRequest('VALIDATION_ERROR', 'missingReason only applies to status=missing', { field: 'missingReason' });
    }
    const targetReason = target === 'missing' ? (b.missingReason as MissingReason) : null;
    const head = await this.prisma.shipmentRequest.findUnique({ where: { id: shipmentId }, select: { id: true } });
    const line = head ? await this.prisma.shipmentItem.findUnique({ where: { id: shipmentItemId } }) : null;
    if (!head || !line || line.shipmentRequestId !== shipmentId) throw BusinessException.notFound();
    return this.prisma.$transaction(
      async (tx) => {
        await this.lockShipment(tx, shipmentId);
        const row = await this.loadRow(tx, shipmentId);
        if (!row) throw BusinessException.notFound();
        if (row.status !== 'picking') throw this.notInPreparation(row.status);
        if (row.preparedAt) {
          throw BusinessException.conflict('PREPARATION_CLOSED', 'Preparation is closed', { preparedAt: row.preparedAt.toISOString() });
        }
        const view = await this.buildView(tx, row);
        const cur = view.lines.find((l) => l.shipmentItemId === shipmentItemId)!;
        if (cur.refundRow) {
          throw BusinessException.conflict('PREP_ITEM_REFUNDED', 'This line was already refunded', { refundId: cur.refundRow.id });
        }
        if (cur.caseRow) {
          throw BusinessException.conflict('PREP_ITEM_IN_REPLACEMENT', 'This line opened a replacement case', { caseId: cur.caseRow.id, status: cur.caseRow.status });
        }
        if (target !== 'pending' && !cur.available) {
          throw BusinessException.conflict('PREP_ITEM_BLOCKED', 'Piece is not available', { reason: 'piece_not_available', pieceStatus: cur.pieceStatus });
        }
        if (cur.prepStatus === target && cur.missingReason === targetReason) {
          return { changed: false, item: cur.dto, preparation: view.preparation };
        }
        const now = new Date();
        const data =
          target === 'pending'
            ? { prepStatus: target, prepMarkedAt: null, prepMarkedByUserId: null, missingReason: null }
            : { prepStatus: target, prepMarkedAt: now, prepMarkedByUserId: actor.id, missingReason: targetReason };
        const res = await tx.shipmentItem.updateMany({
          where: { id: shipmentItemId, prepStatus: cur.prepStatus, missingReason: cur.missingReason },
          data,
        });
        if (res.count !== 1) throw BusinessException.conflict('CONFLICT', 'Preparation mark changed concurrently');
        if (target === 'missing' || cur.prepStatus === 'missing') {
          await tx.auditLog.create({
            data: {
              actorUserId: actor.id,
              actorRole: actor.role,
              action: target === 'missing' ? 'shipment.item_missing' : 'shipment.item_missing_cleared',
              entityType: 'ShipmentRequest',
              entityId: shipmentId,
              after: { shipmentItemId, inventoryItemId: cur.inventoryItemId, folio: cur.dto.folio, missingReason: targetReason },
            },
          });
        }
        const after = await this.buildView(tx, (await this.loadRow(tx, shipmentId))!);
        return { changed: true, item: after.items.find((i) => i.shipmentItemId === shipmentItemId)!, preparation: after.preparation };
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
  }

  // ================================================================ POST …/prepared (§M4-SHIP.5)

  async prepare(shipmentId: string, body: unknown, actor: RefundActor) {
    const expected = (body as { expectedRefundCents?: unknown } | null)?.expectedRefundCents;
    if (typeof expected !== 'number' || !Number.isInteger(expected) || expected < 0) {
      throw BusinessException.badRequest('VALIDATION_ERROR', 'expectedRefundCents must be an integer >= 0', { field: 'expectedRefundCents' });
    }
    const head = await this.loadRow(this.prisma, shipmentId);
    if (!head) throw BusinessException.notFound();
    this.kindOf(head);
    let limitBlocked: { capCents: number; usedCents: number; requestedCents: number } | null = null;
    let result: {
      outcome: 'prepared' | 'closed_nothing_to_ship' | 'already_prepared';
      refundIds: string[];
      caseIds: string[];
      shipmentId: string;
    };
    try {
      result = await this.prisma.$transaction(
        async (tx) => {
          await this.lockShipment(tx, shipmentId);
          const row = (await this.loadRow(tx, shipmentId))!;
          if (row.status !== 'picking') throw this.notInPreparation(row.status);
          if (row.preparedAt) return { outcome: 'already_prepared' as const, refundIds: [], caseIds: [], shipmentId };
          const view = await this.buildView(tx, row);
          const { kind, lines } = view;
          if (view.preparation.status === 'in_progress' && view.preparation.pending > 0) {
            throw BusinessException.conflict('PREPARATION_INCOMPLETE', 'Preparation is incomplete', { pendingCount: view.preparation.pending });
          }
          // SEC-SHIP-A1 (c): bloqueadas con origen SETTLED ⇒ violación de invariante. Una línea ya reembolsada o con
          // caso NO es «bloqueada sin desenlace»: su dinero lo resolvió su propia fila / su caso.
          const badBlocked = lines.filter((l) => !l.available && !l.refundRow && !l.caseRow && l.origin && l.origin.orderStatus === 'settled');
          if (badBlocked.length > 0) {
            this.logger.error(`prepared ${shipmentId}: líneas bloqueadas con orden de origen settled: ${badBlocked.map((l) => l.shipmentItemId).join(',')}`);
            throw BusinessException.conflict('PREPARATION_HAS_BLOCKED_LINES', 'Blocked lines with a settled origin', {
              lines: badBlocked.map((l) => ({ shipmentItemId: l.shipmentItemId, pieceStatus: l.pieceStatus, originOrderId: l.origin!.orderId })),
            });
          }
          if (view.plan.notRefundable.length > 0) {
            throw BusinessException.conflict('REFUND_NOT_AVAILABLE', 'Some lines cannot be refunded here', { lines: view.plan.notRefundable });
          }
          const planCents = view.plan.cents;
          // Tope (solo operador), bajo su puerta.
          try {
            await this.ledger.assertOperatorCap(tx, actor, planCents);
          } catch (e) {
            if (e instanceof BusinessException && e.code === 'MONEY_OUT_LIMIT_EXCEEDED') limitBlocked = e.details as typeof limitBlocked;
            throw e;
          }
          if (expected !== planCents) {
            throw BusinessException.conflict('REFUND_PREVIEW_STALE', 'The confirmed amount is stale', { refundCents: planCents });
          }
          const now = new Date();
          // Piezas (id asc.), CAS con la disponibilidad en el WHERE.
          const missingNew = lines
            .filter((l) => l.prepStatus === 'missing' && l.available && (kind === 'guest_direct_ship' ? !l.refundRow : !l.caseRow))
            .sort((a, b) => (a.inventoryItemId < b.inventoryItemId ? -1 : 1));
          const label = kind === 'guest_direct_ship' ? (row.order?.orderNumber ?? row.orderId) : `retiro ${row.id}`;
          for (const l of missingNew) {
            const to: InventoryStatus = l.missingReason === 'damaged' ? 'damaged' : 'lost';
            const where: Prisma.InventoryItemWhereInput =
              kind === 'guest_direct_ship'
                ? { id: l.inventoryItemId, status: 'picking', ownerType: 'platform' }
                : { id: l.inventoryItemId, status: 'in_custody', ownerType: 'customer', ownerUserId: row.userId, ownershipStatus: 'settled' };
            const res = await tx.inventoryItem.updateMany({ where, data: { status: to } });
            if (res.count !== 1) throw BusinessException.conflict('CONFLICT', 'A piece changed while preparing');
            await tx.inventoryMovement.create({
              data: {
                itemId: l.inventoryItemId,
                fromStatus: kind === 'guest_direct_ship' ? 'picking' : 'in_custody',
                toStatus: to,
                reason: to,
                actorUserId: actor.id,
                note:
                  kind === 'guest_direct_ship'
                    ? `${label} · no salió al preparar (${l.missingReason}) · reembolso item:${l.shipmentItemId}`
                    : `${label} · no salió al preparar (${l.missingReason}) · caso`,
              },
            });
          }
          // Órdenes de origen (id asc.) FOR UPDATE + guardas.
          if (kind === 'guest_direct_ship') {
            const [o] = await tx.$queryRaw<{ status: OrderStatus; totalCents: number }[]>`SELECT status, "totalCents" FROM "Order" WHERE id = ${row.orderId} FOR UPDATE`;
            if (o.status !== 'settled') {
              throw BusinessException.conflict('ORDER_NOT_SETTLED', 'The order is no longer settled', { orderStatus: o.status });
            }
            if (view.plan.rows.length > 0) {
              const existing = await tx.paymentRefund.aggregate({ where: { orderId: row.orderId as string, ...NON_FAILED }, _sum: { amountCents: true } });
              const sum = (existing._sum.amountCents ?? 0) + view.plan.rows.reduce((a, r) => a + r.components.amountCents, 0);
              if (sum > o.totalCents) {
                this.logger.error(`prepared ${shipmentId}: Σ reembolsos ${sum} > totalCents ${o.totalCents} (violación de invariante)`);
                throw BusinessException.conflict('REFUND_NOT_AVAILABLE', 'Refunds would exceed the charge', {
                  lines: view.plan.rows.filter((r) => r.shipmentItemId).map((r) => ({ shipmentItemId: r.shipmentItemId, reason: 'exceeds_charge' })),
                });
              }
            }
          } else {
            await this.assertWithdrawalOriginsSettled(tx, view);
            const fee = view.plan.rows.find((r) => r.kind === 'shipment_fee');
            if (fee) {
              const existing = await tx.paymentRefund.aggregate({ where: { shipmentRequestId: row.id, ...NON_FAILED }, _sum: { amountCents: true } });
              if ((existing._sum.amountCents ?? 0) + fee.components.amountCents > row.totalCents) {
                throw BusinessException.conflict('REFUND_NOT_AVAILABLE', 'Refunds would exceed the shipment charge', { lines: [{ shipmentItemId: null, reason: 'exceeds_charge' }] });
              }
            }
          }
          // Libro.
          let created: PaymentRefund[] = [];
          try {
            created = await this.ledger.createRows(tx, view.plan.rows, actor);
          } catch (e) {
            if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
              throw BusinessException.conflict('CONFLICT', 'A refund row already exists for this act');
            }
            throw e;
          }
          // Casos (retiro): después de las órdenes, antes del sello.
          const caseIds: string[] = [];
          const caseAudit: { shipmentItemId: string; caseId: string; missingReason: MissingReason | null }[] = [];
          if (kind === 'vault_withdrawal') {
            for (const l of missingNew) {
              try {
                const c = await tx.replacementCase.create({
                  data: {
                    source: 'withdrawal',
                    shipmentItemId: l.shipmentItemId,
                    shipmentRequestId: row.id,
                    customerUserId: row.userId as string,
                    originalInventoryItemId: l.inventoryItemId,
                    missingReason: l.missingReason as MissingReason,
                    originOrderItemId: l.origin?.orderItemId ?? null,
                    openedAt: now,
                    openedByUserId: actor.id,
                  },
                });
                caseIds.push(c.id);
                caseAudit.push({ shipmentItemId: l.shipmentItemId, caseId: c.id, missingReason: l.missingReason });
                await tx.auditLog.create({
                  data: {
                    actorUserId: actor.id,
                    actorRole: actor.role,
                    action: 'replacement_case.opened',
                    entityType: 'ReplacementCase',
                    entityId: c.id,
                    after: {
                      source: 'withdrawal',
                      customerUserId: row.userId,
                      originalInventoryItemId: l.inventoryItemId,
                      folio: l.dto.folio,
                      missingReason: l.missingReason,
                      originOrderItemId: l.origin?.orderItemId ?? null,
                    },
                  },
                });
              } catch (e) {
                if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
                  throw BusinessException.conflict('CONFLICT', 'A replacement case already exists for this line');
                }
                throw e;
              }
            }
          }
          // Sello (CAS).
          const sealed = await tx.shipmentRequest.updateMany({
            where: { id: shipmentId, status: 'picking', preparedAt: null },
            data: { preparedAt: now, preparedByUserId: actor.id },
          });
          if (sealed.count !== 1) {
            const again = await tx.shipmentRequest.findUniqueOrThrow({ where: { id: shipmentId } });
            if (again.status !== 'picking') throw this.notInPreparation(again.status);
            throw BusinessException.conflict('CONFLICT', 'Shipment changed concurrently');
          }
          // Cierre: no sale nada ⇒ `cancelado` (el único `cancelado` que escribe un operador; no es una cancelación).
          const closes = view.plan.closes;
          if (closes) {
            await tx.shipmentRequest.updateMany({ where: { id: shipmentId, status: 'picking' }, data: { status: 'cancelado' } });
          }
          await tx.auditLog.create({
            data: {
              actorUserId: actor.id,
              actorRole: actor.role,
              action: 'shipment.prepared',
              entityType: 'ShipmentRequest',
              entityId: shipmentId,
              after: {
                picked: lines.filter((l) => l.prepStatus === 'picked').map((l) => l.inventoryItemId),
                missing: missingNew.map((l) => ({
                  shipmentItemId: l.shipmentItemId,
                  missingReason: l.missingReason,
                  refundId: created.find((r) => r.shipmentItemId === l.shipmentItemId)?.id ?? null,
                  amountCents: created.find((r) => r.shipmentItemId === l.shipmentItemId)?.amountCents ?? null,
                })),
                blocked: lines.filter((l) => !l.available).map((l) => l.inventoryItemId),
                closed: closes,
                cases: caseAudit,
              },
            },
          });
          return { outcome: closes ? ('closed_nothing_to_ship' as const) : ('prepared' as const), refundIds: created.map((r) => r.id), caseIds, shipmentId };
        },
        { maxWait: 10_000, timeout: 30_000 },
      );
    } catch (e) {
      if (limitBlocked) {
        await this.prisma.auditLog.create({
          data: {
            actorUserId: actor.id,
            actorRole: actor.role,
            action: 'money_out.limit_blocked',
            entityType: 'ShipmentRequest',
            entityId: shipmentId,
            after: limitBlocked,
          },
        });
      }
      throw e;
    }
    // Post-commit: Stripe por fila + AV-12; AV-13 por casos. Un fallo aquí no revierte el acto.
    let refunds: PaymentRefundDTO[] = [];
    if (result.refundIds.length > 0) {
      refunds = await this.ledger.toDtos(await this.ledger.executeAndNotify(result.refundIds, actor));
    }
    if (result.caseIds.length > 0) await this.notifyReplacementPending(shipmentId, result.caseIds);
    const after = await this.buildView(this.prisma, (await this.loadRow(this.prisma, shipmentId))!);
    const cases = await this.caseRefs(result.caseIds);
    return { outcome: result.outcome, shipment: this.shipmentSummary(after), preparation: after.preparation, refunds, cases };
  }

  /**
   * 🔒 SEC-SHIP-A5 (b) — en un RETIRO, las órdenes de origen de las líneas `picked` DISPONIBLES, `FOR UPDATE`
   * (id asc.): alguna no `settled`, o con fila `order_full` no fallida ⇒ `409 WITHDRAWAL_LINE_ORIGIN_REFUNDED`.
   */
  async assertWithdrawalOriginsSettled(tx: Tx, view: PrepView): Promise<void> {
    const picked = view.lines.filter((l) => l.prepStatus === 'picked' && l.available && l.origin);
    const orderIds = [...new Set(picked.map((l) => l.origin!.orderId))].sort();
    if (orderIds.length === 0) return;
    const locked = await tx.$queryRaw<{ id: string; status: OrderStatus }[]>`SELECT id, status FROM "Order" WHERE id = ANY(${orderIds}::text[]) ORDER BY id FOR UPDATE`;
    const statusById = new Map(locked.map((o) => [o.id, o.status]));
    const pendingFull = await tx.paymentRefund.findMany({
      where: { orderId: { in: orderIds }, kind: 'order_full', ...NON_FAILED },
      select: { orderId: true },
    });
    const pendingIds = new Set(pendingFull.map((r) => r.orderId as string));
    const bad = picked
      .filter((l) => statusById.get(l.origin!.orderId) !== 'settled' || pendingIds.has(l.origin!.orderId))
      .map((l) => ({
        shipmentItemId: l.shipmentItemId,
        inventoryItemId: l.inventoryItemId,
        folio: l.dto.folio,
        orderId: l.origin!.orderId,
        orderStatus: statusById.get(l.origin!.orderId) ?? l.origin!.orderStatus,
        pendingFullRefund: pendingIds.has(l.origin!.orderId),
      }));
    if (bad.length > 0) {
      throw BusinessException.conflict('WITHDRAWAL_LINE_ORIGIN_REFUNDED', 'A card of this withdrawal belongs to a purchase being refunded', { items: bad });
    }
  }

  // ================================================================ DELETE …/prepared (§M4-SHIP.5, v1.80.5)

  async unprepare(shipmentId: string, actor: RefundActor) {
    const head = await this.prisma.shipmentRequest.findUnique({ where: { id: shipmentId }, select: { id: true } });
    if (!head) throw BusinessException.notFound();
    const res = await this.prisma.$transaction(
      async (tx) => {
        await this.lockShipment(tx, shipmentId);
        const row = (await this.loadRow(tx, shipmentId))!;
        if (row.status !== 'picking') throw this.notInPreparation(row.status);
        if (!row.preparedAt) {
          const v = await this.buildView(tx, row);
          return { outcome: 'not_prepared' as const, view: v, reclaimed: [] as { orderId: string; inventoryItemIds: string[] }[] };
        }
        const before = { preparedAt: row.preparedAt.toISOString(), preparedByUserId: row.preparedByUserId };
        const cas = await tx.shipmentRequest.updateMany({
          where: { id: shipmentId, status: 'picking', preparedAt: { not: null } },
          data: { preparedAt: null, preparedByUserId: null },
        });
        if (cas.count !== 1) throw BusinessException.conflict('CONFLICT', 'Shipment changed concurrently');
        await tx.auditLog.create({
          data: { actorUserId: actor.id, actorRole: actor.role, action: 'shipment.unprepared', entityType: 'ShipmentRequest', entityId: shipmentId, before },
        });
        const reclaimed: { orderId: string; inventoryItemIds: string[] }[] = [];
        const view0 = await this.buildView(tx, row);
        if (view0.kind === 'vault_withdrawal') {
          // 🔒 A5 (a): reclamar lo que un reembolso total ya cerró, por orden (id asc.), acotado a estas piezas.
          const byOrder = new Map<string, string[]>();
          for (const l of view0.lines) {
            if (l.prepStatus !== 'picked' || !l.available || !l.origin) continue;
            byOrder.set(l.origin.orderId, [...(byOrder.get(l.origin.orderId) ?? []), l.inventoryItemId]);
          }
          for (const orderId of [...byOrder.keys()].sort()) {
            const o = await tx.order.findUnique({ where: { id: orderId }, select: { fulfillmentMode: true, fullRefundClosedAt: true } });
            if (!o || o.fulfillmentMode !== 'vault' || o.fullRefundClosedAt === null) continue;
            const pass = await this.fullRefund.onFullRefund(tx, { orderId }, 'unprepared', actor.id, { onlyItemIds: byOrder.get(orderId) });
            if (pass.reclaimedItemIds.length > 0) reclaimed.push({ orderId, inventoryItemIds: pass.reclaimedItemIds });
          }
        }
        const view = await this.buildView(tx, (await this.loadRow(tx, shipmentId))!);
        return { outcome: 'unprepared' as const, view, reclaimed };
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
    return {
      outcome: res.outcome,
      shipment: this.shipmentSummary(res.view),
      preparation: res.view.preparation,
      ...(res.reclaimed.length > 0 ? { reclaimed: res.reclaimed } : {}),
    };
  }

  // ================================================================ guardas de la guía / enviado (§M4-SHIP.6)

  /**
   * Para `POST …/tracking` y `PATCH …/status {to:'guia'|'enviado'}`, bajo el candado del envío. Lanza el `409`
   * que corresponda; en `picking` exige `preparedAt` (la condición va TAMBIÉN en el `WHERE` del CAS del caller).
   */
  async assertCanAdvance(tx: Tx, shipmentId: string, to: 'guia' | 'enviado'): Promise<void> {
    const row = (await this.loadRow(tx, shipmentId))!;
    const view = await this.buildView(tx, row);
    // Las guardas de DINERO van primero (§M4-SHIP.17.2 / SEC-SHIP-A5 (b)): un pedido cuya compra se está
    // devolviendo no avanza aunque le falte «preparado».
    if (view.kind === 'vault_withdrawal') {
      await this.assertWithdrawalOriginsSettled(tx, view);
    } else {
      const [o] = await tx.$queryRaw<{ status: OrderStatus }[]>`SELECT status FROM "Order" WHERE id = ${row.orderId} FOR UPDATE`;
      if (o.status !== 'settled') {
        throw BusinessException.conflict('ORDER_NOT_SETTLED', 'The order is no longer settled', { orderStatus: o.status });
      }
    }
    if (row.status === 'picking' && to === 'guia' && row.preparedAt === null) {
      throw BusinessException.conflict('SHIPMENT_NOT_PREPARED', 'Shipment is not prepared', { preparation: view.preparation });
    }
    if (view.kind === 'vault_withdrawal') {
      if (to === 'guia' && view.openCaseIds.length > 0) {
        throw BusinessException.conflict('SHIPMENT_HAS_OPEN_REPLACEMENTS', 'Withdrawal has open replacement cases', { caseIds: view.openCaseIds });
      }
      if (to === 'enviado' && !view.lines.some((l) => l.prepStatus === 'picked' && l.available)) {
        throw BusinessException.conflict('CONFLICT', 'Nothing to ship: every line is blocked', { reason: 'nothing_to_ship' });
      }
    }
  }

  // ================================================================ proyecciones

  private shipmentSummary(view: PrepView) {
    const s = view.shipment;
    return { id: s.id, status: s.status, kind: view.kind, preparedAt: s.preparedAt ? s.preparedAt.toISOString() : null, preparedByUserId: s.preparedByUserId };
  }

  async caseRefs(ids: string[]): Promise<ReplacementCaseRefDTO[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.replacementCase.findMany({
      where: { id: { in: ids } },
      select: { id: true, status: true, missingReason: true, openedAt: true, resolvedAt: true, replacementInventoryItem: { select: { id: true, folio: true } } },
    });
    return rows.map((c) => ({
      id: c.id,
      status: c.status,
      missingReason: c.missingReason,
      openedAt: c.openedAt.toISOString(),
      resolvedAt: c.resolvedAt ? c.resolvedAt.toISOString() : null,
      replacement: c.replacementInventoryItem ? { inventoryItemId: c.replacementInventoryItem.id, folio: c.replacementInventoryItem.folio } : null,
    }));
  }

  /** `AV-13` — post-commit, best-effort; sello `ReplacementCase.customerNotifiedAt`; un correo por acto. */
  private async notifyReplacementPending(shipmentId: string, caseIds: string[]): Promise<void> {
    try {
      if (!this.mail) return;
      const now = new Date();
      const claimed = await this.prisma.replacementCase.updateMany({ where: { id: { in: caseIds }, customerNotifiedAt: null }, data: { customerNotifiedAt: now } });
      if (claimed.count === 0) return;
      const cases = await this.prisma.replacementCase.findMany({
        where: { id: { in: caseIds }, customerNotifiedAt: now },
        select: { customerUserId: true, missingReason: true, originalInventoryItem: { select: { card: { select: { name: true, set: { select: { name: true } } } } } } },
      });
      if (cases.length === 0) return;
      const user = await this.prisma.user.findUnique({ where: { id: cases[0].customerUserId }, select: { email: true, locale: true, anonymizedAt: true } });
      if (!user || user.anonymizedAt) return;
      await this.mail.send({
        ...replacementPendingTemplate(
          { shipmentId, cards: cases.map((c) => ({ name: c.originalInventoryItem.card.name, setName: c.originalInventoryItem.card.set?.name ?? null, reason: c.missingReason })) },
          user.locale,
        ),
        to: user.email,
      });
    } catch (e) {
      this.logger.error(`AV-13 falló para ${shipmentId}: ${(e as Error).message}`);
    }
  }

  /** §M4-SHIP.11 — el contador DERIVADO. `manualRefundsPending` solo lo ve el súper-admin. */
  async summary(role: Role, now = new Date()) {
    const [ship, vault, oldest, stuck, toReplace, oldestCase, overdue, manual] = await Promise.all([
      this.prisma.shipmentRequest.count({ where: { status: 'picking', preparedAt: null } }),
      this.prisma.vaultPlacement.count({ where: { status: 'pending' } }),
      this.prisma.shipmentRequest.findFirst({ where: { status: 'picking', preparedAt: null }, orderBy: { requestedAt: 'asc' }, select: { requestedAt: true } }),
      this.ledger.stuckRefundsCount(now),
      this.prisma.replacementCase.count({ where: { status: 'open' } }),
      this.prisma.replacementCase.findFirst({ where: { status: 'open' }, orderBy: { openedAt: 'asc' }, select: { openedAt: true } }),
      this.prisma.replacementCase.count({ where: { status: 'open', openedAt: { lte: new Date(now.getTime() - REPLACEMENT_CASE_DUE_MS) } } }),
      role === 'super_admin' ? this.prisma.manualRefund.count({ where: { status: 'pending' } }) : Promise.resolve(null),
    ]);
    return {
      ship,
      vault,
      oldestRequestedAt: oldest ? oldest.requestedAt.toISOString() : null,
      stuckRefunds: stuck,
      toReplace,
      oldestOpenCaseAt: oldestCase ? oldestCase.openedAt.toISOString() : null,
      toReplaceOverdue: overdue,
      manualRefundsPending: manual,
    };
  }
}
