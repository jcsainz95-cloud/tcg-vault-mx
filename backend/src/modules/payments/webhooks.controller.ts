import { Controller, Headers, HttpCode, Logger, Post, Req } from '@nestjs/common';
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
  private readonly logger = new Logger(WebhooksController.name);

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
    // Fix QA #1: NO tragamos el error. Si el handler falla (p. ej. DB transitoria),
    // dejamos propagar la excepción → el filtro global responde 5xx y Stripe reintenta
    // (el evento no quedó marcado como procesado, ver PaymentsService.handleEvent).
    // Eventos ya procesados o no manejados retornan sin lanzar → responde 200.
    await this.payments.handleEvent(event);
    this.logger.debug(`Stripe event ${event.id} (${event.type}) procesado.`);
    return { received: true };
  }
}
