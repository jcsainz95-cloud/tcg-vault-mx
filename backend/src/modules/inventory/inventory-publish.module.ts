import { Global, Module } from '@nestjs/common';
import { InventoryModule } from './inventory.module';
import { INVENTORY_PUBLISH_PORT } from './inventory-publish.port';
import { InventoryPublishAdapter } from './inventory-publish.adapter';

/**
 * v1.51.18 (**BL-25**, ARCHITECTURE §4.39m.5) — módulo **@Global** que exporta **solo**
 * `INVENTORY_PUBLISH_PORT`.
 *
 * ### Por qué un módulo propio, y por qué NO se copia el de posición tal cual
 * Mismo motivo que `InventoryPositionModule`: el puerto tiene que estar disponible en `buylist` y en
 * `pricing` **sin que sus módulos importen `InventoryModule`** (§4.39f: acoplar dos streams en el
 * grafo de módulos hace que un cambio de providers en uno pueda **romper el arranque** del otro).
 * **`InventoryModule` NO se vuelve global**: fuera solo existe **un token**.
 *
 * ### ⚠️ v1.51.20 · **R1** — AHORA SÍ ES UN ADAPTADOR PROPIO, COMO EL DE POSICIÓN
 * Hasta v1.51.19 el token se ataba con **`useExisting: InventoryService`**, y este bloque lo
 * defendía diciendo que un adaptador *«tendría que reimplementar el pipeline o llamarlo, es decir,
 * una segunda forma de publicar»*. **La primera mitad sería un bug; la segunda es justo lo que hace
 * `InventoryPublishAdapter`: delegar.** *Delegar no es reimplementar* — el pipeline
 * (`assertPublishableGuards` + `resolvePublishSalePrice` + `claimListed`) sigue **en un solo sitio**.
 *
 * Lo que se gana, y por lo que se cambia:
 * - **Comprobación EN COMPILACIÓN.** `InventoryService` **no declaraba `implements
 *   InventoryPublishPort`**, así que renombrar `reevaluateForPublication` dejaba `tsc` verde, las
 *   specs verdes (mockean el puerto) y **los tres consumidores reventando en runtime capturando el
 *   error** ⇒ la auto-publicación **apagada entera**, con un `logger.warn` como único síntoma.
 * - **Lo que hay detrás del token deja de ser el servicio de ESCRITURA completo.** El puerto promete
 *   exponer *«una capacidad, no una autoridad»*; con `useExisting`, quien resolviera el token tenía
 *   `bulkPublish`, `publishAll` y `convertToInventory` en la mano. *La promesa la cumplía la buena
 *   educación del llamador, no el tipo.*
 *
 * **Y el cableado se ASEVERA** (`test/app.module.spec.ts`): con `@Optional()` + `catch` en los tres
 * consumidores, sacar este módulo del grafo compilaba, pasaba el smoke de DI y pasaba la suite
 * entera **con la publicación apagada en silencio**.
 *
 * ### ⚠️ EL CICLO QUE ESTO EVITA, escrito para el próximo que mueva la inyección
 * `InventoryService` depende de `PricingService`. Si el consumidor del disparador **(c)** fuera
 * `PricingService`, el grafo sería `PricingService → INVENTORY_PUBLISH_PORT → InventoryService →
 * PricingService`: **un ciclo de providers**, que solo se resuelve con `forwardRef` — justo la
 * fragilidad que el patrón de puertos existe para evitar.
 * **Por eso el consumidor de (c) NO puede ser `PricingService`**: tiene que ser una hoja del grafo
 * (un controller o un job), que nadie inyecta. Está anotado en `BACKEND_NOTES.md`.
 */
@Global()
@Module({
  imports: [InventoryModule],
  // ⚠️ El alias se declara AQUÍ, no en `InventoryModule`, y no es un detalle de Nest: re-exportar un
  // token ajeno no se puede, y re-exportar `InventoryModule` entero **publicaría globalmente todo su
  // grafo de servicios de ESCRITURA** — exactamente lo que §4.39f prohíbe. Declarándolo en este
  // módulo, lo único que sale al resto del backend es **el token**.
  // El adaptador es un provider PRIVADO de este módulo: fuera solo existe el token. Nadie puede
  // inyectar `InventoryPublishAdapter` por su clase concreta y saltarse el seam — misma disciplina,
  // línea por línea, que `InventoryPositionModule`.
  providers: [
    InventoryPublishAdapter,
    { provide: INVENTORY_PUBLISH_PORT, useExisting: InventoryPublishAdapter },
  ],
  exports: [INVENTORY_PUBLISH_PORT],
})
export class InventoryPublishModule {}
