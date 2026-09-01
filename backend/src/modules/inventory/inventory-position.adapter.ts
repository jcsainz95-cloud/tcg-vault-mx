import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { variantPositionKey } from '../../common/variant-key';
import { NOT_ON_HAND } from './master-set.service';
import { InventoryPositionPort, VariantPositionRef } from './inventory-position.port';

/**
 * v1.51 (M-46, ARCHITECTURE §4.39f/g) — **ADAPTADOR** de `INVENTORY_POSITION_PORT`. Vive DENTRO de
 * `inventory` porque `inventory` es el dueño del dato.
 *
 * ### Qué reusa (y qué NO), verificado contra el código vivo
 * - **`NOT_ON_HAND`** (`master-set.service.ts`) — ya exportada y ya consumida por `vault`,
 *   `admin-vaults` y `sealed-graded`. **Se reusa; no se redefine.** Una quinta definición del
 *   conjunto «on-hand» sería la forma más barata de que dos pantallas cuenten distinto.
 * - Índice **`@@index([cardId, finish, status])`** (M-21) — ya sirve el filtro on-hand por carta.
 *   `productType`/`gradeKey`/`cardProductId` se resuelven post-índice; a escala MVP es aceptable.
 * - **`pricing.gradeKeyFor`** — el gradeKey canónico sale de la MISMA función que lo produce del lado
 *   de `buylist`. Derivarlo aquí a mano desalinearía las cifras en silencio.
 * - **NO se recicla** `master-set.service.ts:binder()` (privado, agrupa **sin `gradeKey`** y **mezcla
 *   raw con graded**: sirve al binder, no a una decisión de dinero), ni `CatalogService.buildGroups`
 *   (contesta «cuántas hay **publicadas**»), ni `bulkRemove` (conjunto de estados más estrecho, y es
 *   **escritura**). **La agregación de posición es NUEVA.**
 *
 * ### Money-safe
 * Solo lectura, en lote, **UNA** query para las N variantes. **No captura excepciones**: si la BD
 * falla, la excepción sube y el consumidor (`buylist`) la traduce a `positionUnavailable`. Tragarla
 * aquí y devolver un `Map` vacío produciría exactamente el `0` que el puerto existe para prohibir —
 * un `Map` sin la clave es indistinguible de «esa variante tiene cero piezas», que es un **cero
 * legítimo**.
 */
@Injectable()
export class InventoryPositionAdapter implements InventoryPositionPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  async onHandCountsFor(refs: VariantPositionRef[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (refs.length === 0) return out;

    // Solo se devuelven las variantes PEDIDAS: el `groupBy` acota por carta (que es lo que el índice
    // sirve) y el filtro fino por variante se hace en memoria contra este conjunto.
    const wanted = new Set(refs.map((r) => variantPositionKey(r)));
    const cardIds = [...new Set(refs.map((r) => r.cardId))];

    const rows = await this.prisma.inventoryItem.groupBy({
      by: ['cardId', 'productType', 'rawCondition', 'gradingCompany', 'gradeValue', 'finish', 'cardProductId'],
      where: {
        cardId: { in: cardIds },
        // «De PLATAFORMA»: la bóveda de un cliente NO es inventario nuestro y no se puede vender ni
        // contar como posición propia (§4.20a).
        ownerType: 'platform',
        // «On-hand» = el conjunto ÚNICO de `NOT_ON_HAND`, por complemento.
        status: { notIn: NOT_ON_HAND },
      },
      _count: { _all: true },
    });

    for (const r of rows) {
      const key = variantPositionKey({
        cardId: r.cardId,
        productType: r.productType,
        // MISMA función canónica que usa `buylist` para llavear la línea.
        gradeKey: this.pricing.gradeKeyFor({
          productType: r.productType,
          rawCondition: r.rawCondition,
          gradingCompany: r.gradingCompany,
          gradeValue: r.gradeValue,
        }),
        finish: r.finish,
        cardProductId: r.cardProductId,
      });
      if (!wanted.has(key)) continue;
      out.set(key, (out.get(key) ?? 0) + r._count._all);
    }
    return out;
  }
}
