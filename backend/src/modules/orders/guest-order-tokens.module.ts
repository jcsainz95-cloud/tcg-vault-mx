import { Module } from '@nestjs/common';
import { OrderAccessTokenService } from './order-access-token.service';
import { GuestOrderMailService } from './guest-order-mail.service';

/**
 * GuestOrderTokensModule — pieza MÍNIMA compartida por `orders` y `payments`: emisión/validación
 * del enlace tokenizado y el correo del invitado.
 *
 * Existe para evitar un ciclo de módulos: `payments` necesita emitir el enlace al liquidar, pero
 * `OrdersModule` ya depende (vía el `PaymentsModule` global) de `StripeService`. Este módulo no
 * importa nada (Prisma, Config y MAIL_PORT son globales), así que ambos lo pueden importar sin
 * crear dependencias circulares.
 */
@Module({
  providers: [OrderAccessTokenService, GuestOrderMailService],
  exports: [OrderAccessTokenService, GuestOrderMailService],
})
export class GuestOrderTokensModule {}
