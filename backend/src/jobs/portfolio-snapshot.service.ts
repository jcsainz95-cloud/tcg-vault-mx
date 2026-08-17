import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { VaultService } from '../modules/vault/vault.service';

/**
 * PortfolioSnapshotJobService — Job diario `portfolio-snapshot` (ARCHITECTURE §3/§5, BE-5).
 * Tras el `price-sync`, por cada usuario con holdings calcula el valor del portafolio a
 * REFERENCIA (reutilizando `VaultService.holdings()`, para no divergir del valor en vivo) y
 * hace UPSERT del `PortfolioSnapshot` del día. Idempotente por día (`@@unique[userId,asOfDate]`):
 * re-correrlo actualiza el punto, no duplica. Alimenta `GET /vault/portfolio/history`.
 */
@Injectable()
export class PortfolioSnapshotJobService {
  private readonly logger = new Logger(PortfolioSnapshotJobService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly vault: VaultService,
  ) {}

  private today(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }

  /** Snapshotea todos los usuarios con holdings. Devuelve cuántos se snapshotearon. */
  async run(): Promise<number> {
    // Solo usuarios que tienen al menos un item en custodia (ownerType=customer).
    // v1.17: excluye `withdrawn` (entregados) — misma regla de inclusión que
    // `VaultService.holdings()` para que la gráfica de tendencia sea consistente.
    const owners = await this.prisma.inventoryItem.findMany({
      where: { ownerType: 'customer', ownerUserId: { not: null }, status: { not: 'withdrawn' } },
      distinct: ['ownerUserId'],
      select: { ownerUserId: true },
    });
    let count = 0;
    for (const o of owners) {
      if (!o.ownerUserId) continue;
      try {
        await this.snapshotUser(o.ownerUserId);
        count += 1;
      } catch (e) {
        this.logger.warn(`portfolio-snapshot failed for ${o.ownerUserId}: ${(e as Error).message}`);
      }
    }
    this.logger.log(`portfolio-snapshot procesó ${count} usuarios con holdings.`);
    return count;
  }

  /** Upsert idempotente del snapshot del día para un usuario. */
  async snapshotUser(userId: string) {
    const { portfolio } = await this.vault.holdings(userId);
    const costBasisMxnCents = await this.vault.costBasisCents(userId);
    const asOfDate = this.today();
    return this.prisma.portfolioSnapshot.upsert({
      where: { userId_asOfDate: { userId, asOfDate } },
      create: {
        userId,
        asOfDate,
        totalValueMxnCents: portfolio.totalValueMxnCents,
        costBasisMxnCents,
        pendingPriceCount: portfolio.pendingPriceCount,
      },
      update: {
        totalValueMxnCents: portfolio.totalValueMxnCents,
        costBasisMxnCents,
        pendingPriceCount: portfolio.pendingPriceCount,
      },
    });
  }
}
