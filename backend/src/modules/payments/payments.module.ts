import { Global, Module } from '@nestjs/common';
import { StripeService } from './stripe.service';
import { PaymentsService } from './payments.service';
import { WebhooksController } from './webhooks.controller';
import { GuestOrderTokensModule } from '../orders/guest-order-tokens.module';
import { FullRefundService } from './refunds/full-refund.service';
import { RefundLedgerService } from './refunds/refund-ledger.service';
import { RefundReportsService } from './refunds/refund-reports.service';
import { AdminRefundsController } from './refunds/admin-refunds.controller';
import { ManualRefundService } from './refunds/manual-refund.service';
import { AdminManualRefundsController } from './refunds/admin-manual-refunds.controller';
import { WithdrawalDeliveredRefundService } from './refunds/withdrawal-delivered-refund.service';
import { VaultModule } from '../vault/vault.module';

@Global()
@Module({
  // v1.21-guest-checkout: al liquidar un pedido `direct_ship` hay que emitir el enlace tokenizado
  // y enviar el correo. Se importa el módulo MÍNIMO (sin dependencias) en vez de `OrdersModule`,
  // para no crear un ciclo con el `PaymentsModule` global del que `orders` consume `StripeService`.
  // v1.82 (§PNL.3): `VaultModule` por `VaultService.marketRefOf` — el `M` de la devolución de un retiro entregado es LA
  // valuación de «Mi bóveda» (un cuerpo con «Por reponer»). Sin ciclo de proveedores: vault consume de aquí
  // `ManualRefundService`/`RefundLedgerService` y aquí solo se consume `VaultService` (que no depende de payments).
  imports: [GuestOrderTokensModule, VaultModule],
  providers: [StripeService, PaymentsService, FullRefundService, RefundLedgerService, RefundReportsService, ManualRefundService, WithdrawalDeliveredRefundService],
  controllers: [WebhooksController, AdminRefundsController, AdminManualRefundsController],
  exports: [StripeService, PaymentsService, FullRefundService, RefundLedgerService, RefundReportsService, ManualRefundService],
})
export class PaymentsModule {}
