import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PricingService } from '../modules/pricing/pricing.service';

/**
 * PriceSyncJobService — Job diario `price-sync` (ARCHITECTURE §5). Recorre SOLO
 * cartas en bóveda (InventoryItem activos), respeta cache diario y escribe
 * PriceReference; genera PendingPriceEntry para faltantes.
 *
 * Nota: la programación repetible vive en BullMQ (ver JOBS en BACKEND_NOTES);
 * aquí está la lógica ejecutable, invocable desde el endpoint admin y desde el
 * scheduler. Se ejecuta secuencialmente para respetar el rate-limit del free tier.
 */
@Injectable()
export class PriceSyncJobService {
  private readonly logger = new Logger(PriceSyncJobService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  async enqueue(
    scope: 'all_vault' | 'cardIds',
    cardIds?: string[],
  ): Promise<{ jobId: string; queued: number }> {
    // Ejecución directa (MVP). En prod, BullMQ encola y procesa con rate-limit.
    const jobId = `price-sync-${Date.now()}`;
    const queued = await this.run(scope === 'cardIds' ? cardIds : undefined);
    return { jobId, queued };
  }

  /** Ejecuta el sync. Devuelve cuántas combinaciones (item) se procesaron. */
  async run(cardIds?: string[]): Promise<number> {
    const items = await this.prisma.inventoryItem.findMany({
      where: {
        ...(cardIds && cardIds.length ? { cardId: { in: cardIds } } : {}),
        status: { notIn: ['withdrawn', 'lost'] },
      },
      include: { card: true },
    });
    let count = 0;
    for (const item of items) {
      const gradeKey = this.pricing.gradeKeyFor(item);
      try {
        await this.pricing.syncCardPrice(item.card, item.productType, gradeKey, 'inventory', item.id);
        count += 1;
      } catch (e) {
        this.logger.warn(`price-sync failed for ${item.folio}: ${(e as Error).message}`);
      }
    }
    this.logger.log(`price-sync procesó ${count} items en bóveda.`);
    return count;
  }
}
