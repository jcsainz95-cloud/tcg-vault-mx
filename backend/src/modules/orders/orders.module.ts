import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { AdminOrdersController } from './admin-orders.controller';
import { GuestCheckoutService } from './guest-checkout.service';
import { GuestOrdersController } from './guest-orders.controller';
import { OrderClaimService } from './order-claim.service';
import { GuestOrderTokensModule } from './guest-order-tokens.module';
import { RejectAuthenticatedGuard } from './guards/reject-authenticated.guard';
import { PricingModule } from '../pricing/pricing.module';
import { CatalogModule } from '../catalog/catalog.module';

@Module({
  // JwtModule.register({}) (sin secreto por defecto): lo usa RejectAuthenticatedGuard para
  // DETECTAR una sesión válida en los endpoints públicos de invitado; el secreto se pasa
  // explícitamente en cada verify (mismo patrón que JwtAuthGuard). No autentica a nadie.
  imports: [PricingModule, CatalogModule, GuestOrderTokensModule, JwtModule.register({})],
  providers: [OrdersService, GuestCheckoutService, OrderClaimService, RejectAuthenticatedGuard],
  controllers: [OrdersController, AdminOrdersController, GuestOrdersController],
  exports: [OrdersService, GuestCheckoutService],
})
export class OrdersModule {}
