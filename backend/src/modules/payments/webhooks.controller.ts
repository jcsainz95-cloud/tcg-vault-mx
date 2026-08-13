import { Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { PaymentsService } from './payments.service';
import { BusinessException } from '../../common/business.exception';

/**
 * POST /webhooks/stripe — Firma verificada. Idempotente. API_CONTRACT §9.
 * Requiere el raw body (configurado en main.ts).
 */
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly payments: PaymentsService) {}

  @Public()
  @Post('stripe')
  @HttpCode(200)
  async stripe(@Req() req: Request, @Headers('stripe-signature') signature: string) {
    const raw = (req as unknown as { rawBody?: Buffer }).rawBody ?? (req.body as Buffer);
    let event;
    try {
      event = this.payments.verifyAndParse(raw, signature);
    } catch (e) {
      throw BusinessException.badRequest('VALIDATION_ERROR', `Invalid signature: ${(e as Error).message}`);
    }
    // Errores de negocio se registran, no se devuelven a Stripe (API_CONTRACT §9).
    try {
      await this.payments.handleEvent(event);
    } catch (e) {
      // swallow para responder 200; el error queda en logs.
    }
    return { received: true };
  }
}
