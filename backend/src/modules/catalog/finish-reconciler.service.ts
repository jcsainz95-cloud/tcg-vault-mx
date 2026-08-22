import { Injectable, Logger } from '@nestjs/common';
import { Finish } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { composeAvailableFinishes } from '../../common/card-order';

/**
 * FinishReconciler (v1.22-1, ARCHITECTURE §4.22g candado 4) — ÚNICO ESCRITOR de
 * `Card.availableFinishes` en todo el sistema.
 *
 * v1.27.1 (P-13-fix, §4.25e) — la UNIÓN con `pricedFinishesSnapshot` VUELVE (la fórmula «solo
 * structural» de §4.25a-1 causó una regresión en prod), pero se filtra `normal` cuando la rareza es
 * premium. La fórmula vigente es:
 *
 *   availableFinishes := orderFinishes( (structuralFinishes ∪ pricedFinishesSnapshot)
 *                                       − { normal | isPremiumRarity(rarity) } ) || ['normal']
 *
 *  - `structuralFinishes`      — v1.26 (§4.24a): afirmación ESTRUCTURAL autoritativa DETECTADA de
 *    TCGCSV. La escribe el resolver de `catalog-sync.importSet` (first-import/`--force`, y desde
 *    v1.27/P-12 también `sync {setId, force:true}`) y, como seed inicial, `upsertCards` en CREATE.
 *  - `pricedFinishesSnapshot`  — la sigue escribiendo `price-ingest` (Señal C) y **vuelve a componer**
 *    (§4.25e): recupera el reverse holo legítimo del común que en sets nuevos solo trae el proveedor.
 *    Además se LEE para OBSERVABILIDAD del drift proveedor↔estructura (snapshot ∖ structuralFinishes),
 *    partido por señal: los acabados que SÍ componen (camino feliz, p.ej. el reverse recuperado) se
 *    trazan a `debug`; solo los que la composición DESCARTÓ (anómalo, p.ej. `normal` fantasma en
 *    rareza premium) se emiten a `warn` (log `pricedNotStructural`) para el dueño de datos.
 *  - `rarity`                  — v1.27.1 (§4.25e): entra al `select` y se pasa a la fórmula. Es el
 *    GATE del filtro estructural de `normal` (premium ⇒ el `normal` es fantasma, se quita).
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
        rarity: true,
        structuralFinishes: true,
        pricedFinishesSnapshot: true,
        availableFinishes: true,
      },
    });

    let changed = 0;
    // v1.27.1 (P-13-fix, §4.25e): observabilidad del drift proveedor↔estructura, partida en DOS
    // buckets por SEÑAL (evita el warn contradictorio/ruidoso previo, que trataba el camino feliz
    // como drift). Un acabado del snapshot SIN respaldo estructural es:
    //  - CAMINO FELIZ si SÍ compone la whitelist (§4.25e recupera el reverse holo del común que en
    //    sets nuevos SOLO trae el proveedor) ⇒ esperado ⇒ `debug`, no ensucia `warn`.
    //  - ANÓMALO si la composición lo DESCARTÓ (p.ej. `normal` fantasma en rareza premium filtrado
    //    por §4.25e-1) ⇒ dato de proveedor en conflicto con la estructura ⇒ `warn`.
    const snapshotRecovered: string[] = []; // camino feliz: snapshot ∖ structural que SÍ compone
    const pricedNotStructural: string[] = []; // anómalo: snapshot ∖ structural que la composición descartó
    for (const c of cards) {
      const structural = c.structuralFinishes as Finish[];
      const priced = c.pricedFinishesSnapshot as Finish[];
      // §4.25e: la unión vuelve (structural ∪ snapshot) menos `normal` si la rareza es premium.
      const next = composeAvailableFinishes(structural, priced, c.rarity);
      const structuralSet = new Set<Finish>(structural);
      const nextSet = new Set<Finish>(next);
      for (const f of priced) {
        if (structuralSet.has(f)) continue; // respaldado por la estructura: no es drift
        if (nextSet.has(f)) snapshotRecovered.push(`${c.id}:${f}`); // compone ⇒ camino feliz
        else pricedNotStructural.push(`${c.id}:${f}`); // descartado por la composición ⇒ anómalo
      }
      if (sameFinishes(next, c.availableFinishes as Finish[])) continue; // idempotente: sin cambio, sin write
      await this.prisma.card.update({ where: { id: c.id }, data: { availableFinishes: next } });
      changed += 1;
    }

    if (snapshotRecovered.length > 0) {
      // Camino feliz esperado bajo §4.25e (cada común de set nuevo recupera aquí su reverse) ⇒ `debug`
      // para no spamear `warn`; queda como traza del drift benigno para quien la busque.
      this.logger.debug(
        `FinishReconciler: snapshotRecovered — ${snapshotRecovered.length} acabado(s) (carta:finish) ` +
          `sin respaldo estructural que SÍ componen la whitelist (§4.25e: reverse holo del común que en ` +
          `sets nuevos solo trae el proveedor) ` +
          `[${snapshotRecovered.slice(0, 20).join(', ')}${snapshotRecovered.length > 20 ? ', …' : ''}].`,
      );
    }
    if (pricedNotStructural.length > 0) {
      // Anomalía genuina: el snapshot trajo un acabado que la composición DESCARTÓ (hoy: `normal`
      // fantasma en rareza premium, filtrado por §4.25e-1). Señal real de drift para el dueño de datos.
      this.logger.warn(
        `FinishReconciler: pricedNotStructural — ${pricedNotStructural.length} par(es) (carta:finish) ` +
          `que el snapshot de precios trae SIN respaldo estructural y que la composición DESCARTÓ ` +
          `(§4.25e: p.ej. \`normal\` fantasma en rareza premium) ` +
          `[${pricedNotStructural.slice(0, 20).join(', ')}${pricedNotStructural.length > 20 ? ', …' : ''}]. ` +
          `Drift proveedor↔estructura para el dueño de datos.`,
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
