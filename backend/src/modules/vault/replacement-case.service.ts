/**
 * §M4-SHIP.15 — el apartado «Por reponer» (v1.80.1…v1.80.3): la carta de la bóveda de un cliente que al prepararla
 * no está o está dañada es UNA DEUDA CON NOMBRE (`ReplacementCase`) hasta que alguien le da otra igual, aparece la
 * misma, o el súper-admin la reembolsa por el monto que captura.
 *
 * Las reglas compartidas, dichas una vez:
 *  - **Orden de candados (normativo, §M4-SHIP.15.4 paso 2):** puerta del cliente → envío (retiro) → caso → piezas
 *    (id asc.) → orden de origen → libro. Compatible con §M4-SHIP.5 (envío → piezas → órdenes → libro; no toma la
 *    puerta) y con §M4-VAULT.5 (puerta → colocación → piezas).
 *  - **CAS con el estado en el `WHERE`** (REL-B): la garantía la da el `count`, ⛔ nunca la lectura previa.
 *  - **Bitácora DENTRO de la tx**; avisos post-commit best-effort con sello.
 *  - `replace`/`found` son operador+ y ⛔ cero dinero; `refund`/`void` son `@MoneyOut()` (solo `super_admin`) y son
 *    los únicos que llaman a `closeWithdrawalIfEmpty` (candado `C-REF-1`).
 */
