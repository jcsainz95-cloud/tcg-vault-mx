import { Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { BusinessException } from '../../common/business.exception';

function range(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
  if (!from && !to) return undefined;
  return { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) };
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  // ---------------- M6 Users ----------------

  async listUsers(q: string | undefined, status: string | undefined, page: number, pageSize: number) {
    const where: Prisma.UserWhereInput = {};
    if (status) where.status = status as never;
    if (q) where.OR = [{ email: { contains: q, mode: 'insensitive' } }, { name: { contains: q, mode: 'insensitive' } }];
    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: { id: true, email: true, name: true, role: true, status: true, createdAt: true },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);
    return { data, page, pageSize, total };
  }

  /** Ficha 360° (compras, bóveda, buylist, disputas, KYC). API_CONTRACT §M6. */
  async getUser(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        kycProfile: true,
        billingProfile: true,
        addresses: true,
        orders: { orderBy: { createdAt: 'desc' }, take: 20 },
        sellRequests: { orderBy: { createdAt: 'desc' }, take: 20 },
        disputes: { orderBy: { createdAt: 'desc' }, take: 20 },
        ownedItems: { select: { id: true, folio: true, status: true, ownershipStatus: true } },
      },
    });
    if (!user) throw BusinessException.notFound();
    const { passwordHash: _pw, ...safe } = user;
    return safe;
  }

  async updateUserKyc(
    id: string,
    kycStatus: string,
    capPerRequestCents?: number,
    capPerMonthCents?: number,
    verifiedBy?: string,
  ) {
    return this.prisma.kycProfile.upsert({
      where: { userId: id },
      create: {
        userId: id,
        kycStatus: kycStatus as never,
        capPerRequestCentsOverride: capPerRequestCents,
        capPerMonthCentsOverride: capPerMonthCents,
        verifiedBy,
        verifiedAt: kycStatus === 'verified' ? new Date() : undefined,
      },
      update: {
        kycStatus: kycStatus as never,
        capPerRequestCentsOverride: capPerRequestCents,
        capPerMonthCentsOverride: capPerMonthCents,
        verifiedBy,
        verifiedAt: kycStatus === 'verified' ? new Date() : undefined,
      },
    });
  }

  async updateUserStatus(id: string, status: 'active' | 'blocked') {
    return this.prisma.user.update({ where: { id }, data: { status } });
  }

  // ---------------- M7 Finance ----------------

  /** P&L: ingresos + envío − costo de lo vendido − comisiones Stripe = ganancia. */
  async pnl(from?: string, to?: string) {
    const createdAt = range(from, to);
    const settledOrders = await this.prisma.order.findMany({
      where: { status: 'settled', ...(createdAt ? { settledAt: createdAt } : {}) },
      include: { items: { include: { inventoryItem: true } } },
    });
    let incomeCents = 0;
    let stripeFeesCents = 0;
    let cogsCents = 0;
    for (const o of settledOrders) {
      incomeCents += o.subtotalCents;
      stripeFeesCents += o.processingFeeCents;
      for (const it of o.items) {
        cogsCents += it.inventoryItem.acquisitionCostCents ?? 0;
      }
    }
    const shipments = await this.prisma.shipmentRequest.findMany({
      where: { status: { in: ['picking', 'guia', 'enviado', 'entregado'] } },
    });
    let shippingCents = 0;
    for (const s of shipments) {
      shippingCents += s.shippingFeeCents;
      stripeFeesCents += s.processingFeeCents;
    }
    const profitCents = incomeCents + shippingCents - cogsCents - stripeFeesCents;
    return { incomeCents, shippingCents, cogsCents, stripeFeesCents, profitCents };
  }

  async inventoryValue() {
    const items = await this.prisma.inventoryItem.findMany({
      where: { ownerType: 'platform', status: { in: ['in_stock', 'listed', 'reserved'] } },
      include: { card: true },
    });
    let atReferenceCents = 0;
    let atCostCents = 0;
    let pendingPriceCount = 0;
    for (const item of items) {
      atCostCents += item.acquisitionCostCents ?? 0;
      const gradeKey = this.pricing.gradeKeyFor(item);
      const ref = await this.pricing.getReference(item.cardId, item.productType, gradeKey);
      if (ref.status === 'priced' && ref.referenceMxnCents != null) {
        atReferenceCents += ref.referenceMxnCents;
      } else {
        pendingPriceCount += 1;
      }
    }
    return { atReferenceCents, atCostCents, pendingPriceCount };
  }

  async custodyValue() {
    const items = await this.prisma.inventoryItem.findMany({
      where: { ownerType: 'customer' },
    });
    let totalCustodyValueCents = 0;
    for (const item of items) {
      const gradeKey = this.pricing.gradeKeyFor(item);
      const ref = await this.pricing.getReference(item.cardId, item.productType, gradeKey);
      if (ref.status === 'priced' && ref.referenceMxnCents != null) {
        totalCustodyValueCents += ref.referenceMxnCents;
      }
    }
    return { totalCustodyValueCents };
  }

  async ivaReport(from?: string, to?: string) {
    const settledAt = range(from, to);
    const orders = await this.prisma.order.findMany({
      where: { status: { in: ['settled', 'refunded', 'chargeback'] }, ...(settledAt ? { settledAt } : {}) },
      select: { id: true, ivaCents: true, settledAt: true, status: true },
    });
    const ivaCollectedCents = orders
      .filter((o) => o.status === 'settled')
      .reduce((s, o) => s + o.ivaCents, 0);
    return { ivaCollectedCents, byOrder: orders };
  }

  async exportCsv(report: string, from?: string, to?: string): Promise<string> {
    if (report === 'pnl') {
      const p = await this.pnl(from, to);
      return `report,incomeCents,shippingCents,cogsCents,stripeFeesCents,profitCents\npnl,${p.incomeCents},${p.shippingCents},${p.cogsCents},${p.stripeFeesCents},${p.profitCents}\n`;
    }
    if (report === 'iva') {
      const iva = await this.ivaReport(from, to);
      const rows = iva.byOrder.map((o) => `${o.id},${o.ivaCents},${o.status}`).join('\n');
      return `orderId,ivaCents,status\n${rows}\n`;
    }
    // inventory
    const inv = await this.inventoryValue();
    return `atReferenceCents,atCostCents,pendingPriceCount\n${inv.atReferenceCents},${inv.atCostCents},${inv.pendingPriceCount}\n`;
  }

  // ---------------- M9 Reports ----------------

  async launchMetrics(from?: string, to?: string) {
    const createdAt = range(from, to);
    const [users, salesSettled, buylistPaid, withdrawalsNoDispute] = await Promise.all([
      this.prisma.user.count({ where: { role: 'customer', ...(createdAt ? { createdAt } : {}) } }),
      this.prisma.order.count({ where: { status: 'settled' } }),
      this.prisma.sellRequest.count({ where: { status: 'pagada' } }),
      this.prisma.shipmentRequest.count({ where: { status: 'entregado' } }),
    ]);
    return {
      users,
      salesSettled,
      buylistPaid,
      withdrawalsNoDispute,
      goals: { N: null, X: null, Y: null, Z: null },
    };
  }

  // ---------------- Dashboard (8 tarjetas) ----------------

  async dashboard(role: Role) {
    const isSuperAdmin = role === Role.super_admin;
    const [salesCount, salesAgg, shipmentsQueue, buylistQueue, disputesQueue, pendingPrices, buylistPeriodAgg, buylistPeriodCount, lastSync, lastFx, users, salesSettled, buylistPaid, withdrawals] =
      await Promise.all([
        this.prisma.order.count({ where: { status: 'settled' } }),
        this.prisma.order.aggregate({ where: { status: 'settled' }, _sum: { totalCents: true } }),
        this.prisma.shipmentRequest.count({ where: { status: { in: ['solicitado', 'picking', 'guia'] } } }),
        this.prisma.sellRequest.count({ where: { status: { in: ['cotizada', 'recibida', 'verificacion', 'aprobada'] } } }),
        this.prisma.dispute.count({ where: { status: { in: ['abierta', 'en_revision'] } } }),
        this.prisma.pendingPriceEntry.count({ where: { status: 'open' } }),
        this.prisma.sellRequest.aggregate({ where: { status: 'pagada' }, _sum: { approvedTotalCents: true } }),
        this.prisma.sellRequest.count({ where: { status: 'pagada' } }),
        this.prisma.priceReference.findFirst({ orderBy: { createdAt: 'desc' } }),
        this.prisma.fxRate.findFirst({ orderBy: { createdAt: 'desc' } }),
        this.prisma.user.count({ where: { role: 'customer' } }),
        this.prisma.order.count({ where: { status: 'settled' } }),
        this.prisma.sellRequest.count({ where: { status: 'pagada' } }),
        this.prisma.shipmentRequest.count({ where: { status: 'entregado' } }),
      ]);

    const pnl = isSuperAdmin ? await this.pnl() : null;
    const invValue = isSuperAdmin ? await this.inventoryValue() : null;
    const custody = isSuperAdmin ? await this.custodyValue() : null;

    const card = {
      salesPeriod: { count: salesCount, amountCents: salesAgg._sum.totalCents ?? 0 },
      workQueue: {
        shipments: shipmentsQueue,
        buylist: buylistQueue,
        disputes: disputesQueue,
        pendingPrices,
      },
      buylistPeriod: { count: buylistPeriodCount, amountCents: buylistPeriodAgg._sum.approvedTotalCents ?? 0 },
      dataHealth: {
        pendingPriceCount: pendingPrices,
        lastPriceSyncAt: lastSync?.createdAt ?? null,
        lastFxAt: lastFx?.createdAt ?? null,
      },
      launchProgress: { users, salesSettled, buylistPaid, withdrawalsNoDispute: withdrawals },
    };

    // Campos de dinero solo para super_admin (se omiten para vault_operator).
    if (isSuperAdmin) {
      return {
        profitPeriodCents: pnl!.profitCents,
        ...card,
        inventoryValueCents: invValue!.atReferenceCents,
        custodyValueCents: custody!.totalCustodyValueCents,
      };
    }
    return card;
  }
}
