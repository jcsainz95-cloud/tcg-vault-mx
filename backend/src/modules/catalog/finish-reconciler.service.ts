import { Injectable, Logger } from '@nestjs/common';
import { Finish } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { unionAvailableFinishes } from '../../common/card-order';

/**
 * FinishReconciler (v1.22-1, ARCHITECTURE §4.22g candado 4) — ÚNICO ESCRITOR de
 * `Card.availableFinishes` en todo el sistema.
 *
 * Lee las DOS columnas de ENTRADA persistidas de las cartas dadas y RECOMPUTA la lista blanca:
 *
 *   availableFinishes := orderFinishes(catalogFinishes ∪ pricedFinishesSnapshot) || ['normal']
 *
 *  - `catalogFinishes`         — la escribe `catalog-sync.upsertCards` (Señal A ∪ B de pokemontcg.io).
 *  - `pricedFinishesSnapshot`  — la escribe `price-ingest` (Señal C: PPT `market>0` + alias VERIFICADO).
 *
 * Ni `price-ingest` ni `catalog-sync` escriben `availableFinishes` directamente: escriben SU columna
 * de entrada y LLAMAN a `reconcile(cardIds)`. Ante una discrepancia hay UN solo lugar donde mirar,
 * y un `sync --force` o la siguiente corrida de PPT REPARAN el dato (la unión es recomputable, no
 * monótona). La escritura es idempotente: si el valor recomputado ya coincide, NO se escribe.
 */
@Injectable()
export class FinishReconciler {
  private readonly logger = new Logger(FinishReconciler.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Recomputa y persiste `availableFinishes` de las cartas indicadas a partir de sus dos columnas
   * de entrada. Devuelve cuántas filas CAMBIARON (observabilidad). Deduplica los ids de entrada.
   */
  async reconcile(cardIds: string[]): Promise<number> {
    const ids = [...new Set(cardIds)];
    if (ids.length === 0) return 0;

    const cards = await this.prisma.card.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        catalogFinishes: true,
        pricedFinishesSnapshot: true,
        availableFinishes: true,
      },
    });

    let changed = 0;
    for (const c of cards) {
      const next = unionAvailableFinishes(
        c.catalogFinishes as Finish[],
        c.pricedFinishesSnapshot as Finish[],
      );
      if (sameFinishes(next, c.availableFinishes as Finish[])) continue; // idempotente: sin cambio, sin write
      await this.prisma.card.update({ where: { id: c.id }, data: { availableFinishes: next } });
      changed += 1;
    }

    if (changed > 0) {
      this.logger.log(
        `FinishReconciler: availableFinishes recomputado para ${changed}/${cards.length} carta(s) tocada(s).`,
      );
    }
    return changed;
  }
}

/** Igualdad de dos listas de acabados YA en orden canónico (misma longitud, mismos elementos). */
function sameFinishes(a: Finish[], b: Finish[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
