import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { PricingModule } from '../pricing/pricing.module';
import { InventoryPublishModule } from '../inventory/inventory-publish.module';
import { SupplierAccessService } from './supplier-access.service';
import { SupplyPricingService } from './supply-pricing.service';
import { SupplyRequestService } from './supply-request.service';
import { SupplyOfferService } from './supply-offer.service';
import { SupplyPurchaseService } from './supply-purchase.service';
import { SupplyExpiryService } from './supply-expiry.service';
import { AdminSupplyController, SupplierAuthController, SupplierPortalController } from './supply.controllers';

/** §PROV F1 — portal de proveedores, sentido A (compra a tiendas aliadas). Dueño de Supplier*, Supply*. */
@Module({
  imports: [AuthModule, MailModule, PricingModule, InventoryPublishModule],
  providers: [SupplierAccessService, SupplyPricingService, SupplyRequestService, SupplyOfferService, SupplyPurchaseService, SupplyExpiryService],
  controllers: [SupplierAuthController, SupplierPortalController, AdminSupplyController],
  exports: [SupplyExpiryService],
})
export class SupplyModule {}
