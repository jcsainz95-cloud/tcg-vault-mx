import { Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { runSerializable } from '../../common/serializable-retry';
import { AuditService } from '../audit/audit.service';
import { SupplierAccessService } from './supplier-access.service';
import { SupplyPricingService } from './supply-pricing.service';
import { SupplyRequestService } from './supply-request.service';
import { OFFER_TTL_MS, PICKUP_TTL_MS, conditionAtLeast, effectiveUnitCents } from './supply.constants';
import { AdminRespondDto, CreateSupplyOfferDto, SupplierRespondDto, pageOf } from './supply.dto';
import { offerAdminView, offerSupplierView, purchaseView } from './supply-views';

const OFFER_INCLUDE = { request: { include: { card: { include: { set: true } } } }, purchase: { select: { id: true } } } as const;
const OFFER_ADMIN_INCLUDE = { ...OFFER_INCLUDE, supplier: { select: { id: true, businessName: true } } } as const;
const LIVE = ['open', 'countered'] as const;

@Injectable()
export class SupplyOfferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: SupplyPricingService,
    private readonly requests: SupplyRequestService,
    private readonly audit: AuditService,
    private readonly access: SupplierAccessService,
  ) {}

  private supplierIdOf(userId: string): Promise<string> {
    return this.access.supplierIdOfUser(userId);
  }

  async create(userId: string, requestId: string, dto: CreateSupplyOfferDto, key?: string) {
    const supplierId = await this.supplierIdOf(userId);
    if (key) {
      const prev = await this.prisma.supplyOffer.findFirst({ where: { supplierId, idempotencyKey: key }, include: OFFER_INCLUDE });
      if (prev) return offerSupplierView(prev);
    }
    const r = await this.prisma.supplyRequest.findUnique({ where: { id: requestId } });
    if (!r) throw BusinessException.notFound();
    if (r.status === 'closed') throw BusinessException.conflict('REQUEST_NOT_OPEN', 'Request is not open');
    if (r.status === 'expired' || r.expiresAt.getTime() <= Date.now()) throw new BusinessException('REQUEST_EXPIRED', 410, 'Request expired');
    const qtyOpen = r.qtyWanted - r.qtyReserved;
    if (r.status === 'filled' || qtyOpen <= 0) throw BusinessException.conflict('COVERED', 'Request already covered');
    const unit = await this.requests.supplierUnit(r);
    if (unit == null) throw BusinessException.conflict('REQUEST_NOT_OPEN', 'Request is not open');
    if (dto.unitCents !== undefined && dto.unitCents !== unit) {
      throw BusinessException.validation('COUNTER_NOT_ENABLED', 'Counter-offers are not enabled yet');
    }
    if (!conditionAtLeast(dto.condition, r.minCondition)) throw BusinessException.validation('CONDITION_BELOW_MIN', 'Condition below the minimum');
    if (dto.qty > qtyOpen) throw BusinessException.validation('QTY_EXCEEDS_OPEN', 'Quantity exceeds what is still open', { qtyOpen });
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const o = await tx.supplyOffer.create({
          data: {
            requestId, supplierId, qty: dto.qty, condition: dto.condition, unitCents: unit,
            expiresAt: new Date(Date.now() + OFFER_TTL_MS), idempotencyKey: key ?? null,
          },
          include: OFFER_INCLUDE,
        });
        await tx.supplyOfferEvent.create({ data: { offerId: o.id, actor: 'supplier', actorUserId: userId, action: 'offered', qty: o.qty, unitCents: o.unitCents } });
        return o;
      });
      return offerSupplierView(created);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw BusinessException.conflict('ALREADY_OFFERED', 'You already have an open offer on this request');
      }
      throw e;
    }
  }

  async listForSupplier(userId: string, q: { status?: string; page?: string; pageSize?: string }) {
    const supplierId = await this.supplierIdOf(userId);
    const { page, pageSize, skip } = pageOf(q);
    const where: Prisma.SupplyOfferWhereInput = { supplierId };
    if (q.status && ['open', 'countered', 'accepted', 'rejected', 'withdrawn', 'expired'].includes(q.status)) where.status = q.status as 'open';
    const [rows, total] = await Promise.all([
      this.prisma.supplyOffer.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: pageSize, include: OFFER_INCLUDE }),
      this.prisma.supplyOffer.count({ where }),
    ]);
    return { data: rows.map(offerSupplierView), page, pageSize, total };
  }

  async getForSupplier(userId: string, id: string) {
    const supplierId = await this.supplierIdOf(userId);
    const o = await this.prisma.supplyOffer.findFirst({ where: { id, supplierId }, include: { ...OFFER_INCLUDE, events: { orderBy: { createdAt: 'asc' } } } });
    if (!o) throw BusinessException.notFound();
    return {
      ...offerSupplierView(o),
      events: o.events.map((e) => ({ at: e.createdAt, actor: e.actor === 'supplier' ? 'supplier' : e.actor === 'system' ? 'system' : 'owner', action: e.action, unitCents: e.unitCents, qty: e.qty })),
    };
  }

  async supplierRespond(userId: string, id: string, dto: SupplierRespondDto) {
    const supplierId = await this.supplierIdOf(userId);
    const o = await this.prisma.supplyOffer.findFirst({ where: { id, supplierId } });
    if (!o) throw BusinessException.notFound();
    if (dto.action !== 'withdraw') throw BusinessException.validation('COUNTER_NOT_ENABLED', 'Counter-offers are not enabled yet');
    if (o.status === 'expired' || (LIVE.includes(o.status as 'open') && o.expiresAt.getTime() <= Date.now())) {
      throw new BusinessException('OFFER_EXPIRED', 410, 'Offer expired');
    }
    await this.prisma.$transaction(async (tx) => {
      const c = await tx.supplyOffer.updateMany({ where: { id, supplierId, status: { in: [...LIVE] } }, data: { status: 'withdrawn', lastActor: 'supplier', version: { increment: 1 } } });
      if (c.count !== 1) throw BusinessException.conflict('INVALID_STATE', 'Offer is no longer open');
      await tx.supplyOfferEvent.create({ data: { offerId: id, actor: 'supplier', actorUserId: userId, action: 'withdrawn' } });
    });
    return this.getForSupplier(userId, id);
  }

  // ---------------- dueño / staff ----------------

  async listAdmin(q: { status?: string; requestId?: string; supplierId?: string; page?: string; pageSize?: string }) {
    const { page, pageSize, skip } = pageOf(q);
    const where: Prisma.SupplyOfferWhereInput = {};
    if (q.status && ['open', 'countered', 'accepted', 'rejected', 'withdrawn', 'expired'].includes(q.status)) where.status = q.status as 'open';
    if (q.requestId) where.requestId = q.requestId;
    if (q.supplierId) where.supplierId = q.supplierId;
    const [rows, total] = await Promise.all([
      this.prisma.supplyOffer.findMany({ where, orderBy: [{ unitCents: 'asc' }, { createdAt: 'asc' }], skip, take: pageSize, include: OFFER_ADMIN_INCLUDE }),
      this.prisma.supplyOffer.count({ where }),
    ]);
    const out = [];
    const bestByReq = new Map<string, string>();
    for (const o of rows) {
      if (!bestByReq.has(o.requestId)) {
        const best = await this.prisma.supplyOffer.findFirst({ where: { requestId: o.requestId, status: { in: [...LIVE] } }, orderBy: [{ unitCents: 'asc' }, { createdAt: 'asc' }], select: { id: true } });
        bestByReq.set(o.requestId, best?.id ?? '');
      }
      const market = await this.pricing.marketCents(o.request.cardId, o.request.finish);
      out.push(offerAdminView(o, { marketCents: market, isBest: bestByReq.get(o.requestId) === o.id }));
    }
    return { data: out, page, pageSize, total };
  }

  async adminRespond(id: string, dto: AdminRespondDto, actorId: string) {
    if (dto.action === 'counter') throw BusinessException.validation('COUNTER_NOT_ENABLED', 'Counter-offers are not enabled yet');
    const o = await this.prisma.supplyOffer.findUnique({ where: { id }, include: OFFER_ADMIN_INCLUDE });
    if (!o) throw BusinessException.notFound();
    if (o.status === 'expired' || (o.status === 'open' && o.expiresAt.getTime() <= Date.now())) throw new BusinessException('OFFER_EXPIRED', 410, 'Offer expired');
    if (o.status !== 'open') throw BusinessException.conflict('INVALID_STATE', `Offer is ${o.status}`);

    if (dto.action === 'reject') {
      await this.prisma.$transaction(async (tx) => {
        const c = await tx.supplyOffer.updateMany({ where: { id, status: 'open' }, data: { status: 'rejected', lastActor: 'owner', version: { increment: 1 } } });
        if (c.count !== 1) throw BusinessException.conflict('INVALID_STATE', 'Offer is no longer open');
        await tx.supplyOfferEvent.create({ data: { offerId: id, actor: 'owner', actorUserId: actorId, action: 'rejected' } });
      });
      return { offer: await this.adminOffer(id) };
    }

    // ---- accept: TOPE DURO + reserva atómica ----
    const req = o.request;
    const market = await this.pricing.marketCents(req.cardId, req.finish);
    if (market == null && req.fixedCents == null) throw BusinessException.validation('NO_MARKET', 'No market price and no fixed price');
    // El precio vigente de la solicitud manda (las ofertas abiertas al precio viejo se recalculan al responder).
    const unit = effectiveUnitCents(req, market);
    if (unit == null) throw BusinessException.validation('NO_MARKET', 'Price cannot be resolved');
    this.pricing.assertWithinCap(unit, market);

    const purchase = await runSerializable(this.prisma, async (tx) => {
      const now = new Date();
      const claim = await tx.supplyOffer.updateMany({ where: { id, status: 'open', expiresAt: { gt: now } }, data: { status: 'accepted', lastActor: 'owner', unitCents: unit, version: { increment: 1 } } });
      if (claim.count !== 1) throw BusinessException.conflict('INVALID_STATE', 'Offer is no longer open');
      // Cero sobreventa: el UPDATE condicionado decide. status/expiry también se comprueban aquí.
      const reserved = await tx.$executeRaw`
        UPDATE "SupplyRequest"
        SET "qtyReserved" = "qtyReserved" + ${o.qty},
            "status" = CASE WHEN "qtyReserved" + ${o.qty} >= "qtyWanted" THEN 'filled'::"SupplyRequestStatus" ELSE "status" END,
            "updatedAt" = ${now}
        WHERE "id" = ${req.id} AND "status" = 'open'::"SupplyRequestStatus" AND "expiresAt" > ${now}
          AND "qtyWanted" - "qtyReserved" >= ${o.qty}`;
      if (reserved !== 1) {
        const fresh = await tx.supplyRequest.findUnique({ where: { id: req.id }, select: { status: true, qtyWanted: true, qtyReserved: true, expiresAt: true } });
        if (fresh && (fresh.status === 'closed' || fresh.status === 'expired' || fresh.expiresAt <= now)) {
          throw BusinessException.conflict('INVALID_STATE', 'Request is no longer open');
        }
        throw BusinessException.conflict('COVERED', 'Request already covered', { qtyOpen: fresh ? Math.max(0, fresh.qtyWanted - fresh.qtyReserved) : 0 });
      }
      await tx.supplyOfferEvent.create({ data: { offerId: id, actor: 'owner', actorUserId: actorId, action: 'accepted', qty: o.qty, unitCents: unit } });
      return tx.supplyPurchase.create({
        data: {
          offerId: id, supplierId: o.supplierId, requestId: req.id, cardId: req.cardId, finish: req.finish,
          qty: o.qty, agreedUnitCents: unit, pickupDueAt: new Date(now.getTime() + PICKUP_TTL_MS),
        },
        include: { units: true, supplier: { select: { id: true, businessName: true } } },
      });
    }, { label: 'supply-accept' });
    await this.audit.log({ actorUserId: actorId, actorRole: Role.super_admin, action: 'supply.offer.accept', entityType: 'SupplyOffer', entityId: id, after: { unitCents: unit, qty: o.qty } });
    return { offer: await this.adminOffer(id), purchase: purchaseView(purchase, req.card, 'admin') };
  }

  private async adminOffer(id: string) {
    const o = await this.prisma.supplyOffer.findUniqueOrThrow({ where: { id }, include: OFFER_ADMIN_INCLUDE });
    const market = await this.pricing.marketCents(o.request.cardId, o.request.finish);
    return offerAdminView(o, { marketCents: market, isBest: false });
  }

  /** Para GET /admin/supply-requests/:id: ofertas de la solicitud, mejor primero (precio más bajo, luego primera). */
  async offersOfRequest(requestId: string) {
    const rows = await this.prisma.supplyOffer.findMany({ where: { requestId }, orderBy: [{ unitCents: 'asc' }, { createdAt: 'asc' }], include: OFFER_ADMIN_INCLUDE });
    const best = rows.find((o) => (LIVE as readonly string[]).includes(o.status));
    const out = [];
    for (const o of rows) {
      const market = await this.pricing.marketCents(o.request.cardId, o.request.finish);
      out.push(offerAdminView(o, { marketCents: market, isBest: best?.id === o.id }));
    }
    return out;
  }
}
