import { Injectable, Logger } from '@nestjs/common';
import { InventoryItem, ProductType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PricingService } from '../modules/pricing/pricing.service';
import { hasManualPrice } from '../common/money';

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
    const queued = await this.run(scope === 'cardIds' ? cardIds : undefined);
    return { jobId, queued };
  }

  /** Ejecuta el sync. Devuelve cuántas combinaciones (item) se procesaron. */
  async run(cardIds?: string[]): Promise<number> {
    // «Completa» = sin filtro de cartas (scheduler o `scope="all_vault"`). Un `cardIds` vacío ya
    // barría todo, así que también cuenta como completa.
    const full = !(cardIds && cardIds.length);
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
  async sweepUnreasonedSaleQueue(): Promise<{ closed: number; kept: number }> {
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
    const needed = new Set<string>();
    for (const item of items) {
      if (hasManualPrice(item)) continue;
      const key = this.queueKeyOfItem(item);
      if (key != null) needed.add(key);
    }
    const toClose = rows
      .filter(
        (r) =>
          !needed.has(
            queueKey(
              r.cardId,
              r.productType,
              r.gradeKey,
              r.finish,
              r.cardProductId,
              r.sealedProductId,
            ),
          ),
      )
      .map((r) => r.id);
    if (toClose.length > 0) {
      // El `where` repite el predicado: si entre la lectura y aquí un escritor le puso motivo a la
      // fila (o la cerró), NO se toca.
      await this.prisma.pendingPriceEntry.updateMany({
        where: { id: { in: toClose }, status: 'open', context: 'inventory', reason: null },
        data: { status: 'resolved', resolvedAt: new Date(), resolvedPriceRefId: null },
      });
      this.logger.log(
        `price-sync · barrido VQ: ${toClose.length} fila(s) «sin motivo» de VENTA cerradas (ninguna pieza ` +
          `vendible de plataforma las necesita): ${toClose.join(', ')}`,
      );
    }
    const kept = rows.length - toClose.length;
    if (kept > 0) {
      this.logger.log(
        `price-sync · barrido VQ: ${kept} fila(s) «sin motivo» de piezas vendibles se dejan para publish-all.`,
      );
    }
    return { closed: toClose.length, kept };
  }

  /**
   * Clave de cola de una pieza — la MISMA con la que la publicación escala/cierra
   * (`derivePublishSalePrice`): raw/graded `(cardId, productType, tryGradeKeyFor, finish,
   * cardProductId, null)`; sellado `(cardId, 'sealed', sealedMarketGradeKeyForItem ?? 'sealed',
   * 'normal', null, sealedProductId)`. Sin clave (graded sin identidad) ⇒ `null` (no casa).
   */
  private queueKeyOfItem(item: InventoryItem): string | null {
    if (item.productType === 'sealed') {
      const gk =
        this.pricing.sealedMarketGradeKeyForItem(item) ??
        this.pricing.gradeKeyFor({ productType: 'sealed' });
      return queueKey(item.cardId, 'sealed', gk, 'normal', null, item.sealedProductId);
    }
    const gk = this.pricing.tryGradeKeyFor(item);
    if (gk == null) return null;
    return queueKey(item.cardId, item.productType, gk, item.finish, item.cardProductId, null);
  }
}

function queueKey(
  cardId: string,
  productType: string,
  gradeKey: string,
  finish: string,
  cardProductId: number | null,
  sealedProductId: string | null,
): string {
  return JSON.stringify([
    cardId,
    productType,
    gradeKey,
    finish,
    cardProductId ?? null,
    sealedProductId ?? null,
  ]);
}
