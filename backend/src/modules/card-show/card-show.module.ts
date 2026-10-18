import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CryptoModule } from '../../common/crypto/crypto.module';
import { AuditModule } from '../audit/audit.module';
import { CardShowController } from './card-show.controller';
import { CardShowAdminController } from './card-show-admin.controller';
import { CardShowService } from './card-show.service';
import { CardShowTokensService } from './card-show-tokens.service';
import { CardShowThrottleService } from './card-show-throttle.service';
import { CardShowBudgetService } from './card-show-budget.service';
import { CardShowMailboxCapsService } from './card-show-mailbox-caps.service';
import { CardShowMailService, DnsMxResolver, MX_RESOLVER } from './card-show-mail.service';
import { CardShowWebhookService } from './card-show-webhook.service';
import { cardShowCounterStoreProvider } from './card-show-counter.store';

/**
 * card-show.module.ts — v1.93⟨cardshow⟩ (API_CONTRACT §CARDSHOW). Landing del Card Show: captura
 * pública, doble opt-in y anti-abuso SIN captcha. Reusa `MAIL_PORT` (Global en MailModule),
 * `PiiCryptoService` (CryptoModule), `AuditService` (AuditModule), Redis y `@Public`.
 */
@Module({
  imports: [PrismaModule, CryptoModule, AuditModule],
  controllers: [CardShowController, CardShowAdminController],
  providers: [
    CardShowService,
    CardShowTokensService,
    CardShowThrottleService,
    CardShowBudgetService,
    CardShowMailboxCapsService,
    CardShowMailService,
    CardShowWebhookService,
    cardShowCounterStoreProvider,
    { provide: MX_RESOLVER, useClass: DnsMxResolver },
  ],
})
export class CardShowModule {}
