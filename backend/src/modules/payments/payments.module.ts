import { Global, Module } from '@nestjs/common';
import { StripeService } from './stripe.service';
import { PaymentsService } from './payments.service';
import { WebhooksController } from './webhooks.controller';

@Global()
@Module({
  providers: [StripeService, PaymentsService],
  controllers: [WebhooksController],
  exports: [StripeService, PaymentsService],
})
export class PaymentsModule {}
