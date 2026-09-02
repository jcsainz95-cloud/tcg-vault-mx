import { Injectable } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import {
  InventoryPublishPort,
  PublishReevaluationResult,
  VariantPublishRef,
} from './inventory-publish.port';

/**
 * v1.51.20 · **R1** (ARCHITECTURE §4.39m.5) — **ADAPTADOR** de `INVENTORY_PUBLISH_PORT`. Vive DENTRO
 * de `inventory` porque `inventory` es el dueño del trabajo que se dispara.
 *
 * ### El defecto que cierra, y no era estético
 * Hasta v1.51.19 el token se ataba con `useExisting: InventoryService` y **la clase no declaraba
 * `implements InventoryPublishPort`**. Consecuencias, las dos reales:
 *
 * 1. **NO HABÍA COMPROBACIÓN EN COMPILACIÓN de que el proveedor cumpliera el puerto.** Renombrar
 *    `reevaluateForPublication` dejaba `tsc` **en verde**, las specs **en verde** (mockean el puerto,
 *    no al proveedor) y **los tres consumidores reventaban en runtime capturando el error** ⇒ **la
 *    auto-publicación se apagaba entera** con un `logger.warn` como único síntoma. *Un seam cuyo
 *    incumplimiento no falla el build no es un seam: es una convención.*
 * 2. **Detrás del token estaba el SERVICIO DE ESCRITURA COMPLETO.** El puerto promete exponer *«una
 *    capacidad, no una autoridad»*; con `useExisting` cualquiera que resolviera el token tenía en la
 *    mano `bulkPublish`, `publishAll`, `convertToInventory` y el resto del grafo de escritura de
 *    inventario. El módulo hermano —`InventoryPositionModule`— ya lo hacía bien con un adaptador
 *    **privado**, y su comentario presume de que *«nadie puede saltarse el seam»*. Aquí no era cierto.
 *
 * ### ⚠️ DELEGAR NO ES REIMPLEMENTAR — y ésa era la objeción legítima al adaptador
 * El docblock del módulo defendía `useExisting` diciendo que un adaptador *«tendría que reimplementar
 * el pipeline o llamarlo, es decir, una segunda forma de publicar»*. **La primera mitad sería un bug;
 * la segunda es exactamente lo que se hace aquí.** Este adaptador **no decide nada**: no mira estado,
 * no resuelve precio, no toca `status`, no captura errores. **Reenvía la llamada tal cual.** El
 * pipeline (`assertPublishableGuards` + `resolvePublishSalePrice` + `claimListed`) sigue viviendo
 * **en un solo sitio**, dentro de `InventoryService`. *Lo que se añade no es una implementación: es
 * un punto donde el compilador puede comprobar la promesa.*
 *
 * ⚠️ **Y el `implements` es el punto entero de este archivo.** Si mañana alguien cambia la firma de
 * `InventoryService.reevaluateForPublication`, **el build falla AQUÍ**, en el sitio que nombra el
 * contrato — en vez de fallar en producción, en silencio, con la publicación apagada.
 *
 * ⚠️ **Provider PRIVADO de `InventoryPublishModule`:** fuera solo existe el token. Nadie puede
 * inyectar esta clase concreta y saltarse el seam, igual que con `InventoryPositionAdapter`.
 */
@Injectable()
export class InventoryPublishAdapter implements InventoryPublishPort {
  constructor(private readonly inventory: InventoryService) {}

  /**
   * ⚠️ **«Reevalúa estas piezas», no «publícalas».** Reenvío puro: el llamador no puede expresar
   * estado destino ni precio, y la decisión ocurre entera del otro lado de esta línea.
   */
  reevaluateForPublication(inventoryItemIds: string[]): Promise<PublishReevaluationResult[]> {
    return this.inventory.reevaluateForPublication(inventoryItemIds);
  }

  /**
   * Segunda ENTRADA al MISMO cuerpo (§4.39m.8), para el disparador (c), que **no puede nombrar
   * piezas**: solo conoce claves de variante. La resolución clave→ids vive **dentro de
   * `inventory`** —`gradeKey` no es columna de `InventoryItem`—, así que aquí tampoco hay lógica que
   * pueda divergir: solo el reenvío.
   */
  reevaluateVariantsForPublication(
    variants: VariantPublishRef[],
  ): Promise<PublishReevaluationResult[]> {
    return this.inventory.reevaluateVariantsForPublication(variants);
  }
}
