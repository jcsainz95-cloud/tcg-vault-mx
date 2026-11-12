import { Injectable } from '@nestjs/common';
import { Finish, Prisma, SupplyRequestStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { SupplyPricingService } from './supply-pricing.service';
import { DEFAULT_PCT_BPS, REQUEST_TTL_MS, SUPPLY_SETTINGS_ID, effectiveUnitCents } from './supply.constants';
import { CreateSupplyRequestDto, PatchSupplyRequestDto, pageOf } from './supply.dto';
import { CardWithSet, requestAdminView, requestSupplierView } from './supply-views';

const WITH_CARD = { card: { include: { set: true } } } as const;

@Injectable()
export class SupplyRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: SupplyPricingService,
  ) {}

  async defaultPctBps(): Promise<number> {
    const s = await this.prisma.supplySettings.findUnique({ where: { id: SUPPLY_SETTINGS_ID } });
    return s?.defaultPctBps ?? DEFAULT_PCT_BPS;
  }

  async marketCheck(cardId: string, finish: string) {
    const card = await this.prisma.card.findUnique({ where: { id: cardId } });
    if (!card) throw new BusinessException('CARD_NOT_FOUND', 404, 'Card not found');
    if (!(card.availableFinishes as string[]).includes(finish)) throw BusinessException.badRequest('FINISH_NOT_AVAILABLE', 'Finish not available');
    const marketCents = await this.pricing.marketCents(cardId, finish as Finish);
    const defaultPctBps = await this.defaultPctBps();
    return {
      cardId, finish, marketCents, hasMarket: marketCents != null, capCents: marketCents, defaultPctBps,
      suggestedUnitCents: effectiveUnitCents({ pctBps: defaultPctBps, fixedCents: null }, marketCents),
    };
  }

  async create(dto: CreateSupplyRequestDto, actorId: string) {
    const card = await this.prisma.card.findUnique({ where: { id: dto.cardId } });
    if (!card) throw new BusinessException('CARD_NOT_FOUND', 404, 'Card not found');
    if (!(card.availableFinishes as string[]).includes(dto.finish)) throw BusinessException.badRequest('FINISH_NOT_AVAILABLE', 'Finish not available');
    const market = await this.pricing.marketCents(dto.cardId, dto.finish);
    let pctBps: number | null = null;
    let fixedCents: number | null = null;
    if (market == null) {
      if (dto.fixedUnitCents == null) throw BusinessException.validation('FIXED_PRICE_REQUIRED', 'No market price: a fixed unit price is required');
      fixedCents = dto.fixedUnitCents;
    } else {
      pctBps = dto.pctBps ?? (dto.fixedUnitCents == null ? await this.defaultPctBps() : null);
      fixedCents = dto.fixedUnitCents ?? null;
      if (pctBps != null && pctBps > 10000) throw BusinessException.validation('ABOVE_MARKET_CAP', 'Percentage above 100% of market');
    }
    const unit = effectiveUnitCents({ pctBps, fixedCents }, market);
    if (unit == null) throw BusinessException.validation('FIXED_PRICE_REQUIRED', 'Price resolves to zero: use a fixed unit price');
    this.pricing.assertWithinCap(unit, market);
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : new Date(Date.now() + REQUEST_TTL_MS);
    if (expiresAt.getTime() <= Date.now()) throw BusinessException.badRequest('VALIDATION_ERROR', 'expiresAt must be in the future');
    const r = await this.prisma.supplyRequest.create({
      data: { cardId: dto.cardId, finish: dto.finish, minCondition: dto.minCondition, qtyWanted: dto.qty, pctBps, fixedCents, expiresAt, createdById: actorId, source: 'manual' },
      include: WITH_CARD,
    });
    return requestAdminView(r, { unitCents: unit, marketCents: market, offersCount: 0, bestOfferUnitCents: null });
  }

  async patch(id: string, dto: PatchSupplyRequestDto) {
    if (dto.status === undefined && dto.qtyWanted === undefined && dto.pctBps === undefined && dto.fixedUnitCents === undefined && dto.expiresAt === undefined) {
      throw BusinessException.badRequest('VALIDATION_ERROR', 'At least one field is required');
    }
    if (dto.pctBps !== undefined && dto.fixedUnitCents !== undefined) {
      throw BusinessException.badRequest('VALIDATION_ERROR', 'pctBps and fixedUnitCents are mutually exclusive');
    }
    const r = await this.prisma.supplyRequest.findUnique({ where: { id }, include: WITH_CARD });
    if (!r) throw BusinessException.notFound();
    if (r.status !== 'open') throw BusinessException.conflict('INVALID_STATE', `Request is ${r.status}`);
    const market = await this.pricing.marketCents(r.cardId, r.finish);

    let pctBps = r.pctBps;
    let fixedCents = r.fixedCents;
    if (dto.pctBps !== undefined) {
      if (market == null) throw BusinessException.validation('NO_MARKET', 'No market price: percentage cannot be set');
      if (dto.pctBps > 10000) throw BusinessException.validation('ABOVE_MARKET_CAP', 'Percentage above 100% of market');
      pctBps = dto.pctBps;
      if (dto.fixedUnitCents === undefined) fixedCents = null; // solo %: vuelve del precio fijo al %
    }
    if (dto.fixedUnitCents !== undefined) {
      fixedCents = dto.fixedUnitCents;
      if (dto.pctBps === undefined) pctBps = null; // solo fijo: el % deja de aplicar (un solo modo de precio a la vez)
    }
    const priceTouched = dto.pctBps !== undefined || dto.fixedUnitCents !== undefined;
    const unit = effectiveUnitCents({ pctBps, fixedCents }, market);
    if (priceTouched) {
      if (unit == null) throw BusinessException.validation('NO_MARKET', 'Price cannot be resolved without a market');
      this.pricing.assertWithinCap(unit, market);
    }
    if (dto.qtyWanted !== undefined && dto.qtyWanted < r.qtyReserved) {
      throw BusinessException.validation('QTY_BELOW_RESERVED', 'Quantity below reserved', { qtyReserved: r.qtyReserved });
    }
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : undefined;
    if (expiresAt && expiresAt.getTime() <= Date.now()) throw BusinessException.badRequest('VALIDATION_ERROR', 'expiresAt must be in the future');

    await this.prisma.$transaction(async (tx) => {
      const qtyWanted = dto.qtyWanted ?? r.qtyWanted;
      let status: SupplyRequestStatus = dto.status === 'closed' ? 'closed' : qtyWanted === r.qtyReserved ? 'filled' : 'open';
      const upd = await tx.supplyRequest.updateMany({
        // CAS: la fila no cambió de estado ni de reservado bajo nuestros pies.
        where: { id, status: 'open', qtyReserved: dto.qtyWanted !== undefined ? { lte: qtyWanted } : undefined },
        data: { qtyWanted, status, pctBps, fixedCents, ...(expiresAt ? { expiresAt } : {}) },
      });
      if (upd.count !== 1) throw BusinessException.conflict('INVALID_STATE', 'Request changed concurrently');
      if (dto.status === 'closed') {
        const open = await tx.supplyOffer.findMany({ where: { requestId: id, status: { in: ['open', 'countered'] } }, select: { id: true } });
        if (open.length) {
          await tx.supplyOffer.updateMany({ where: { id: { in: open.map((o) => o.id) }, status: { in: ['open', 'countered'] } }, data: { status: 'expired' } });
          await tx.supplyOfferEvent.createMany({ data: open.map((o) => ({ offerId: o.id, actor: 'system', action: 'request_closed' })) });
        }
        status = 'closed';
      }
    });
    return this.getAdmin(id);
  }

  private async bestOffer(requestId: string): Promise<{ count: number; best: number | null }> {
    const open = await this.prisma.supplyOffer.findMany({ where: { requestId, status: { in: ['open', 'countered'] } }, orderBy: [{ unitCents: 'asc' }, { createdAt: 'asc' }], take: 1 });
    const count = await this.prisma.supplyOffer.count({ where: { requestId } });
    return { count, best: open[0]?.unitCents ?? null };
  }

  private async adminRow(r: Prisma.SupplyRequestGetPayload<{ include: typeof WITH_CARD }>) {
    const market = await this.pricing.marketCents(r.cardId, r.finish);
    const { count, best } = await this.bestOffer(r.id);
    return requestAdminView(r, { unitCents: effectiveUnitCents(r, market), marketCents: market, offersCount: count, bestOfferUnitCents: best });
  }

  async getAdmin(id: string) {
    const r = await this.prisma.supplyRequest.findUnique({ where: { id }, include: WITH_CARD });
    if (!r) throw BusinessException.notFound();
    return this.adminRow(r);
  }

  async listAdmin(q: { status?: string; q?: string; page?: string; pageSize?: string }) {
    const { page, pageSize, skip } = pageOf(q);
    const where: Prisma.SupplyRequestWhereInput = {};
    if (q.status && ['open', 'filled', 'closed', 'expired'].includes(q.status)) where.status = q.status as SupplyRequestStatus;
    if (q.q?.trim()) where.card = { name: { contains: q.q.trim(), mode: 'insensitive' } };
    const [rows, total] = await Promise.all([
      this.prisma.supplyRequest.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: pageSize, include: WITH_CARD }),
      this.prisma.supplyRequest.count({ where }),
    ]);
    return { data: await Promise.all(rows.map((r) => this.adminRow(r))), page, pageSize, total };
  }

  // ---------------- lado proveedor: SOLO pesos por pieza ----------------

  /** Precio visible al proveedor, o null si no hay precio válido (sin mercado ni fijo, o por encima del tope). */
  async supplierUnit(r: { cardId: string; finish: Finish; pctBps: number | null; fixedCents: number | null }): Promise<number | null> {
    const market = await this.pricing.marketCents(r.cardId, r.finish);
    const unit = effectiveUnitCents(r, market);
    if (unit == null || (market != null && unit > market)) return null;
    return unit;
  }

  async listForSupplier(supplierId: string, q: { q?: string; page?: string; pageSize?: string }) {
    const { page, pageSize, skip } = pageOf(q);
    const where: Prisma.SupplyRequestWhereInput = { status: 'open', expiresAt: { gt: new Date() } };
    if (q.q?.trim()) where.card = { name: { contains: q.q.trim(), mode: 'insensitive' } };
    const rows = await this.prisma.supplyRequest.findMany({ where, orderBy: { createdAt: 'desc' }, include: WITH_CARD });
    const mine = await this.prisma.supplyOffer.findMany({ where: { supplierId, requestId: { in: rows.map((r) => r.id) } }, orderBy: { createdAt: 'desc' } });
    const visible: ReturnType<typeof requestSupplierView>[] = [];
    for (const r of rows) {
      if (r.qtyWanted - r.qtyReserved <= 0) continue;
      const unit = await this.supplierUnit(r);
      if (unit == null) continue;
      visible.push(requestSupplierView(r as typeof r & { card: CardWithSet }, unit, mine.find((o) => o.requestId === r.id)?.status ?? null));
    }
    return { data: visible.slice(skip, skip + pageSize), page, pageSize, total: visible.length };
  }

  async getForSupplier(supplierId: string, id: string) {
    const r = await this.prisma.supplyRequest.findUnique({ where: { id }, include: WITH_CARD });
    if (!r) throw BusinessException.notFound();
    const mine = await this.prisma.supplyOffer.findFirst({ where: { supplierId, requestId: id }, orderBy: { createdAt: 'desc' } });
    const live = r.status === 'open' && r.expiresAt.getTime() > Date.now();
    if (!live && !mine) throw BusinessException.notFound();
    const unit = (await this.supplierUnit(r)) ?? mine?.unitCents ?? null;
    if (unit == null) throw BusinessException.notFound();
    return requestSupplierView(r, unit, mine?.status ?? null);
  }
}
