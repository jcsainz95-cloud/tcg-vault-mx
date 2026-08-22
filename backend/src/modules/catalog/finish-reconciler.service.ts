import { Injectable, Logger } from '@nestjs/common';
import { CardProductKind, Finish } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { deriveAvailableFinishesFromProducts } from '../../common/card-order';

/**
 * FinishReconciler (v1.29, ARCHITECTURE §4.27c) — ÚNICO ESCRITOR de `Card.availableFinishes`.
 *
 * v1.29 DEROGA la unión heurística `composeAvailableFinishes(structural ∪ snapshot − {normal|premium})`.
 * La lista blanca SEC-A1 se DERIVA DIRECTO de los productos de la carta, sin heurística:
 *
 *   availableFinishes := orderFinishes( ⋃ { p.finishes : p ∈ CardProduct(card),
 *                                            p.kind ∈ {set_base, other} } ) || ['normal']
 *
 * Los `deck_exclusive`/`promo` NO componen la carta de set (son productos vendibles aparte, §4.27e), y
 * como los acabados se leen EXACTO por `productId` (nunca unidos con otro producto), el `normal`
 * fantasma es imposible por construcción — la energía especial queda en 2 casillas, no 3.
 *
 * Money-safe: una carta SIN `CardProduct` (legacy aún no resuelta por el `--force`) CONSERVA su
 * `availableFinishes` previo (no se clobbea). La escritura es idempotente (si el valor recomputado ya
 * coincide, no se escribe). `structuralFinishes`/`pricedFinishesSnapshot` quedan MUERTAS (no se leen).
 */
@Injectable()
export class FinishReconciler {
  private readonly logger = new Logger(FinishReconciler.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Recomputa y persiste `availableFinishes` de las cartas indicadas desde sus `CardProduct`. Devuelve
   * cuántas filas CAMBIARON (observabilidad). Deduplica los ids de entrada.
   */
  async reconcile(cardIds: string[]): Promise<number> {
    const ids = [...new Set(cardIds)];
    if (ids.length === 0) return 0;

    const cards = await this.prisma.card.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        availableFinishes: true,
        cardProducts: { select: { kind: true, finishes: true } },
      },
    });

    let changed = 0;
    let conservedNoProducts = 0;
    for (const c of cards) {
      const products = c.cardProducts as { kind: CardProductKind; finishes: Finish[] }[];
      // Money-safe: sin CardProduct (legacy no resuelta) ⇒ conserva su valor previo (no clobbea).
      if (products.length === 0) {
        conservedNoProducts += 1;
        continue;
      }
      const next = deriveAvailableFinishesFromProducts(products);
      if (sameFinishes(next, c.availableFinishes as Finish[])) continue; // idempotente
      await this.prisma.card.update({ where: { id: c.id }, data: { availableFinishes: next } });
      changed += 1;
    }

    if (conservedNoProducts > 0) {
      this.logger.debug(
        `FinishReconciler: ${conservedNoProducts} carta(s) sin CardProduct (legacy) conservaron su ` +
          `availableFinishes previo (money-safe; el re-sync por set las resuelve).`,
      );
    }
    if (changed > 0) {
      this.logger.log(
        `FinishReconciler: availableFinishes recomputado desde CardProduct para ${changed}/${cards.length} carta(s).`,
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
