import { Controller, Headers, HttpCode, Logger, Post, Req } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { PaymentsService } from './payments.service';
import { StripeWebhookSecretMissingError } from './stripe.service';
import { BusinessException } from '../../common/business.exception';

/**
 * POST /webhooks/stripe — Firma verificada. Idempotente. API_CONTRACT §9.
 * Requiere el raw body (configurado en main.ts).
 */
// SEC-C1: el webhook de Stripe es legítimo y de alto volumen (firma verificada +
// idempotencia); se exime del rate-limit global para no descartar eventos válidos.
@SkipThrottle()
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
      // P-WH-1: dos fallos que PARECEN el mismo y no lo son.
      //
      // (a) Firma inválida ⇒ 400 (contrato §9): el llamador mandó algo que no verifica.
      // (b) Secreto de webhook AUSENTE ⇒ 503. No es culpa del llamador y decirle 400 sería mentir
      //     dos veces: (1) marca un fallo de configuración NUESTRO como error de cliente y lo
      //     entierra entre el ruido de firmas forjadas —justo el evento que debe hacer ruido—, y
      //     (2) un `payment_intent.succeeded` LEGÍTIMO que llegara con el secreto sin poner
      //     quedaría clasificado como basura. Con 5xx, Stripe reintenta hasta 3 días: el evento
      //     SOBREVIVE al arreglo de config y la orden se liquida cuando el secreto aparece. Sí,
      //     eso es un bucle de reintentos mientras la config esté rota — es el modo de fallo
      //     QUERIDO: ruidoso, retenido y reversible, en vez de silencioso y con el dinero perdido.
      //     El mensaje al cable es genérico a propósito (no se le confirma a un atacante el estado
      //     de nuestra config); el detalle va al log de `StripeService`.
      if (e instanceof StripeWebhookSecretMissingError) {
        this.logger.error(`Webhook rechazado por configuración: ${(e as Error).message}`);
        throw BusinessException.retriable(
          'INTERNAL',
          'Webhook signature verification is temporarily unavailable; retry later.',
        );
      }
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