import { Injectable, Logger } from '@nestjs/common';
import {
  InventoryStatus,
  MissingReason,
  OrderStatus,
  PaymentRefund,
  Prisma,
  ReplacementCaseSource,
  ReplacementCaseStatus,
  Role,
  ShipmentStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { parseAdminListFilters } from '../../common/admin-list-filters';
import { parseEnumFilter } from '../../common/enum-filter';
import {
  CaseRefundContext,
  RefundComponents,
  caseRefundComponents,
  caseRefundContextOf,
  ivaIsIncluded,
  shipmentFeeRefundComponents,
  subtractRefundComponents,
} from '../../common/money';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import { NON_FAILED, PaymentRefundDTO, RefundLedgerService } from '../payments/refunds/refund-ledger.service';
import { ManualRefundDTO, ManualRefundService } from '../payments/refunds/manual-refund.service';
import { ShipPreparationStateDTO, ShipmentPrepService, CustomerRefDTO } from '../shipments/shipment-prep.service';
import { LocationView, PreparationCardDTO, locationViewOf, nullIfBlank, preparationCardOf } from '../shipments/preparation-view';
import { customerDisplayName } from './customer-display-name';
import { VaultService } from './vault.service';
import { CustomerDrawerRef, VAULT_VERB_TX_OPTIONS, customerDrawersOf, lockCustomerVaultGate } from './vault-placement.rules';
import {
  CASE_REFUND_CONFIRM_MULTIPLIER,
  PieceIdentity,
  REPLACEMENT_CASE_DUE_MS,
  dueAtOf,
  identityMismatch,
  identityOf,
  isOverdue,
} from './replacement-case.rules';

type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaService;

const SOURCE_VALUES: readonly ReplacementCaseSource[] = Object.values(ReplacementCaseSource);
const STATE_VALUES = ['open', 'closed'] as const;
const CANDIDATE_STATUSES: readonly InventoryStatus[] = ['in_stock', 'listed'];
const CANDIDATES_MAX = 50;

// ---------------------------------------------------------------- DTOs del contrato (§M4-SHIP.15.8)

export interface PieceIdentityDTO extends PieceIdentity {}

export interface ReplacementCaseDTO {
  id: string;
  source: ReplacementCaseSource;
  status: ReplacementCaseStatus;
  missingReason: MissingReason;
  customer: CustomerRefDTO;
  original: {
    inventoryItemId: string;
    folio: string;
    card: PreparationCardDTO;
    identity: PieceIdentityDTO;
    pieceStatus: InventoryStatus;
    currentLocation: LocationView;
  };
  origin: { orderId: string; orderNumber: string | null; orderStatus: OrderStatus } | null;
  shipment: { id: string; status: ShipmentStatus; preparedAt: string | null } | null;
  placement: { id: string; orderNumber: string | null } | null;
  destination: 'package' | 'drawer';
  customerDrawers: CustomerDrawerRef[];
  candidateCount: number;
  openedAt: string;
  openedBy: { userId: string; name: string | null };
  resolvedAt: string | null;
  resolvedBy: { userId: string; name: string | null } | null;
  replacement: { inventoryItemId: string; folio: string } | null;
  refund: PaymentRefundDTO | null;
  voidNote: string | null;
  dueAt: string;
  overdue: boolean;
  refundContext: RefundContext | null;
  refundCapture: {
    amountCents: number;
    reason: string;
    paidReferenceCents: number;
    market: { cents: number; capturedDate: string } | null;
    aboveReferenceConfirmed: boolean;
  } | null;
  manualRefunds: ManualRefundDTO[] | null;
}

export type RefundContext =
  | {
      available: true;
      paidReferenceCents: number;
      market: { cents: number; capturedDate: string } | null;
      referenceCents: number;
      confirmAboveCents: number;
      limitCents: number;
      stripeAvailableCents: number;
      closesShipment: boolean;
      customerHasClabe: boolean;
    }
  | { available: false; reason: 'no_origin_order' | 'legacy_convention' | 'origin_not_settled' };

export interface ReplacementCandidateDTO {
  inventoryItemId: string;
  folio: string;
  status: 'in_stock' | 'listed';
  currentLocation: LocationView;
  listPriceCents: number | null;
}

export interface CaseRefundPreviewDTO {
  amountCents: number | null;
  paidReferenceCents: number;
  market: { cents: number; capturedDate: string } | null;
  referenceCents: number;
  confirmAboveCents: number;
  limitCents: number;
  confirmation: 'none' | 'reinforced' | 'blocked' | null;
  stripeAvailableCents: number;
  caseStripeCents: number | null;
  shipmentFeeCents: number;
  stripeCents: number | null;
  manualCents: number | null;
  closesShipment: boolean;
  customerHasClabe: boolean;
}

export interface CaseActor {
  id: string;
  role: Role;
}

export interface ReplaceBody {
  inventoryItemId: string;
  locationId?: string | null;
}

export interface CaseRefundBody {
  amountCents: number;
  reason: string;
  expectedStripeCents: number;
  expectedManualCents: number;
  confirmAboveReference?: boolean;
}

// ---------------------------------------------------------------- carga

const CASE_INCLUDE = {
  originalInventoryItem: { include: { card: { include: { set: true } }, location: true } },
  originOrderItem: {
    select: {
      id: true,
      unitPriceCents: true,
      order: {
        select: {
          id: true,
          orderNumber: true,
          status: true,
          subtotalCents: true,
          shippingFeeCents: true,
          processingFeeCents: true,
          ivaCents: true,
          ivaRatePct: true,
          totalCents: true,
          priceConvention: true,
        },
      },
    },
  },
  shipmentRequest: {
    select: { id: true, status: true, preparedAt: true, totalCents: true, shippingFeeCents: true, ivaCents: true, processingFeeCents: true, userId: true },
  },
  placementItem: { select: { id: true, placement: { select: { id: true, order: { select: { orderNumber: true } } } } } },
  replacementInventoryItem: { select: { id: true, folio: true } },
  refund: true,
} satisfies Prisma.ReplacementCaseInclude;
type CaseRow = Prisma.ReplacementCaseGetPayload<{ include: typeof CASE_INCLUDE }>;

/** Lo que el reparto necesita del caso (una función, la preview y el verbo). */
interface RefundPlan {
  ctx: CaseRefundContext;
  paidReferenceCents: number;
  market: { cents: number; capturedDate: string } | null;
  referenceCents: number;
  confirmAboveCents: number;
  limitCents: number;
  stripeAvailableCents: number;
  closesShipment: boolean;
  shipmentFeeCents: number;
  customerHasClabe: boolean;
}

@Injectable()
export class ReplacementCaseService {
  private readonly logger = new Logger(ReplacementCaseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly ledger: RefundLedgerService,
    private readonly manual: ManualRefundService,
    private readonly prep: ShipmentPrepService,
    private readonly vault: VaultService,
  ) {}

  // ================================================================ lecturas

  private load(db: Db, id: string): Promise<CaseRow | null> {
    // PROJECTION-EXEMPT: fila interna; `toDtos` proyecta antes de responder.
    return db.replacementCase.findUnique({ where: { id }, include: CASE_INCLUDE });
  }

  /** «Dónde iría una reposición AHORA»: `package` ⇔ retiro ∧ envío `picking`; `drawer` en cualquier otro caso. */
  private destinationOf(c: { source: ReplacementCaseSource; shipmentRequest: { status: ShipmentStatus } | null }): 'package' | 'drawer' {
    return c.source === 'withdrawal' && c.shipmentRequest?.status === 'picking' ? 'package' : 'drawer';
  }

  private identityKey(p: PieceIdentity): string {
    const i = identityOf(p);
    return JSON.stringify([i.cardId, i.productType, i.finish, i.cardProductId, i.rawCondition, i.gradingCompany, i.gradeValue, i.sealedProductId, i.sealedCondition]);
  }

  private identityWhere(p: PieceIdentity): Prisma.InventoryItemWhereInput {
    const i = identityOf(p);
    return {
      cardId: i.cardId,
      productType: i.productType,
      finish: i.finish,
      cardProductId: i.cardProductId,
      rawCondition: i.rawCondition,
      gradingCompany: i.gradingCompany,
      gradeValue: i.gradeValue,
      sealedProductId: i.sealedProductId,
      sealedCondition: i.sealedCondition,
    };
  }

  /** UNA consulta de candidatas para varias identidades; se cuenta en memoria por identidad. */
  private async candidateCounts(db: Db, rows: CaseRow[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    const identities = new Map<string, PieceIdentity>();
    for (const r of rows) identities.set(this.identityKey(r.originalInventoryItem), r.originalInventoryItem);
    if (identities.size === 0) return out;
    const found = await db.inventoryItem.findMany({
      where: { ownerType: 'platform', status: { in: [...CANDIDATE_STATUSES] }, OR: [...identities.values()].map((i) => this.identityWhere(i)) },
      select: { cardId: true, productType: true, finish: true, cardProductId: true, rawCondition: true, gradingCompany: true, gradeValue: true, sealedProductId: true, sealedCondition: true },
    });
    for (const f of found) {
      const k = this.identityKey(f);
      out.set(k, (out.get(k) ?? 0) + 1);
    }
    return out;
  }

  /**
   * `refundContext` (solo súper-admin, solo `open`): lo que la pantalla de captura necesita ANTES de escribir un monto.
   * Sin candados (es una lectura); el verbo recalcula bajo candado.
   */
  private async refundContextOf(db: Db, c: CaseRow): Promise<RefundContext> {
    const origin = c.originOrderItem;
    if (!origin) return { available: false, reason: 'no_origin_order' };
    if (!ivaIsIncluded(origin.order.priceConvention)) return { available: false, reason: 'legacy_convention' };
    if (origin.order.status !== 'settled') return { available: false, reason: 'origin_not_settled' };
    const plan = await this.planOf(db, c);
    return {
      available: true,
      paidReferenceCents: plan.paidReferenceCents,
      market: plan.market,
      referenceCents: plan.referenceCents,
      confirmAboveCents: plan.confirmAboveCents,
      limitCents: plan.limitCents,
      stripeAvailableCents: plan.stripeAvailableCents,
      closesShipment: plan.closesShipment,
      customerHasClabe: plan.customerHasClabe,
    };
  }

  /** Q, M, R, 2R, kR, `max`, cierre y CLABE — UN cuerpo para la preview, el `refundContext` y el verbo. */
  private async planOf(db: Db, c: CaseRow): Promise<RefundPlan> {
    const origin = c.originOrderItem!;
    const ctx = caseRefundContextOf(origin.order, origin.unitPriceCents);
    const market = await this.vault.marketRefOf(c.originalInventoryItem);
    const referenceCents = Math.max(ctx.paidCents, market?.cents ?? 0);
    const k = await this.settings.getNumber(SettingKey.CASE_REFUND_HARD_MULTIPLIER, db);
    const refunded = await this.ledger.refundedNonFailedCents(db, origin.order.id);
    const stripeAvailableCents = Math.max(0, origin.order.totalCents - refunded);
    const closes = await this.wouldCloseWithdrawal(db, c);
    const kyc = await db.kycProfile.findUnique({ where: { userId: c.customerUserId }, select: { clabeEnc: true } });
    return {
      ctx,
      paidReferenceCents: ctx.paidCents,
      market,
      referenceCents,
      confirmAboveCents: CASE_REFUND_CONFIRM_MULTIPLIER * referenceCents,
      limitCents: k * referenceCents,
      stripeAvailableCents,
      closesShipment: closes.closes,
      shipmentFeeCents: closes.feeCents,
      customerHasClabe: Boolean(kyc?.clabeEnc),
    };
  }

  /**
   * §M4-SHIP.15.6 — ¿cerraría el retiro resolver ESTE caso por `refund`/`void`? El retiro sigue `picking`, no queda
   * ninguna línea `picked` disponible ni otro caso `open`. Y la cifra del cierre (`shipment_fee`) si aún no hay fila.
   */
  private async wouldCloseWithdrawal(db: Db, c: CaseRow): Promise<{ closes: boolean; feeCents: number }> {
    const s = c.shipmentRequest;
    if (c.source !== 'withdrawal' || !s || s.status !== 'picking') return { closes: false, feeCents: 0 };
    const [picked, otherOpen] = await Promise.all([
      db.shipmentItem.count({ where: { shipmentRequestId: s.id, prepStatus: 'picked' } }),
      db.replacementCase.count({ where: { shipmentRequestId: s.id, status: 'open', id: { not: c.id } } }),
    ]);
    if (picked > 0 || otherOpen > 0) return { closes: false, feeCents: 0 };
    if (s.totalCents <= 0) return { closes: true, feeCents: 0 };
    const existing = await db.paymentRefund.count({ where: { shipmentRequestId: s.id, ...NON_FAILED } });
    return { closes: true, feeCents: existing > 0 ? 0 : shipmentFeeRefundComponents(s).amountCents };
  }

  /** Proyección en LOTE: nombres, cajones, candidatas, filas del libro, SPEI (solo súper-admin), contexto (solo súper-admin y `open`). */
  async toDtos(db: Db, rows: CaseRow[], role: Role, now = new Date()): Promise<ReplacementCaseDTO[]> {
    if (rows.length === 0) return [];
    const isAdmin = role === 'super_admin';
    const userIds = [...new Set(rows.flatMap((r) => [r.customerUserId, r.openedByUserId, r.resolvedByUserId]).filter((x): x is string => !!x))];
    const [users, drawers, counts, refundDtos, manualByCase] = await Promise.all([
      db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, nameSource: true, email: true } }),
      customerDrawersOf(db, rows.map((r) => r.customerUserId)),
      this.candidateCounts(db, rows),
      this.ledger.toDtos(rows.map((r) => r.refund).filter((x): x is PaymentRefund => !!x)),
      isAdmin ? this.manual.dtosByCase(rows.map((r) => r.id), now) : Promise.resolve(new Map<string, ManualRefundDTO[]>()),
    ]);
    const userById = new Map(users.map((u) => [u.id, u]));
    const refundById = new Map(refundDtos.map((d) => [d.id, d]));
    const out: ReplacementCaseDTO[] = [];
    for (const r of rows) {
      const cust = userById.get(r.customerUserId);
      const opened = userById.get(r.openedByUserId);
      const resolved = r.resolvedByUserId ? userById.get(r.resolvedByUserId) : null;
      const piece = r.originalInventoryItem;
      out.push({
        id: r.id,
        source: r.source,
        status: r.status,
        missingReason: r.missingReason,
        customer: { userId: r.customerUserId, fullName: cust ? customerDisplayName(cust) : null, email: cust?.email ?? '' },
        original: {
          inventoryItemId: piece.id,
          folio: piece.folio,
          card: preparationCardOf(piece),
          identity: identityOf(piece),
          pieceStatus: piece.status,
          currentLocation: locationViewOf(piece.location),
        },
        origin: r.originOrderItem
          ? { orderId: r.originOrderItem.order.id, orderNumber: nullIfBlank(r.originOrderItem.order.orderNumber), orderStatus: r.originOrderItem.order.status }
          : null,
        shipment: r.shipmentRequest ? { id: r.shipmentRequest.id, status: r.shipmentRequest.status, preparedAt: r.shipmentRequest.preparedAt?.toISOString() ?? null } : null,
        placement: r.placementItem ? { id: r.placementItem.placement.id, orderNumber: nullIfBlank(r.placementItem.placement.order.orderNumber) } : null,
        destination: this.destinationOf(r),
        customerDrawers: drawers.get(r.customerUserId) ?? [],
        candidateCount: counts.get(this.identityKey(piece)) ?? 0,
        openedAt: r.openedAt.toISOString(),
        openedBy: { userId: r.openedByUserId, name: opened ? nullIfBlank(opened.name) : null },
        resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
        resolvedBy: r.resolvedByUserId ? { userId: r.resolvedByUserId, name: resolved ? nullIfBlank(resolved.name) : null } : null,
        replacement: r.replacementInventoryItem ? { inventoryItemId: r.replacementInventoryItem.id, folio: r.replacementInventoryItem.folio } : null,
        refund: r.refund ? (refundById.get(r.refund.id) ?? null) : null,
        voidNote: r.voidNote,
        dueAt: dueAtOf(r.openedAt).toISOString(),
        overdue: isOverdue(r.status, r.openedAt, now),
        refundContext: isAdmin && r.status === 'open' ? await this.refundContextOf(db, r) : null,
        refundCapture:
          isAdmin && r.status === 'refunded'
            ? {
                amountCents: r.refundAmountCents as number,
                reason: r.refundReason as string,
                paidReferenceCents: r.refundPaidRefCents as number,
                market: r.refundMarketRefCents != null ? { cents: r.refundMarketRefCents, capturedDate: r.refundMarketRefDate?.toISOString().slice(0, 10) ?? '' } : null,
                aboveReferenceConfirmed: r.refundAboveRefConfirmed === true,
              }
            : null,
        manualRefunds: isAdmin ? (manualByCase.get(r.id) ?? []) : null,
      });
    }
    return out;
  }

  async dto(db: Db, id: string, role: Role, now = new Date()): Promise<ReplacementCaseDTO> {
    const row = await this.load(db, id);
    if (!row) throw BusinessException.notFound('NOT_FOUND', 'Replacement case not found');
    return (await this.toDtos(db, [row], role, now))[0];
  }

  /** `GET /admin/replacement-cases` — `open` por `openedAt` asc (vencidos arriba); `closed` por `resolvedAt` desc. */
  async list(raw: { state?: string; source?: string; overdue?: string; q?: string; page?: string; pageSize?: string }, role: Role, now = new Date()) {
    const f = parseAdminListFilters({ page: raw.page ?? '1', pageSize: raw.pageSize ?? '25', q: raw.q });
    const state = parseEnumFilter('state', raw.state, STATE_VALUES) ?? 'open';
    const source = parseEnumFilter('source', raw.source, SOURCE_VALUES);
    const where: Prisma.ReplacementCaseWhereInput = state === 'open' ? { status: 'open' } : { status: { not: 'open' } };
    if (source) where.source = source;
    if (raw.overdue === 'true') {
      where.status = 'open';
      where.openedAt = { lte: new Date(now.getTime() - REPLACEMENT_CASE_DUE_MS) };
    }
    if (f.q) {
      const q = f.q;
      const users = await this.prisma.user.findMany({
        where: { OR: [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }] },
        select: { id: true },
      });
      where.OR = [
        { customerUserId: { in: users.map((u) => u.id) } },
        { originalInventoryItem: { folio: { contains: q, mode: 'insensitive' } } },
        { originOrderItem: { order: { orderNumber: { contains: q, mode: 'insensitive' } } } },
        { id: q },
      ];
    }
    const orderBy: Prisma.ReplacementCaseOrderByWithRelationInput[] = state === 'open' ? [{ openedAt: 'asc' }, { id: 'asc' }] : [{ resolvedAt: 'desc' }, { id: 'asc' }];
    const [rows, total] = await Promise.all([
      this.prisma.replacementCase.findMany({ where, include: CASE_INCLUDE, orderBy, skip: (f.page - 1) * f.pageSize, take: f.pageSize }),
      this.prisma.replacementCase.count({ where }),
    ]);
    return { data: await this.toDtos(this.prisma, rows, role, now), page: f.page, pageSize: f.pageSize, total };
  }

  /** `GET /admin/replacement-cases/:id` — + candidatas (hasta 50, por etiqueta de ubicación y folio). */
  async detail(id: string, role: Role, now = new Date()): Promise<ReplacementCaseDTO & { candidates: ReplacementCandidateDTO[] }> {
    const row = await this.load(this.prisma, id);
    if (!row) throw BusinessException.notFound('NOT_FOUND', 'Replacement case not found');
    const [dto] = await this.toDtos(this.prisma, [row], role, now);
    const cands = await this.prisma.inventoryItem.findMany({
      where: { ownerType: 'platform', status: { in: [...CANDIDATE_STATUSES] }, ...this.identityWhere(row.originalInventoryItem) },
      include: { location: true },
      take: CANDIDATES_MAX,
      orderBy: [{ location: { label: 'asc' } }, { folio: 'asc' }],
    });
    return {
      ...dto,
      candidates: cands.map((c) => ({
        inventoryItemId: c.id,
        folio: c.folio,
        status: c.status as 'in_stock' | 'listed',
        currentLocation: locationViewOf(c.location),
        listPriceCents: c.listPriceCents,
      })),
    };
  }

  // ================================================================ candados

  /** Puerta del cliente → envío (retiro) → caso. Devuelve la fila releída bajo candado. */
  private async lockCase(tx: Tx, head: { id: string; customerUserId: string; source: ReplacementCaseSource; shipmentRequestId: string | null }): Promise<CaseRow> {
    await lockCustomerVaultGate(tx, head.customerUserId);
    if (head.source === 'withdrawal' && head.shipmentRequestId) {
      await tx.$queryRaw`SELECT id FROM "ShipmentRequest" WHERE id = ${head.shipmentRequestId} FOR UPDATE`;
    }
    await tx.$queryRaw`SELECT id FROM "ReplacementCase" WHERE id = ${head.id} FOR UPDATE`;
    return (await this.load(tx, head.id))!;
  }

  private async lockPieces(tx: Tx, ids: string[]): Promise<void> {
    const sorted = [...new Set(ids)].sort();
    await tx.$queryRaw`SELECT id FROM "InventoryItem" WHERE id = ANY(${sorted}::text[]) ORDER BY id FOR UPDATE`;
  }

  private async lockOriginOrder(tx: Tx, c: CaseRow): Promise<OrderStatus | null> {
    if (!c.originOrderItem) return null;
    const rows = await tx.$queryRaw<{ status: OrderStatus }[]>`SELECT status FROM "Order" WHERE id = ${c.originOrderItem.order.id} FOR UPDATE`;
    return rows[0]?.status ?? null;
  }

  private notOpen(c: CaseRow): BusinessException {
    return BusinessException.conflict('CASE_NOT_OPEN', `Replacement case is ${c.status}`, {
      status: c.status,
      resolvedAt: c.resolvedAt ? c.resolvedAt.toISOString() : null,
    });
  }

  /** El cajón de una reposición a `drawer` (§M4-VAULT.5 paso 7), evaluado bajo la puerta del cliente. */
  private async resolveDrawer(tx: Tx, customerUserId: string, locationId: string | null): Promise<{ id: string; drawers: CustomerDrawerRef[] }> {
    const drawers = (await customerDrawersOf(tx, [customerUserId])).get(customerUserId) ?? [];
    const reject = (reason: string, extra: Record<string, unknown> = {}) =>
      BusinessException.validation('LOCATION_NOT_AVAILABLE', `Drawer not available: ${reason}`, { reason, ...extra });
    if (!locationId) throw reject('location_required');
    const loc = await tx.vaultLocation.findUnique({ where: { id: locationId } });
    if (!loc) throw reject('not_found');
    if (!loc.isActive) throw reject('inactive');
    if (loc.zone !== 'customer_custody') throw reject('not_customer_custody');
    if (drawers.length > 0 && !drawers.some((d) => d.id === locationId)) throw reject('not_customer_drawer', { customerDrawers: drawers });
    return { id: loc.id, drawers };
  }

  /** La original pasa a PLATAFORMA (§M4-SHIP.15.2: `replaced` / `refunded` / `voided`); estado sin cambio; un movimiento `replacement`. */
  private async originalToPlatform(tx: Tx, c: CaseRow, actor: CaseActor, note: string): Promise<void> {
    const piece = c.originalInventoryItem;
    const res = await tx.inventoryItem.updateMany({
      where: { id: piece.id, ownerType: 'customer', ownerUserId: c.customerUserId, status: { in: ['lost', 'damaged'] } },
      data: { ownerType: 'platform', ownerUserId: null, ownershipStatus: null },
    });
    if (res.count !== 1) {
      throw BusinessException.conflict('CONFLICT', 'The original piece is no longer the customer\'s lost/damaged card');
    }
    await tx.inventoryMovement.create({
      data: {
        itemId: piece.id,
        fromLocationId: piece.locationId,
        toLocationId: piece.locationId,
        fromStatus: piece.status,
        toStatus: piece.status,
        reason: 'replacement',
        actorUserId: actor.id,
        note,
      },
    });
  }

  private async audit(tx: Tx, actor: CaseActor, action: string, caseId: string, after: Record<string, unknown>): Promise<void> {
    await tx.auditLog.create({
      data: { actorUserId: actor.id, actorRole: actor.role, action, entityType: 'ReplacementCase', entityId: caseId, after: after as Prisma.InputJsonValue },
      select: { id: true },
    });
  }

  private async preparationOf(tx: Tx, shipmentId: string | null): Promise<ShipPreparationStateDTO | undefined> {
    if (!shipmentId) return undefined;
    const row = await this.prep.loadRow(tx, shipmentId);
    if (!row) return undefined;
    return (await this.prep.buildView(tx, row)).preparation;
  }

  // ================================================================ replace / found (§M4-SHIP.15.4)

  async replace(caseId: string, body: ReplaceBody, actor: CaseActor): Promise<{ outcome: 'replaced' | 'found' | 'already_resolved'; case: ReplacementCaseDTO; preparation?: ShipPreparationStateDTO }> {
    const head = await this.prisma.replacementCase.findUnique({ where: { id: caseId }, select: { id: true, customerUserId: true, source: true, shipmentRequestId: true } });
    if (!head) throw BusinessException.notFound('NOT_FOUND', 'Replacement case not found');
    const requestedLocationId = nullIfBlank(body.locationId ?? null);
    return this.prisma.$transaction(async (tx) => {
      const c = await this.lockCase(tx, head);
      const now = new Date();
      // 3. bajo candado.
      if (c.status !== 'open') {
        if ((c.status === 'replaced' || c.status === 'found') && c.replacementInventoryItemId === body.inventoryItemId) {
          return { outcome: 'already_resolved' as const, case: await this.dto(tx, caseId, actor.role, now), preparation: await this.preparationOf(tx, c.shipmentRequestId) };
        }
        throw this.notOpen(c);
      }
      const destination = this.destinationOf(c);
      const target = destination === 'drawer' ? (await this.resolveDrawer(tx, c.customerUserId, requestedLocationId)).id : null;
      const original = c.originalInventoryItem;
      let outcome: 'replaced' | 'found';
      let replacementShipmentItemId: string | null = null;
      let replacement: { id: string; folio: string };
      if (body.inventoryItemId === original.id) {
        // 4. ¿Apareció?
        if (c.missingReason !== 'not_found') {
          throw BusinessException.validation('REPLACEMENT_NOT_ELIGIBLE', 'A damaged card cannot reappear', { reason: 'same_piece_damaged' });
        }
        await this.lockPieces(tx, [original.id]);
        const cas = await tx.inventoryItem.updateMany({
          where: { id: original.id, ownerType: 'customer', ownerUserId: c.customerUserId, status: 'lost' },
          data: { status: 'in_custody', ...(target ? { locationId: target } : {}) },
        });
        if (cas.count !== 1) {
          throw BusinessException.validation('REPLACEMENT_NOT_ELIGIBLE', 'The original piece is not lost anymore', { reason: 'same_piece_not_lost' });
        }
        if (destination === 'package' && c.shipmentItemId) {
          const line = await tx.shipmentItem.updateMany({
            where: { id: c.shipmentItemId, prepStatus: 'missing' },
            data: { prepStatus: 'picked', missingReason: null, prepMarkedAt: now, prepMarkedByUserId: actor.id },
          });
          if (line.count !== 1) throw BusinessException.conflict('CONFLICT', 'The withdrawal line is no longer marked missing');
          // (`replacementShipmentItemId` solo con `replaced`: la línea que vuelve a `picked` es la MISMA, CHECK M-61.)
        }
        await tx.inventoryMovement.create({
          data: {
            itemId: original.id,
            fromLocationId: original.locationId,
            toLocationId: target ?? original.locationId,
            fromStatus: 'lost',
            toStatus: 'in_custody',
            reason: 'replacement',
            actorUserId: actor.id,
            note: `apareció · caso ${c.id}`,
          },
        });
        outcome = 'found';
        replacement = { id: original.id, folio: original.folio };
      } else {
        // 5. reponer.
        const cand = await tx.inventoryItem.findUnique({ where: { id: body.inventoryItemId } });
        if (!cand) throw BusinessException.validation('REPLACEMENT_NOT_ELIGIBLE', 'Candidate not found', { reason: 'not_found' });
        const mismatch = identityMismatch(original, cand);
        if (mismatch.length > 0) {
          throw BusinessException.validation('REPLACEMENT_NOT_ELIGIBLE', 'Candidate identity differs', { reason: 'identity_mismatch', mismatch });
        }
        await this.lockPieces(tx, [original.id, cand.id]);
        const took = await tx.inventoryItem.updateMany({
          where: { id: cand.id, ownerType: 'platform', status: { in: [...CANDIDATE_STATUSES] }, ...this.identityWhere(original) },
          data: { status: 'in_custody', ownerType: 'customer', ownerUserId: c.customerUserId, ownershipStatus: 'settled', ...(target ? { locationId: target } : {}) },
        });
        if (took.count !== 1) {
          throw BusinessException.validation('REPLACEMENT_NOT_ELIGIBLE', 'Candidate is not available on the platform', { reason: 'not_platform_available' });
        }
        await this.originalToPlatform(tx, c, actor, `repuesta por ${cand.folio} · caso ${c.id}`);
        if (destination === 'package') {
          const line = await tx.shipmentItem.create({
            data: { shipmentRequestId: c.shipmentRequestId as string, inventoryItemId: cand.id, prepStatus: 'picked', prepMarkedAt: now, prepMarkedByUserId: actor.id },
            select: { id: true },
          });
          replacementShipmentItemId = line.id;
        }
        await tx.inventoryMovement.create({
          data: {
            itemId: cand.id,
            fromLocationId: cand.locationId,
            toLocationId: target ?? cand.locationId,
            fromStatus: cand.status,
            toStatus: 'in_custody',
            reason: 'replacement',
            actorUserId: actor.id,
            note: `repone a ${original.folio} · caso ${c.id}`,
          },
        });
        outcome = 'replaced';
        replacement = { id: cand.id, folio: cand.folio };
      }
      // 6. orden de origen: no se le repone una carta a quien disputó o ya recibió su dinero (rollback de todo).
      const originStatus = await this.lockOriginOrder(tx, c);
      if (originStatus !== null && originStatus !== 'settled') {
        throw BusinessException.conflict('CASE_ORIGIN_NOT_SETTLED', 'The origin order is no longer settled', { originStatus });
      }
      // 7. CAS del caso.
      const closed = await tx.replacementCase.updateMany({
        where: { id: c.id, status: 'open' },
        data: { status: outcome, resolvedAt: now, resolvedByUserId: actor.id, replacementInventoryItemId: replacement.id, replacementShipmentItemId },
      });
      if (closed.count !== 1) throw BusinessException.conflict('CONFLICT', 'Replacement case changed concurrently');
      // 8. bitácora.
      await this.audit(tx, actor, `replacement_case.${outcome}`, c.id, {
        source: c.source,
        customerUserId: c.customerUserId,
        original: { id: original.id, folio: original.folio },
        replacement: { id: replacement.id, folio: replacement.folio },
        destination,
        locationId: target,
        requestedLocationId,
        shipmentItemId: replacementShipmentItemId,
      });
      // 9. ⛔ cero dinero, cero Stripe, cero tope, sin aviso.
      return { outcome, case: await this.dto(tx, caseId, actor.role, now), preparation: await this.preparationOf(tx, c.shipmentRequestId) };
    }, VAULT_VERB_TX_OPTIONS);
  }

  // ================================================================ refund-preview / refund (§M4-SHIP.15.5)

  private assertRefundable(c: CaseRow, originStatus: OrderStatus | null): void {
    if (!c.originOrderItem) {
      throw BusinessException.conflict('CASE_REFUND_NOT_AVAILABLE', 'The case has no origin order', { reason: 'no_origin_order' });
    }
    if (!ivaIsIncluded(c.originOrderItem.order.priceConvention)) {
      throw BusinessException.conflict('CASE_REFUND_NOT_AVAILABLE', 'Legacy price convention', { reason: 'legacy_convention' });
    }
    const st = originStatus ?? c.originOrderItem.order.status;
    if (st !== 'settled') {
      throw BusinessException.conflict('CASE_ORIGIN_NOT_SETTLED', 'The origin order is no longer settled', { originStatus: st });
    }
  }

  private confirmationOf(a: number, plan: RefundPlan): 'none' | 'reinforced' | 'blocked' {
    if (a <= plan.confirmAboveCents) return 'none';
    if (a <= plan.limitCents) return 'reinforced';
    return 'blocked';
  }

  private splitOf(a: number, plan: RefundPlan): { stripe: number; manual: number } {
    const stripe = Math.min(a, plan.stripeAvailableCents);
    return { stripe, manual: a - stripe };
  }

  /** Previsualización: mismo cuerpo que el verbo hasta el paso 9, sin candados ni escrituras. */
  async refundPreview(caseId: string, amountRaw: string | undefined): Promise<CaseRefundPreviewDTO> {
    let amountCents: number | null = null;
    if (amountRaw !== undefined && amountRaw !== '') {
      const n = Number(amountRaw);
      if (!/^\d+$/.test(amountRaw) || !Number.isInteger(n) || n <= 0 || n > 2147483647) {
        throw BusinessException.badRequest('VALIDATION_ERROR', 'amountCents must be a positive integer', { field: 'amountCents' });
      }
      amountCents = n;
    }
    const c = await this.load(this.prisma, caseId);
    if (!c) throw BusinessException.notFound('NOT_FOUND', 'Replacement case not found');
    if (c.status !== 'open') throw this.notOpen(c);
    this.assertRefundable(c, null);
    const plan = await this.planOf(this.prisma, c);
    const base = {
      paidReferenceCents: plan.paidReferenceCents,
      market: plan.market,
      referenceCents: plan.referenceCents,
      confirmAboveCents: plan.confirmAboveCents,
      limitCents: plan.limitCents,
      stripeAvailableCents: plan.stripeAvailableCents,
      shipmentFeeCents: plan.shipmentFeeCents,
      closesShipment: plan.closesShipment,
      customerHasClabe: plan.customerHasClabe,
    };
    if (amountCents === null) {
      return { amountCents: null, confirmation: null, caseStripeCents: null, stripeCents: null, manualCents: null, ...base };
    }
    const split = this.splitOf(amountCents, plan);
    return {
      amountCents,
      confirmation: this.confirmationOf(amountCents, plan),
      caseStripeCents: split.stripe,
      stripeCents: split.stripe + plan.shipmentFeeCents,
      manualCents: split.manual,
      ...base,
    };
  }

  /** 💰 El reembolso sin reposición por el monto que captura el súper-admin. */
  async refund(caseId: string, body: CaseRefundBody, actor: CaseActor): Promise<{
    outcome: 'refunded' | 'already_resolved';
    case: ReplacementCaseDTO;
    refunds: PaymentRefundDTO[];
    manualRefunds: ManualRefundDTO[];
    shipment?: { status: ShipmentStatus; closed: boolean };
  }> {
    const head = await this.prisma.replacementCase.findUnique({ where: { id: caseId }, select: { id: true, customerUserId: true, source: true, shipmentRequestId: true } });
    if (!head) throw BusinessException.notFound('NOT_FOUND', 'Replacement case not found');
    const reason = body.reason.trim();
    const result = await this.prisma.$transaction(async (tx) => {
      const c = await this.lockCase(tx, head);
      const now = new Date();
      // 3. idempotencia: `refunded` ⇒ 200 con sus filas (⛔ sin comparar el cuerpo).
      if (c.status !== 'open') {
        if (c.status === 'refunded') {
          return { outcome: 'already_resolved' as const, refundIds: [] as string[], manualIds: [] as string[], shipment: await this.shipmentState(tx, c) };
        }
        throw this.notOpen(c);
      }
      // 4. origen.
      this.assertRefundable(c, null);
      // 5. original → plataforma (`count ≠ 1` ⇒ 409 CONFLICT).
      await this.lockPieces(tx, [c.originalInventoryItem.id]);
      await this.originalToPlatform(tx, c, actor, `reembolsada sin reposición · caso ${c.id}`);
      // 6. orden de origen FOR UPDATE.
      const originStatus = await this.lockOriginOrder(tx, c);
      this.assertRefundable(c, originStatus);
      // 7. Q, M, R, k ⇒ topes.
      const plan = await this.planOf(tx, c);
      const A = body.amountCents;
      const confirmation = this.confirmationOf(A, plan);
      if (confirmation === 'blocked') {
        throw BusinessException.validation('CASE_REFUND_ABOVE_LIMIT', 'Amount exceeds the hard limit', { referenceCents: plan.referenceCents, limitCents: plan.limitCents });
      }
      if (confirmation === 'reinforced' && body.confirmAboveReference !== true) {
        throw BusinessException.validation('CASE_REFUND_CONFIRMATION_REQUIRED', 'Amount above 2× the reference requires confirmation', {
          referenceCents: plan.referenceCents,
          confirmAboveCents: plan.confirmAboveCents,
          limitCents: plan.limitCents,
        });
      }
      // 8. reparto y cierre.
      const split = this.splitOf(A, plan);
      const stripeTotal = split.stripe + plan.shipmentFeeCents;
      // 9. lo que el súper-admin vio.
      if (body.expectedStripeCents !== stripeTotal || body.expectedManualCents !== split.manual) {
        throw BusinessException.conflict('REFUND_PREVIEW_STALE', 'The refund split changed', { stripeCents: stripeTotal, manualCents: split.manual });
      }
      // 10. escrituras.
      const origin = c.originOrderItem!;
      const compA = caseRefundComponents(A, plan.ctx);
      const compStripe = caseRefundComponents(split.stripe, plan.ctx);
      const compManual: RefundComponents = subtractRefundComponents(compA, compStripe);
      const refundIds: string[] = [];
      let refundId: string | null = null;
      if (split.stripe > 0) {
        let rows: PaymentRefund[];
        try {
          rows = await this.ledger.createRows(
            tx,
            [{ idempotencyKey: `case:${c.id}`, kind: 'case_refund', orderId: origin.order.id, orderItemId: origin.id, replacementCaseId: c.id, components: compStripe, reason }],
            actor,
            { caseId: c.id },
          );
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            throw BusinessException.conflict('CONFLICT', 'This card was already refunded by another path');
          }
          throw e;
        }
        refundId = rows[0].id;
        refundIds.push(rows[0].id);
      }
      const manualIds: string[] = [];
      let manualRefundId: string | null = null;
      if (split.manual > 0) {
        try {
          const mr = await this.manual.createRow(
            tx,
            { source: 'case_excess', idempotencyKey: `case-spei:${c.id}`, customerUserId: c.customerUserId, replacementCaseId: c.id, orderId: origin.order.id, components: compManual },
            actor,
          );
          manualRefundId = mr.id;
          manualIds.push(mr.id);
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            throw BusinessException.conflict('CONFLICT', 'A SPEI refund already exists for this case');
          }
          throw e;
        }
      }
      const closed = await tx.replacementCase.updateMany({
        where: { id: c.id, status: 'open' },
        data: {
          status: 'refunded',
          resolvedAt: now,
          resolvedByUserId: actor.id,
          refundAmountCents: A,
          refundReason: reason,
          refundPaidRefCents: plan.paidReferenceCents,
          refundMarketRefCents: plan.market?.cents ?? null,
          refundMarketRefDate: plan.market?.capturedDate ? new Date(plan.market.capturedDate) : null,
          refundAboveRefConfirmed: confirmation === 'reinforced',
        },
      });
      if (closed.count !== 1) throw BusinessException.conflict('CONFLICT', 'Replacement case changed concurrently');
      // Cierre del retiro (§M4-SHIP.15.6): no depende del canal.
      const close = await this.closeWithdrawalIfEmpty(tx, c, actor);
      refundIds.push(...close.refundIds);
      // 11. bitácora.
      await this.audit(tx, actor, 'replacement_case.refunded', c.id, {
        amountCents: A,
        reason,
        paidRefCents: plan.paidReferenceCents,
        marketRefCents: plan.market?.cents ?? null,
        marketRefDate: plan.market?.capturedDate ?? null,
        aboveRefConfirmed: confirmation === 'reinforced',
        stripeCents: split.stripe,
        manualCents: split.manual,
        shipmentFeeCents: plan.shipmentFeeCents,
        refundId,
        manualRefundId,
      });
      return { outcome: 'refunded' as const, refundIds, manualIds, shipment: close.shipment };
    }, VAULT_VERB_TX_OPTIONS);
    // 12. post-commit: Stripe por fila → AV-12 de las aceptadas → AV-14 de la SPEI.
    if (result.outcome === 'refunded') {
      await this.ledger.executeAndNotify(result.refundIds, actor);
      await this.manual.notifyAnnounced(result.manualIds);
    }
    return this.refundResponse(caseId, result.outcome, actor.role, result.shipment);
  }

  private async refundResponse(caseId: string, outcome: 'refunded' | 'already_resolved', role: Role, shipment?: { status: ShipmentStatus; closed: boolean }) {
    const dto = await this.dto(this.prisma, caseId, role);
    const rows = await this.prisma.paymentRefund.findMany({
      where: { OR: [{ replacementCaseId: caseId }, ...(dto.shipment ? [{ shipmentRequestId: dto.shipment.id, kind: 'shipment_fee' as const }] : [])] },
      orderBy: { createdAt: 'asc' },
    });
    return { outcome, case: dto, refunds: await this.ledger.toDtos(rows), manualRefunds: dto.manualRefunds ?? [], ...(shipment ? { shipment } : {}) };
  }

  private async shipmentState(tx: Tx, c: CaseRow): Promise<{ status: ShipmentStatus; closed: boolean } | undefined> {
    if (!c.shipmentRequestId) return undefined;
    const s = await tx.shipmentRequest.findUniqueOrThrow({ where: { id: c.shipmentRequestId }, select: { status: true } });
    return { status: s.status, closed: false };
  }

  /**
   * §M4-SHIP.15.6 — `closeWithdrawalIfEmpty` (un cuerpo): tras resolver un caso por `refund`/`void`, si el retiro sigue
   * `picking` y no le queda ninguna línea `picked` ni caso `open` ⇒ fila `shipment_fee` + `picking → cancelado`, en el
   * MISMO acto (sin `AV-6`; el cliente recibe `AV-12`). `replace`/`found` NUNCA cierran. Solo la llaman `refund` y
   * `void`, los dos `@MoneyOut()` (candado `C-REF-1`).
   */
  private async closeWithdrawalIfEmpty(tx: Tx, c: CaseRow, actor: CaseActor): Promise<{ refundIds: string[]; shipment?: { status: ShipmentStatus; closed: boolean } }> {
    if (c.source !== 'withdrawal' || !c.shipmentRequest) return { refundIds: [] };
    const s = await tx.shipmentRequest.findUniqueOrThrow({ where: { id: c.shipmentRequest.id } });
    if (s.status !== 'picking') return { refundIds: [], shipment: { status: s.status, closed: false } };
    const [picked, open] = await Promise.all([
      tx.shipmentItem.count({ where: { shipmentRequestId: s.id, prepStatus: 'picked' } }),
      tx.replacementCase.count({ where: { shipmentRequestId: s.id, status: 'open' } }),
    ]);
    if (picked > 0 || open > 0) return { refundIds: [], shipment: { status: s.status, closed: false } };
    const refundIds: string[] = [];
    if (s.totalCents > 0) {
      const existing = await tx.paymentRefund.count({ where: { shipmentRequestId: s.id, ...NON_FAILED } });
      if (existing === 0) {
        const rows = await this.ledger.createRows(tx, [{ idempotencyKey: `ship-fee:${s.id}`, kind: 'shipment_fee', shipmentRequestId: s.id, components: shipmentFeeRefundComponents(s) }], actor, { caseId: c.id });
        refundIds.push(...rows.map((r) => r.id));
      }
    }
    const res = await tx.shipmentRequest.updateMany({ where: { id: s.id, status: 'picking' }, data: { status: 'cancelado' } });
    if (res.count !== 1) throw BusinessException.conflict('CONFLICT', 'Shipment changed concurrently');
    await tx.auditLog.create({
      data: {
        actorUserId: actor.id,
        actorRole: actor.role,
        action: 'shipment.closed_nothing_to_ship',
        entityType: 'ShipmentRequest',
        entityId: s.id,
        after: { caseId: c.id, shipmentFeeRefundIds: refundIds },
      },
    });
    return { refundIds, shipment: { status: 'cancelado', closed: true } };
  }

  // ================================================================ void (§M4-SHIP.15.10)

  async void(caseId: string, body: { note: string }, actor: CaseActor): Promise<{ outcome: 'voided' | 'already_resolved'; case: ReplacementCaseDTO; shipment?: { status: ShipmentStatus; closed: boolean } }> {
    const head = await this.prisma.replacementCase.findUnique({ where: { id: caseId }, select: { id: true, customerUserId: true, source: true, shipmentRequestId: true } });
    if (!head) throw BusinessException.notFound('NOT_FOUND', 'Replacement case not found');
    const note = body.note.trim();
    const result = await this.prisma.$transaction(async (tx) => {
      const c = await this.lockCase(tx, head);
      const now = new Date();
      if (c.status !== 'open') {
        if (c.status === 'voided') return { outcome: 'already_resolved' as const, refundIds: [] as string[], shipment: await this.shipmentState(tx, c) };
        throw this.notOpen(c);
      }
      const originStatus = await this.lockOriginOrder(tx, c);
      if (originStatus === 'settled') {
        throw BusinessException.conflict('CASE_NOT_VOIDABLE', 'The origin order is still settled', { originStatus: 'settled' });
      }
      await this.lockPieces(tx, [c.originalInventoryItem.id]);
      await this.originalToPlatform(tx, c, actor, `anulada · caso ${c.id}`);
      const closed = await tx.replacementCase.updateMany({
        where: { id: c.id, status: 'open' },
        data: { status: 'voided', resolvedAt: now, resolvedByUserId: actor.id, voidNote: note },
      });
      if (closed.count !== 1) throw BusinessException.conflict('CONFLICT', 'Replacement case changed concurrently');
      const close = await this.closeWithdrawalIfEmpty(tx, c, actor);
      await this.audit(tx, actor, 'replacement_case.voided', c.id, { note, originStatus, shipmentFeeRefundIds: close.refundIds });
      return { outcome: 'voided' as const, refundIds: close.refundIds, shipment: close.shipment };
    }, VAULT_VERB_TX_OPTIONS);
    if (result.refundIds.length > 0) await this.ledger.executeAndNotify(result.refundIds, actor);
    return { outcome: result.outcome, case: await this.dto(this.prisma, caseId, actor.role), ...(result.shipment ? { shipment: result.shipment } : {}) };
  }
}
