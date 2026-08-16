import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PricingService } from '../modules/pricing/pricing.service';
import { SetValueService, SET_VALUE_RULE } from '../modules/catalog/set-value.service';

/**
 * SetPriceSyncJobService — Job diario `set-price-sync` (v1.9-set-chart, ARCHITECTURE §4.12c / §5).
 *
 * Precia TODAS las cartas del SET DESTACADO desde pokemontcg.io (acabado `normal`, `raw`,
 * gradeKey `raw:NM`), escribiendo la PriceReference del día por carta vía `PricingService.syncCardPrice`
 * (idempotente por día, host FIJO anti-SSRF en el provider). Cierra la brecha DEV-3: a diferencia del
 * `price-sync` de bóveda, este NO filtra por InventoryItem — recorre `Card WHERE setId=<featured>` sin
 * tocar inventario (un set ~150–250 cartas cabe en el rate-limit del free tier).
 *
 * NO encola PendingPriceEntry (`escalate=false`): es una agregación de mercado/marketing, no de
 * bóveda; una carta del set sin precio no se escala al dueño por este flujo (§4.12a). El orden duro
 * del scheduler es FX → set-price-sync → set-value-snapshot. Secuencial para respetar el rate-limit.
 */
@Injectable()
export class SetPriceSyncJobService {
  private readonly logger = new Logger(SetPriceSyncJobService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly setValue: SetValueService,
  ) {}

  /** Precia el set destacado. Devuelve el set resuelto y cuántas cartas se procesaron. */
  async run(): Promise<{ setId: string | null; priced: number; total: number }> {
    const set = await this.setValue.resolveFeaturedSet();
    if (!set) {
      this.logger.warn('set-price-sync: no hay set destacado; nada que preciar.');
      return { setId: null, priced: 0, total: 0 };
    }

    const cards = await this.prisma.card.findMany({ where: { setId: set.id } });
    let priced = 0;
    for (const card of cards) {
      try {
        // Acabado/tipo/grado FIJOS de la regla de valor (§4.12a), desde la constante compartida
        // SET_VALUE_RULE (TD-1: misma fuente que la lectura en computeSetValue → no divergen).
        // escalate=false: no inunda la cola de precio pendiente con todo el catálogo del set.
        const info = await this.pricing.syncCardPrice(
          card,
          SET_VALUE_RULE.productType,
          SET_VALUE_RULE.gradeKey,
          SET_VALUE_RULE.finish,
          'catalog',
          undefined,
          false,
        );
        if (info.status === 'priced') priced += 1;
      } catch (e) {
        this.logger.warn(`set-price-sync falló para ${card.externalId}: ${(e as Error).message}`);
      }
    }
    this.logger.log(
      `set-price-sync: set ${set.id} → ${priced}/${cards.length} cartas con precio del día.`,
    );
    return { setId: set.id, priced, total: cards.length };
  }
}
