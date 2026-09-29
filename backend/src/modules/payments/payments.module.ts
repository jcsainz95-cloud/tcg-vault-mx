import { Global, Module } from '@nestjs/common';
import { StripeService } from './stripe.service';
import { PaymentsService } from './payments.service';
import { WebhooksController } from './webhooks.controller';
import { GuestOrderTokensModule } from '../orders/guest-order-tokens.module';
import { FullRefundService } from './refunds/full-refund.service';
import { RefundLedgerService } from './refunds/refund-ledger.service';
import { RefundReportsService } from './refunds/refund-reports.service';
import { AdminRefundsController } from './refunds/admin-refunds.controller';

@Global()
@Module({
  // v1.21-guest-checkout: al liquidar un pedido `direct_ship` hay que emitir el enlace tokenizado
  // y enviar el correo. Se importa el módulo MÍNIMO (sin dependencias) en vez de `OrdersModule`,
  // para no crear un ciclo con el `PaymentsModule` global del que `orders` consume `StripeService`.
  imports: [GuestOrderTokensModule],
  providers: [StripeService, PaymentsService, FullRefundService, RefundLedgerService, RefundReportsService],
  controllers: [WebhooksController, AdminRefundsController],
  exports: [StripeService, PaymentsService, FullRefundService, RefundLedgerService, RefundReportsService],
})
export class PaymentsModule {}
