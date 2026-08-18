import { Global, Module } from '@nestjs/common';
import { StripeService } from './stripe.service';
import { PaymentsService } from './payments.service';
import { WebhooksController } from './webhooks.controller';
import { GuestOrderTokensModule } from '../orders/guest-order-tokens.module';

@Global()
@Module({
  // v1.21-guest-checkout: al liquidar un pedido `direct_ship` hay que emitir el enlace tokenizado
  // y enviar el correo. Se importa el módulo MÍNIMO (sin dependencias) en vez de `OrdersModule`,
  // para no crear un ciclo con el `PaymentsModule` global del que `orders` consume `StripeService`.
  imports: [GuestOrderTokensModule],
  providers: [StripeService, PaymentsService],
  controllers: [WebhooksController],
  exports: [StripeService, PaymentsService],
})
export class PaymentsModule {}
