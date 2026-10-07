import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { AdminOrdersController } from './admin-orders.controller';
import { GuestCheckoutService } from './guest-checkout.service';
import { GuestOrdersController } from './guest-orders.controller';
import { SupportContactController } from './support-contact.controller';
import { OrderClaimService } from './order-claim.service';
import { OrderRefundService } from './order-refund.service';
import { GuestOrderTokensModule } from './guest-order-tokens.module';
import { RejectAuthenticatedGuard } from './guards/reject-authenticated.guard';
import { PricingModule } from '../pricing/pricing.module';
import { CatalogModule } from '../catalog/catalog.module';
import { GeoModule } from '../shipping-provider/geo/geo.module';
import { DecksMetaModule } from '../decks-meta/decks-meta.module';

@Module({
  // JwtModule.register({}) (sin secreto por defecto): lo usa RejectAuthenticatedGuard para
  // DETECTAR una sesión válida en los endpoints públicos de invitado; el secreto se pasa
  // explícitamente en cada verify (mismo patrón que JwtAuthGuard). No autentica a nadie.
  // ⭐ v1.81 (M-64): `GeoModule` — la colonia del invitado contra la lista del CP (§M4-SHIP.19.5).
  // 💰 v1.86⟨accesorios⟩ (§AC.19.4): `DecksMetaModule` exporta el validador de `deckPulls` que llama el checkout de invitado.
  imports: [PricingModule, CatalogModule, GuestOrderTokensModule, JwtModule.register({}), GeoModule, DecksMetaModule],
  providers: [OrdersService, GuestCheckoutService, OrderClaimService, OrderRefundService, RejectAuthenticatedGuard],
  // v1.82 PNL-1: `GET /support/contact` (público, un resolutor del buzón — `mail/support-contact.ts`).
  controllers: [OrdersController, AdminOrdersController, GuestOrdersController, SupportContactController],
  exports: [OrdersService, GuestCheckoutService],
})
export class OrdersModule {}
