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
// v1.51.18 (BL-25, §4.39m.5): el puerto de DISPARO de publicación (`INVENTORY_PUBLISH_PORT`) se ata
// a `InventoryService` —el trabajo a disparar ES su pipeline; un adaptador aparte sería una segunda
// forma de publicar— pero se DECLARA en `inventory-publish.module.ts` (@Global), que es quien lo
// expone al resto del backend sin publicar este módulo entero.

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
