import { Injectable, Logger } from '@nestjs/common';
import { Finish } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { composeAvailableFinishes } from '../../common/card-order';

/**
 * FinishReconciler (v1.22-1, ARCHITECTURE §4.22g candado 4) — ÚNICO ESCRITOR de
 * `Card.availableFinishes` en todo el sistema.
 *
 * v1.27 (P-13, §4.25a) — la UNIÓN con `pricedFinishesSnapshot` queda DEROGADA: **el precio
 * CONFIRMA, nunca AÑADE**. La fórmula vigente es:
 *
 *   availableFinishes := structuralFinishes ≠ ∅ ? orderFinishes(structuralFinishes) : ['normal']
 *
 *  - `structuralFinishes`      — v1.26 (§4.24a): afirmación ESTRUCTURAL autoritativa DETECTADA de
 *    TCGCSV. La escribe el resolver de `catalog-sync.importSet` (first-import/`--force`, y desde
 *    v1.27/P-12 también `sync {setId, force:true}`) y, como seed inicial, `upsertCards` en CREATE.
 *  - `pricedFinishesSnapshot`  — la sigue escribiendo `price-ingest` (Señal C) pero **ya no
 *    compone**: aquí solo se LEE para OBSERVABILIDAD — el log `pricedNotStructural`
 *    (= snapshot ∖ structuralFinishes) deja evidencia del drift proveedor↔estructura para el
 *    dueño de datos, sin tocar la lista blanca.
 *
 * Ni `price-ingest` ni `catalog-sync` escriben `availableFinishes` directamente: escriben SU columna
 * de entrada y LLAMAN a `reconcile(cardIds)`. Ante una discrepancia hay UN solo lugar donde mirar,
 * y un `sync {force:true}` REPARA el dato (la composición es recomputable, no monótona: recomputar
 * con una estructura menor ELIMINA las casillas fantasma ya materializadas). La escritura es
 * idempotente: si el valor recomputado ya coincide, NO se escribe.
 */
@Injectable()
export class FinishReconciler {
  private readonly logger = new Logger(FinishReconciler.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Recomputa y persiste `availableFinishes` de las cartas indicadas a partir de su columna
   * estructural. Devuelve cuántas filas CAMBIARON (observabilidad). Deduplica los ids de entrada.
   */
  async reconcile(cardIds: string[]): Promise<number> {
    const ids = [...new Set(cardIds)];
    if (ids.length === 0) return 0;

    const cards = await this.prisma.card.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        structuralFinishes: true,
        pricedFinishesSnapshot: true,
        availableFinishes: true,
      },
    });

    let changed = 0;
    const pricedNotStructural: string[] = [];
    for (const c of cards) {
      const structural = c.structuralFinishes as Finish[];
      // v1.27 (P-13, §4.25a): observabilidad del drift — el snapshot trae un finish NO estructural.
      // Se LOGUEA, jamás se compone (el precio no es evidencia estructural).
      const structuralSet = new Set<Finish>(structural);
      for (const f of c.pricedFinishesSnapshot as Finish[]) {
        if (!structuralSet.has(f)) pricedNotStructural.push(`${c.id}:${f}`);
      }
      const next = composeAvailableFinishes(structural);
      if (sameFinishes(next, c.availableFinishes as Finish[])) continue; // idempotente: sin cambio, sin write
      await this.prisma.card.update({ where: { id: c.id }, data: { availableFinishes: next } });
      changed += 1;
    }

    if (pricedNotStructural.length > 0) {
      this.logger.warn(
        `FinishReconciler: pricedNotStructural — ${pricedNotStructural.length} par(es) (carta:finish) ` +
          `con precio en el snapshot pero SIN respaldo estructural ` +
          `[${pricedNotStructural.slice(0, 20).join(', ')}${pricedNotStructural.length > 20 ? ', …' : ''}]. ` +
          `NO componen la lista blanca (§4.25a); es drift proveedor↔estructura para el dueño de datos.`,
      );
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
