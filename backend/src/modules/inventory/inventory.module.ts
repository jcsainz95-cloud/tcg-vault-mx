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
