import { Global, Module } from '@nestjs/common';
import { InventoryModule } from './inventory.module';
import { InventoryService } from './inventory.service';
import { INVENTORY_PUBLISH_PORT } from './inventory-publish.port';

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
 * La diferencia con el de posición es que aquí el token **no se ata a un adaptador propio, sino a
 * `InventoryService`**, y eso es deliberado: el trabajo que hay que disparar **es** el pipeline de
 * publicación —`assertPublishableGuards` + `resolvePublishSalePrice` + `claimListed`— y un adaptador
 * separado tendría que **reimplementarlo o llamarlo**, es decir, **una segunda forma de publicar**.
 * *El puerto expone una capacidad que ya existe; no fabrica una paralela.*
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
  providers: [{ provide: INVENTORY_PUBLISH_PORT, useExisting: InventoryService }],
  exports: [INVENTORY_PUBLISH_PORT],
})
export class InventoryPublishModule {}
