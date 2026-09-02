import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { MasterSetService } from './master-set.service';
import { SealedGradedInventoryService } from './sealed-graded.service';
// v1.36-sealed-alta (M-37, P-35): alta dedicada de sellado (listado de productos sellados del set).
import { SealedCatalogAdminService } from './sealed-catalog-admin.service';
// v1.39-sealed-product-module (M-39, P-38): catálogo `SealedProduct` persistido + sync + curación.
import { SealedProductService } from './sealed-product.service';
import { InventoryController } from './inventory.controller';
import { PricingModule } from '../pricing/pricing.module';
// v1.51.18 (BL-25, §4.39m.5) / v1.51.20 (R1): el puerto de DISPARO de publicación
// (`INVENTORY_PUBLISH_PORT`) se declara y provee en `inventory-publish.module.ts` (@Global), atado a
// un ADAPTADOR PRIVADO (`InventoryPublishAdapter implements InventoryPublishPort`) que **delega** en
// `InventoryService`. Delegar no es reimplementar: el pipeline de publicación sigue en un solo
// sitio, y el `implements` es lo que hace que romper la firma **falle en compilación** en vez de
// apagar la auto-publicación en silencio. Este módulo NO se vuelve global: fuera solo sale un token.

@Module({
  imports: [PricingModule],
  providers: [
    InventoryService,
    MasterSetService,
    SealedGradedInventoryService,
    SealedCatalogAdminService,
    SealedProductService,
  ],
  controllers: [InventoryController],
  exports: [
    InventoryService,
    MasterSetService,
    SealedGradedInventoryService,
    SealedCatalogAdminService,
    SealedProductService,
  ],
})
export class InventoryModule {}
