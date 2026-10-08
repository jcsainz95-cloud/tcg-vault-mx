/**
 * WishlistModule — rev v1.87⟨wishlist⟩ (API_CONTRACT §WSH, ARCHITECTURE §4.WSH (a)). Dueño de `WishlistItem`,
 * `WishlistNotice` y `WishlistMail`. Lee precios por los seams de `pricing` y la vendibilidad por `CatalogService`;
 * la lista de compra pide la cotización del buylist. ⛔ No importa nada que escriba `Order`, `InventoryItem` ni Stripe.
 * Sin ciclo: ni `CatalogModule`, ni `PricingModule`, ni `BuylistModule` importan éste. Lo importan `PaymentsModule`
 * (se quita sola al pagar) y `JobsModule` (el planificador y el disparo manual).
 */
import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { PricingModule } from '../pricing/pricing.module';
import { BuylistModule } from '../buylist/buylist.module';
import { WishlistService } from './wishlist.service';
import { WishlistMarketService } from './wishlist-market.service';
import { WishlistNotifyService } from './wishlist-notify.service';
import { WishlistDemandService } from './wishlist-demand.service';
import { WishlistController, WishlistDemandController, WishlistMailActionsController } from './wishlist.controller';
import { systemWishlistClock, WISHLIST_CLOCK } from './wishlist.constants';

@Module({
  imports: [CatalogModule, PricingModule, BuylistModule],
  providers: [
    WishlistService,
    WishlistMarketService,
    WishlistNotifyService,
    WishlistDemandService,
    { provide: WISHLIST_CLOCK, useValue: systemWishlistClock },
  ],
  controllers: [WishlistController, WishlistMailActionsController, WishlistDemandController],
  exports: [WishlistService, WishlistNotifyService],
})
export class WishlistModule {}
