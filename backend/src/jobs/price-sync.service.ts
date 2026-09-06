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
    let skippedNoGradeIdentity = 0;
    for (const item of items) {
      // v1.53 (§4.40.4b, MONEY) — camino de LECTURA/valuación: la clave se pide con la TOLERANTE.
      // Una pieza `graded` sin identidad de slab (las que creó `convertToInventory`, §9 D-BG-3) NO
      // tiene referencia que sincronizar: se OMITE y se cuenta. Antes se resolvía como `graded:PSA:10`
      // y el job escribía/leía el precio del grado MÁS CARO sobre una pieza cuyo grado nadie preguntó.
      const gradeKey = this.pricing.tryGradeKeyFor(item);
      if (gradeKey == null) {
        skippedNoGradeIdentity += 1;
        continue;
      }
      try {
        // v1.6-finish: pricea el acabado de ESTA copia física (item.finish).
        await this.pricing.syncCardPrice(
          item.card,
          item.productType,
          gradeKey,
          item.finish,
          'inventory',
          item.id,
        );
        count += 1;
      } catch (e) {
        this.logger.warn(`price-sync failed for ${item.folio}: ${(e as Error).message}`);
      }
    }
    this.logger.log(
      `price-sync procesó ${count} items en bóveda` +
        // Observabilidad del censo §4.40.8(2): estas piezas quedan en `pending` hasta que el operador
        // capture empresa+grado por `PATCH /admin/inventory/items/:id` (§4.40.5b).
        (skippedNoGradeIdentity > 0
          ? `; ${skippedNoGradeIdentity} omitidos por identidad de grado incompleta (§4.40.4)`
          : '') +
        '.',
    );
    return count;
  }
}
