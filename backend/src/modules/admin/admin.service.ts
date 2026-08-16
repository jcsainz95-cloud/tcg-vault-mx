import { Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { PiiCryptoService } from '../../common/crypto/pii-crypto.service';
import { maskClabe, maskRfc } from '../../common/crypto/pii-mask';
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
    private readonly pii: PiiCryptoService,
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

  /**
   * Ficha 360° (compras, bóveda, buylist, disputas, KYC). API_CONTRACT §M6.
   *
   * PII cifrada en reposo: la CLABE y el RFC se descifran y se devuelven SIEMPRE
   * ENMASCARADOS (nunca en claro), incluso para `super_admin`. La CLABE en claro solo
   * se obtiene por el endpoint dedicado `reveal-clabe` (money-out + auditado) al pagar SPEI.
   *
   * SEC-A4: segregación de funciones. El `vault_operator` es un rol de menor confianza
   * (opera M1/M4/M5 hasta verificación; sin finanzas/config). NO debe ver PII bancaria/
   * fiscal/identidad. Se le entrega una proyección REDUCIDA: CLABE enmascarada; RFC e INE
   * keys omitidos; billingProfile omitido. El `super_admin` ve CLABE/RFC enmascarados +
   * INE keys (para servir la imagen por presigned GET) + billingProfile con RFC enmascarado.
   */
  async getUser(id: string, role?: Role) {
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
    const clabeMasked = maskClabe(this.pii.decryptOptional(safe.kycProfile?.clabeEnc));

    if (role === Role.super_admin) {
      // super_admin: ficha completa PERO con CLABE/RFC enmascarados (nunca en claro).
      return {
        ...safe,
        kycProfile: safe.kycProfile
          ? (() => {
              const {
                clabeEnc: _c,
                rfcEnc: _r,
                clabeHmac: _h,
                capPerRequestCentsOverride,
                capPerMonthCentsOverride,
                ...rest
              } = safe.kycProfile;
              return {
                ...rest,
                clabeMasked,
                rfcMasked: maskRfc(this.pii.decryptOptional(_r)),
                capPerRequestCents: capPerRequestCentsOverride,
                capPerMonthCents: capPerMonthCentsOverride,
                ineOnFile: Boolean(safe.kycProfile.ineFrontKey && safe.kycProfile.ineBackKey),
              };
            })()
          : null,
        billingProfile: safe.billingProfile
          ? (() => {
              const { rfcEnc: _r, ...rest } = safe.billingProfile;
              return { ...rest, rfcMasked: maskRfc(this.pii.decryptOptional(_r)) };
            })()
          : null,
      };
    }

    // Proyección reducida para vault_operator (y cualquier rol no super_admin).
    return {
      ...safe,
      // KYC: solo estado/límites y una CLABE ENMASCARADA; sin INE ni CLABE/RFC completos.
      kycProfile: safe.kycProfile
        ? {
            id: safe.kycProfile.id,
            userId: safe.kycProfile.userId,
            legalName: safe.kycProfile.legalName,
            kycStatus: safe.kycProfile.kycStatus,
            clabeMasked,
            ineOnFile: Boolean(safe.kycProfile.ineFrontKey && safe.kycProfile.ineBackKey),
            capPerRequestCents: safe.kycProfile.capPerRequestCentsOverride,
            capPerMonthCents: safe.kycProfile.capPerMonthCentsOverride,
            verifiedAt: safe.kycProfile.verifiedAt,
          }
        : null,
      // Perfil de facturación (RFC/datos fiscales): oculto al operador.
      billingProfile: null,
    };
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
    // Fix correctness #3: los envíos también se acotan al periodo, por su fecha de
    // liquidación (`pickingAt` = cuando payment_intent.succeeded los movió a picking).
    const shipmentRange = range(from, to);
    const shipments = await this.prisma.shipmentRequest.findMany({
      where: {
        status: { in: ['picking', 'guia', 'enviado', 'entregado'] },
        ...(shipmentRange ? { pickingAt: shipmentRange } : {}),
      },
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
    const byOrder = orders.map(({ id, ...rest }) => ({ orderId: id, ...rest }));
    return { ivaCollectedCents, byOrder };
  }

  async exportCsv(report: string, from?: string, to?: string): Promise<string> {
    if (report === 'pnl') {
      const p = await this.pnl(from, to);
      return `report,incomeCents,shippingCents,cogsCents,stripeFeesCents,profitCents\npnl,${p.incomeCents},${p.shippingCents},${p.cogsCents},${p.stripeFeesCents},${p.profitCents}\n`;
    }
    if (report === 'iva') {
      const iva = await this.ivaReport(from, to);
      const rows = iva.byOrder.map((o) => `${o.orderId},${o.ivaCents},${o.status}`).join('\n');
      return `orderId,ivaCents,status\n${rows}\n`;
    }
    // inventory
    const inv = await this.inventoryValue();
    return `atReferenceCents,atCostCents,pendingPriceCount\n${inv.atReferenceCents},${inv.atCostCents},${inv.pendingPriceCount}\n`;
  }

  // ---------------- M9 Reports ----------------

  /**
   * Fix correctness #3: TODAS las métricas del periodo respetan el rango de fechas por
   * su fecha de realización: usuarios por alta, ventas por `settledAt`, buylist por
   * `paidAt`, retiros entregados por `deliveredAt`.
   */
  async launchMetrics(from?: string, to?: string) {
    const r = range(from, to);
    const [users, salesSettled, buylistPaid, withdrawalsNoDispute] = await Promise.all([
      this.prisma.user.count({ where: { role: 'customer', ...(r ? { createdAt: r } : {}) } }),
      this.prisma.order.count({ where: { status: 'settled', ...(r ? { settledAt: r } : {}) } }),
      this.prisma.sellRequest.count({ where: { status: 'pagada', ...(r ? { paidAt: r } : {}) } }),
      this.prisma.shipmentRequest.count({
        where: { status: 'entregado', ...(r ? { deliveredAt: r } : {}) },
      }),
    ]);
    // Metas N/X/Y/Z: solo se fijan cuando el humano las define. Mientras no haya
    // ninguna meta, `goals` es `null` (el objeto completo), no un objeto de nulos.
    const goalsRaw: { N: number | null; X: number | null; Y: number | null; Z: number | null } = {
      N: null,
      X: null,
      Y: null,
      Z: null,
    };
    const hasAnyGoal = Object.values(goalsRaw).some((v) => v !== null);
    return {
      users,
      salesSettled,
      buylistPaid,
      withdrawalsNoDispute,
      goals: hasAnyGoal ? goalsRaw : null,
    };
  }

  // ---------------- Dashboard (8 tarjetas) ----------------

  /** Rango del periodo del dashboard: from/to explícitos o el mes calendario en curso (UTC). */
  private resolvePeriod(from?: string, to?: string): { gte: Date; lte: Date } {
    if (from || to) {
      const now = new Date();
      return { gte: from ? new Date(from) : new Date(0), lte: to ? new Date(to) : now };
    }
    const start = new Date();
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);
    return { gte: start, lte: end };
  }

  /**
   * Dashboard (8 tarjetas). Fix correctness #3: las tarjetas "del periodo"
   * (profit/sales/buylist) respetan un rango real de fechas. Si no se pasa `from/to`,
   * el periodo por defecto es el MES CALENDARIO en curso (UTC). Las tarjetas de backlog
   * (workQueue/dataHealth) y los snapshots (inventoryValue/custodyValue) y el acumulado
   * de launchProgress NO son periódicos por diseño.
   */
  async dashboard(role: Role, from?: string, to?: string) {
    const isSuperAdmin = role === Role.super_admin;
    const period = this.resolvePeriod(from, to);

    const [salesCount, salesAgg, shipmentsQueue, buylistQueue, disputesQueue, pendingPrices, buylistPeriodAgg, buylistPeriodCount, lastSync, lastFx, users, salesSettled, buylistPaid, withdrawals] =
      await Promise.all([
        this.prisma.order.count({ where: { status: 'settled', settledAt: period } }),
        this.prisma.order.aggregate({ where: { status: 'settled', settledAt: period }, _sum: { totalCents: true } }),
        this.prisma.shipmentRequest.count({ where: { status: { in: ['solicitado', 'picking', 'guia'] } } }),
        this.prisma.sellRequest.count({ where: { status: { in: ['cotizada', 'recibida', 'verificacion', 'aprobada'] } } }),
        this.prisma.dispute.count({ where: { status: { in: ['abierta', 'en_revision'] } } }),
        this.prisma.pendingPriceEntry.count({ where: { status: 'open' } }),
        this.prisma.sellRequest.aggregate({ where: { status: 'pagada', paidAt: period }, _sum: { approvedTotalCents: true } }),
        this.prisma.sellRequest.count({ where: { status: 'pagada', paidAt: period } }),
        this.prisma.priceReference.findFirst({ orderBy: { createdAt: 'desc' } }),
        this.prisma.fxRate.findFirst({ orderBy: { createdAt: 'desc' } }),
        this.prisma.user.count({ where: { role: 'customer' } }),
        this.prisma.order.count({ where: { status: 'settled' } }),
        this.prisma.sellRequest.count({ where: { status: 'pagada' } }),
        this.prisma.shipmentRequest.count({ where: { status: 'entregado' } }),
      ]);

    const periodFrom = period.gte?.toISOString();
    const periodTo = period.lte?.toISOString();
    const pnl = isSuperAdmin ? await this.pnl(periodFrom, periodTo) : null;
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
