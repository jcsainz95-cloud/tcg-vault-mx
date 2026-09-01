import { Global, Module } from '@nestjs/common';
import { PricingModule } from '../pricing/pricing.module';
import { INVENTORY_POSITION_PORT } from './inventory-position.port';
import { InventoryPositionAdapter } from './inventory-position.adapter';

/**
 * v1.51 (M-46, ARCHITECTURE §4.39f) — módulo **@Global** que provee y exporta **solo**
 * `INVENTORY_POSITION_PORT`.
 *
 * ### Por qué un módulo propio y no `InventoryModule`
 * El puerto tiene que estar disponible en `buylist` **sin** que `BuylistModule` importe
 * `InventoryModule` (§4.39f: acoplar dos streams en el grafo de módulos hace que un cambio de
 * providers en uno pueda romper el arranque del otro). El patrón es el mismo de `MAIL_PORT`
 * (`MailModule` es `@Global`), con una diferencia deliberada: **`InventoryModule` NO se vuelve
 * global**. Hacerlo publicaría el grafo entero de servicios de ESCRITURA de inventario a todo el
 * backend; aquí lo único que sale es **un token de solo lectura**.
 *
 * El adaptador es un provider PRIVADO de este módulo: fuera solo existe el token. Nadie puede
 * inyectar `InventoryPositionAdapter` por su clase concreta y saltarse el seam.
 */
@Global()
@Module({
  imports: [PricingModule],
  providers: [
    InventoryPositionAdapter,
    { provide: INVENTORY_POSITION_PORT, useExisting: InventoryPositionAdapter },
  ],
  exports: [INVENTORY_POSITION_PORT],
})
export class InventoryPositionModule {}
