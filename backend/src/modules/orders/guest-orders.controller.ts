import { Body, Controller, Header, HttpCode, Ip, Post, UseGuards, Headers } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { GuestCheckoutService } from './guest-checkout.service';
import { RejectAuthenticatedGuard } from './guards/reject-authenticated.guard';
import {
  GuestQuoteDto,
  GuestResendLinkDto,
  GuestSessionDto,
  GuestTrackDto,
} from './dto/guest-checkout.dto';

const HOUR_MS = 3_600_000;

/**
 * GUEST CHECKOUT — endpoints públicos (API_CONTRACT §4-G.1–§4-G.4).
 *
 * `@Public()` = sin JWT, y además `RejectAuthenticatedGuard` RECHAZA una sesión válida en
 * `/checkout/guest/*` (`409 ALREADY_AUTHENTICATED`): un usuario con cuenta compra por
 * `/checkout/session`, un invitado por aquí. NO hay endpoint que sirva a los dos (§4-G.0-3).
 *
 * Los rate limits son los TABULADOS por el contrato, por handler (el guard global sigue vigente):
 *   quote 30/min · session 5/h · track 20/min · resend-link 3/h (+ tope por pedido de 5/24h).
 */
@Controller()
export class GuestOrdersController {
  constructor(private readonly guest: GuestCheckoutService) {}

  /** §4-G.1 — desglose sin cobrar. Read-only: NO reserva inventario. */
  @Public()
  @UseGuards(RejectAuthenticatedGuard)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post('checkout/guest/quote')
  @HttpCode(200)
  quote(@Body() dto: GuestQuoteDto) {
    return this.guest.quote(dto);
  }

  /**
   * §4-G.2 — crea el pedido de invitado + UN PaymentIntent (cartas + envío + IVA + fee).
   * Límite 5/h por IP: es la superficie más cara (reserva inventario y crea un PI).
   */
  @Public()
  @UseGuards(RejectAuthenticatedGuard)
  @Throttle({ default: { ttl: HOUR_MS, limit: 5 } })
  @Post('checkout/guest/session')
  @HttpCode(201)
  session(
    @Body() dto: GuestSessionDto,
    @Ip() ip: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.guest.createSession(dto, ip, idempotencyKey);
  }

  /**
   * §4-G.3 — vista pública de UN pedido. Es un POST a propósito: el token viaja en el CUERPO,
   * no en la ruta, para no aparecer en access logs, `Referer`, historial ni cachés intermedias.
   * Cabeceras obligatorias: `Cache-Control: no-store` y `X-Robots-Tag: noindex, nofollow`.
   */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post('orders/guest/track')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Header('X-Robots-Tag', 'noindex, nofollow')
  track(@Body() dto: GuestTrackDto) {
    return this.guest.track(dto.token);
  }

  /**
   * §4-G.4 — reenvía un enlace NUEVO al correo DEL PEDIDO (rota los anteriores).
   * SIEMPRE `202 {status:'ACCEPTED'}`, exista o no el pedido/correo/token (criterio 53).
   */
  @Public()
  @Throttle({ default: { ttl: HOUR_MS, limit: 3 } })
  @Post('orders/guest/resend-link')
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  resendLink(@Body() dto: GuestResendLinkDto) {
    return this.guest.resendLink(dto);
  }
}
