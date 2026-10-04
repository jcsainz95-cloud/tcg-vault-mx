import { Injectable, Logger } from '@nestjs/common';
import { ProductType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PricingService } from '../modules/pricing/pricing.service';
import { saleQueueKeyOf, serializeSaleQueueKey } from '../modules/pricing/sale-queue-key';
import { hasManualPrice } from '../common/money';
import { PremiumFloorPolicy, premiumFloorPublishes } from '../common/pricing-curve';

/** Tope de ids que el log del barrido VQ enumera (techlead D-6): el resto se resume con un conteo. */
export const VQ_SWEEP_LOG_ID_CAP = 20;

/**
 * PriceSyncJobService — Job diario `price-sync` (ARCHITECTURE §5). Recorre las piezas en bóveda
 * (InventoryItem no `withdrawn`/`lost`, de plataforma y de clientes), respeta cache diario y escribe
 * la `PriceReference` del día (la valuación de custodia y P&L la leen).
 *
 * ⛔ v1.80.8.4 (API_CONTRACT §M2 `M2-VQ`, ARCHITECTURE §4.36.5 c-bis): **NO escribe la cola de precio
 * pendiente.** Antes escalaba sin motivo cada pieza cuyo proveedor por carta no contestara —incluidas
 * piezas de clientes y vendidas— y eso era el «SIN MOTIVO» de la cola de VENTA. Ahora: (1) telemetría
 * del job en log; (2) al final de una corrida COMPLETA, el **barrido VQ** cierra las filas
 * `reason IS NULL` de VENTA que ninguna pieza vendible de plataforma necesita.
 *
 * ⭐ v1.80.8.5 (API_CONTRACT §M2 `M2-PF`, ARCHITECTURE §4.36.5 c-ter): el barrido gana una rama —
 * cierra las filas `premium_at_floor` de VENTA cuya rareza el dial `premium_floor_sale_publish` publica
 * (para esas rarezas ningún escritor de VENTA produce ya ese motivo, así que la fila es obsoleta).
 *
 * Nota: la programación repetible vive en BullMQ (ver JOBS en BACKEND_NOTES); aquí está la lógica
 * ejecutable, invocable desde el endpoint admin y desde el scheduler. Secuencial por el rate-limit.
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
    // QA (gate sobre `8a10153e`): con `scope="cardIds"` el filtro es `cardIds` TAL CUAL — vacío u
    // omitido ⇒ ninguna carta (no-op, `queued: 0`). Antes `[]` caía en la corrida COMPLETA y en el
    // barrido VQ, y §M2 v1.80.8.4 dice «con `scope="cardIds"` no barre».
    const queued = await this.run(scope === 'cardIds' ? (cardIds ?? []) : undefined);
    return { jobId, queued };
  }

  /**
   * Ejecuta el sync. Devuelve cuántas combinaciones (item) se procesaron.
   *
   * `cardIds` **omitido** ⇒ corrida COMPLETA (scheduler o `scope="all_vault"`) y barrido VQ al final.
   * `cardIds` **presente** ⇒ solo esas cartas y ⛔ sin barrido; un array vacío es «ninguna carta» (no-op),
   * nunca «todas».
   */
  async run(cardIds?: string[]): Promise<number> {
    const full = cardIds === undefined;
    if (!full && cardIds.length === 0) {
      this.logger.log('price-sync: `cardIds` vacío ⇒ ninguna carta que refrescar (no-op, sin barrido VQ).');
      return 0;
    }
    const items = await this.prisma.inventoryItem.findMany({
      where: {
        ...(full ? {} : { cardId: { in: cardIds } }),
        status: { notIn: ['withdrawn', 'lost'] },
      },
      include: { card: true },
    });
    let count = 0;
    let priced = 0;
    let failed = 0;
    let skippedNoGradeIdentity = 0;
    const noQuote: Partial<Record<ProductType, number>> = {};
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
        const info = await this.pricing.syncCardPrice(
          item.card,
          item.productType,
          gradeKey,
          item.finish,
        );
        if (info.status === 'priced') priced += 1;
        else noQuote[item.productType] = (noQuote[item.productType] ?? 0) + 1;
        count += 1;
      } catch (e) {
        failed += 1;
        this.logger.warn(`price-sync failed for ${item.folio}: ${(e as Error).message}`);
      }
    }
    // v1.80.8.4: telemetría del job. «Sin cotización» NO es fila de cola (no hay tercer motivo):
    // graded/sellado son stubs que hoy siempre caen aquí.
    this.logger.log(
      `price-sync procesó ${count} items en bóveda: ` +
        JSON.stringify({ priced, noQuote, failed, skippedNoGradeIdentity }) +
        // Observabilidad del censo §4.40.8(2): las omitidas quedan en `pending` hasta que el operador
        // capture empresa+grado por `PATCH /admin/inventory/items/:id` (§4.40.5b).
        (skippedNoGradeIdentity > 0
          ? `; ${skippedNoGradeIdentity} omitidos por identidad de grado incompleta (§4.40.4)`
          : '') +
        '.',
    );
    if (full) await this.sweepUnreasonedSaleQueue();
    return count;
  }

  /**
   * v1.80.8.4 — **Barrido VQ** (API_CONTRACT §M2 `M2-VQ`, ARCHITECTURE §4.36.5 c-bis punto 5).
   *
   * Para cada fila `open`, `context='inventory'`, `reason IS NULL`: si **alguna** pieza
   * `ownerType=platform`, `status ∈ {in_stock, listed}`, sin precio manual por pieza, tiene su clave de
   * cola ⇒ se DEJA (le pone motivo o la cierra `publish-all` / `price-ingest`); si **ninguna** ⇒ se
   * CIERRA (`resolved`, `resolvedPriceRefId=null`). ⛔ No toca filas con motivo ni de otro `context`.
   * Idempotente: una segunda corrida no encuentra nada que cerrar. Es lógica de aplicación (la clave
   * de una pieza sale de `tryGradeKeyFor`/`sealedMarketGradeKeyForItem`), no una migración.
   *
   * Uso de la llave de COLA (`tryGradeKeyFor`), no de patrimonio (SK-5 intacto).
   */
  async sweepUnreasonedSaleQueue(): Promise<{ closed: number; kept: number; premiumFloorClosed: number }> {
    // v1.80.8.5 (`M2-PF`): la política se lee UNA vez, al empezar.
    const policy = await this.pricing.loadSalePremiumFloorPolicy();
    const { closed, kept } = await this.sweepUnreasonedRows();
    const premiumFloorClosed = await this.sweepStalePremiumFloorRows(policy);
    return { closed, kept, premiumFloorClosed };
  }

  /**
   * v1.80.8.5 (`M2-PF`) — **rama nueva del barrido VQ.** Toma las filas `open`, `context='inventory'`,
   * `reason='premium_at_floor'` con la rareza de su carta (`Card.rarityCanonical ?? Card.rarity`, la
   * misma expresión que pasan los seams) y CIERRA las que `premiumFloorPublishes(policy, rareza)` publica
   * —sin casar piezas—. Las demás se DEJAN. Con `mode:'none'` ⇒ no-op. ⛔ No toca `context='buylist'`
   * ni otros motivos (lo repite el `where` de la escritura, en `PricingService`).
   *
   * Carrera aceptada (contrato): si el dial cambia entre esta lectura y la escritura, se puede cerrar una
   * fila recién abierta; la reabre el siguiente escritor. Higiene de cola, no dinero.
   */
  private async sweepStalePremiumFloorRows(
    policy: PremiumFloorPolicy,
  ): Promise<number> {
    if (policy.mode === 'none') return 0;
    const rows = await this.prisma.pendingPriceEntry.findMany({
      where: { status: 'open', context: 'inventory', reason: 'premium_at_floor' },
      select: { id: true, card: { select: { rarity: true, rarityCanonical: true } } },
    });
    const toClose = rows
      .filter((r) => premiumFloorPublishes(policy, r.card.rarityCanonical ?? r.card.rarity))
      .map((r) => r.id);
    if (toClose.length === 0) return 0;
    const closed = await this.pricing.closeStalePremiumFloorSaleRows(toClose);
    const shown = toClose.slice(0, VQ_SWEEP_LOG_ID_CAP).join(', ');
    const rest = toClose.length - VQ_SWEEP_LOG_ID_CAP;
    this.logger.log(
      `price-sync · barrido VQ: ${closed} fila(s) «premium en el piso» de VENTA cerradas (su rareza ` +
        `se publica al piso según premium_floor_sale_publish=${policy.mode}): ${shown}` +
        (rest > 0 ? ` … (+${rest} más)` : ''),
    );
    return closed;
  }

  /** v1.80.8.4 — rama original del barrido: filas `reason IS NULL` de VENTA sin pieza vendible. */
  private async sweepUnreasonedRows(): Promise<{ closed: number; kept: number }> {
    const rows = await this.prisma.pendingPriceEntry.findMany({
      where: { status: 'open', context: 'inventory', reason: null },
      select: {
        id: true,
        cardId: true,
        productType: true,
        gradeKey: true,
        finish: true,
        cardProductId: true,
        sealedProductId: true,
      },
    });
    if (rows.length === 0) return { closed: 0, kept: 0 };
    const items = await this.prisma.inventoryItem.findMany({
      where: {
        ownerType: 'platform',
        status: { in: ['in_stock', 'listed'] },
        cardId: { in: [...new Set(rows.map((r) => r.cardId))] },
      },
    });
    // Techlead D-1: la clave de una pieza sale de la derivación COMPARTIDA con la publicación
    // (`saleQueueKeyOf`, la misma que usa `derivePublishSalePrice`) y se serializa con LA serialización
    // (`serializeSaleQueueKey`) — fila y pieza se comparan con la misma función.
    const needed = new Set<string>();
    for (const item of items) {
      if (hasManualPrice(item)) continue;
      const key = saleQueueKeyOf(item, this.pricing);
      if (key != null) needed.add(serializeSaleQueueKey(key));
    }
    const toClose = rows.filter((r) => !needed.has(serializeSaleQueueKey(r))).map((r) => r.id);
    let closed = 0;
    if (toClose.length > 0) {
      // Techlead D-2: la ESCRITURA vive en `PricingService` (dueño de la cola); el `where` de allí
      // repite el predicado, así que una fila a la que un escritor le puso motivo entre la lectura y
      // aquí NO se toca.
      closed = await this.pricing.closeUnreasonedSaleQueueRows(toClose);
      const shown = toClose.slice(0, VQ_SWEEP_LOG_ID_CAP).join(', ');
      const rest = toClose.length - VQ_SWEEP_LOG_ID_CAP;
      this.logger.log(
        `price-sync · barrido VQ: ${closed} fila(s) «sin motivo» de VENTA cerradas (ninguna pieza ` +
          `vendible de plataforma las necesita): ${shown}` +
          (rest > 0 ? ` … (+${rest} más)` : ''),
      );
    }
    const kept = rows.length - toClose.length;
    if (kept > 0) {
      this.logger.log(
        `price-sync · barrido VQ: ${kept} fila(s) «sin motivo» de piezas vendibles se dejan para publish-all.`,
      );
    }
    return { closed, kept };
  }
}
