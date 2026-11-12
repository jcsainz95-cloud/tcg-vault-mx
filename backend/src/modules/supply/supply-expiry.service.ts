import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Job `supply-expiry` (horario, idempotente): vence solicitudes (14 d), ofertas sin respuesta (72 h) y cancela acuerdos sin
 * recoger (7 d) liberando la cantidad reservada. Cada paso es un UPDATE condicionado: correrlo dos veces no cambia nada.
 */
@Injectable()
export class SupplyExpiryService {
  private readonly logger = new Logger(SupplyExpiryService.name);
  constructor(private readonly prisma: PrismaService) {}

  async run(now: Date = new Date()): Promise<{ requests: number; offers: number; purchases: number }> {
    // 1) Solicitudes vencidas (y sus ofertas vivas).
    const reqIds = (await this.prisma.supplyRequest.findMany({ where: { status: { in: ['open', 'filled'] }, expiresAt: { lte: now } }, select: { id: true } })).map((r) => r.id);
    let requests = 0;
    for (const id of reqIds) {
      requests += await this.prisma.$transaction(async (tx) => {
        const c = await tx.supplyRequest.updateMany({ where: { id, status: { in: ['open', 'filled'] }, expiresAt: { lte: now } }, data: { status: 'expired' } });
        if (c.count !== 1) return 0;
        const live = await tx.supplyOffer.findMany({ where: { requestId: id, status: { in: ['open', 'countered'] } }, select: { id: true } });
        if (live.length) {
          await tx.supplyOffer.updateMany({ where: { id: { in: live.map((o) => o.id) }, status: { in: ['open', 'countered'] } }, data: { status: 'expired' } });
          await tx.supplyOfferEvent.createMany({ data: live.map((o) => ({ offerId: o.id, actor: 'system', action: 'request_expired' })) });
        }
        return 1;
      });
    }
    // 2) Ofertas sin respuesta.
    const offs = await this.prisma.supplyOffer.findMany({ where: { status: { in: ['open', 'countered'] }, expiresAt: { lte: now } }, select: { id: true } });
    let offers = 0;
    for (const o of offs) {
      offers += await this.prisma.$transaction(async (tx) => {
        const c = await tx.supplyOffer.updateMany({ where: { id: o.id, status: { in: ['open', 'countered'] }, expiresAt: { lte: now } }, data: { status: 'expired' } });
        if (c.count !== 1) return 0;
        await tx.supplyOfferEvent.create({ data: { offerId: o.id, actor: 'system', action: 'expired' } });
        return 1;
      });
    }
    // 3) Acuerdos sin recoger: se cancelan y se libera la reserva.
    const purs = await this.prisma.supplyPurchase.findMany({ where: { status: 'agreed', pickupDueAt: { lte: now } }, select: { id: true, requestId: true, qty: true } });
    let purchases = 0;
    for (const p of purs) {
      purchases += await this.prisma.$transaction(async (tx) => {
        const c = await tx.supplyPurchase.updateMany({ where: { id: p.id, status: 'agreed', pickupDueAt: { lte: now } }, data: { status: 'cancelled', cancelReason: 'pickup_expired' } });
        if (c.count !== 1) return 0;
        await tx.$executeRaw`
          UPDATE "SupplyRequest"
          SET "qtyReserved" = "qtyReserved" - ${p.qty},
              "status" = CASE WHEN "status" = 'filled'::"SupplyRequestStatus" AND "expiresAt" > ${now} THEN 'open'::"SupplyRequestStatus" ELSE "status" END,
              "updatedAt" = ${now}
          WHERE "id" = ${p.requestId}`;
        return 1;
      });
    }
    if (requests || offers || purchases) this.logger.log(`supply-expiry: requests=${requests} offers=${offers} purchases=${purchases}`);
    return { requests, offers, purchases };
  }
}
