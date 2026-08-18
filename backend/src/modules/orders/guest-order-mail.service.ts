import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Locale } from '@prisma/client';
import { MAIL_PORT, MailPort } from '../mail/mail.port';
import { OrderAccessTokenService } from './order-access-token.service';
import {
  GuestOrderMailItem,
  guestOrderConfirmationTemplate,
  guestTrackingLinkTemplate,
} from './mail/guest-order.templates';

/**
 * GuestOrderMailService — emite el enlace tokenizado y envía el correo del invitado.
 *
 * ARCHITECTURE §4.21g: NO se toca el módulo `mail` por dentro. Se inyecta el puerto global
 * `MAIL_PORT` (`@Optional()`, como hizo `buylist` en v1.18) y se renderiza la plantilla local.
 *
 * Envío BEST-EFFORT POST-COMMIT: cualquier fallo (puerto ausente, proveedor caído) se loguea y
 * NUNCA revierte el pago ni hace fallar el webhook (un 5xx haría que Stripe reintentara un settle
 * ya aplicado). La red de seguridad es triple: el `checkoutToken` que ya devolvió
 * `POST /checkout/guest/session`, el reenvío self-service y el reenvío de soporte.
 */
@Injectable()
export class GuestOrderMailService {
  private readonly logger = new Logger(GuestOrderMailService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly tokens: OrderAccessTokenService,
    @Optional() @Inject(MAIL_PORT) private readonly mail?: MailPort,
  ) {}

  /**
   * URL del frontend con el token en la query: `${origin}/${locale}/pedido?token=<claro>`
   * (§4-G.7). El front lo mueve al body de `POST /orders/guest/track` y lo borra de la URL.
   * El token es un SECRETO DE URL: no se loguea nunca.
   */
  buildTrackingUrl(clearToken: string, locale?: Locale | null): string {
    const raw = this.config.get<string>('APP_BASE_URL') ?? '';
    const origin = raw.split(',')[0].trim() || 'http://localhost:3000';
    const l = locale ?? (this.config.get<string>('DEFAULT_LOCALE') as Locale | undefined) ?? 'es';
    return `${origin}/${l}/pedido?token=${encodeURIComponent(clearToken)}`;
  }

  /**
   * Correo de CONFIRMACIÓN al liquidar (criterio 49). Emite el token de SEGUIMIENTO: TTL por
   * defecto (90 días) y **`rotate:false` A PROPÓSITO** (§4-G.7a): rotar aquí mataría el
   * `checkoutToken` que el navegador está usando en la confirmación post-3DS. Es la ÚNICA
   * excepción a la rotación, y es segura porque ese token de checkout caduca solo en 120 min.
   */
  async sendConfirmation(order: {
    id: string;
    orderNumber: string | null;
    guestEmail: string | null;
    locale: Locale | null;
    totalCents: number;
    items: GuestOrderMailItem[];
  }): Promise<void> {
    await this.safeSend(order.id, async () => {
      if (!order.guestEmail) return null;
      const { clear } = await this.tokens.issue(order.id, { rotate: false });
      const msg = guestOrderConfirmationTemplate(
        {
          orderNumber: order.orderNumber ?? '',
          items: order.items,
          totalCents: order.totalCents,
          trackingUrl: this.buildTrackingUrl(clear, order.locale),
        },
        order.locale,
      );
      return { ...msg, to: order.guestEmail };
    });
  }

  /**
   * Correo de REENVÍO del enlace (self-service §4-G.4 y soporte §4-G.9b). ROTA: emitir uno nuevo
   * revoca los vigentes ⇒ solo el último enlace funciona. SIEMPRE se envía a `Order.guestEmail`,
   * JAMÁS al correo que venga en el request. Devuelve la expiración del token emitido.
   */
  async sendTrackingLink(order: {
    id: string;
    orderNumber: string | null;
    guestEmail: string | null;
    locale: Locale | null;
  }): Promise<Date | null> {
    if (!order.guestEmail) return null;
    const { clear, expiresAt } = await this.tokens.issue(order.id, { rotate: true });
    const msg = guestTrackingLinkTemplate(
      { orderNumber: order.orderNumber ?? '', trackingUrl: this.buildTrackingUrl(clear, order.locale) },
      order.locale,
    );
    await this.safeSend(order.id, async () => ({ ...msg, to: order.guestEmail as string }));
    return expiresAt;
  }

  /** Envoltura best-effort: nunca propaga, nunca loguea el token ni el correo del destinatario. */
  private async safeSend(
    orderId: string,
    build: () => Promise<{ to: string; subject: string; html: string; text: string } | null>,
  ): Promise<void> {
    try {
      if (!this.mail) {
        this.logger.warn(`guest mail skipped for order ${orderId}: MAIL_PORT unavailable`);
        return;
      }
      const msg = await build();
      if (!msg) {
        this.logger.warn(`guest mail skipped for order ${orderId}: no recipient`);
        return;
      }
      await this.mail.send(msg);
    } catch (e) {
      this.logger.error(`guest mail failed for order ${orderId}: ${(e as Error).message}`);
    }
  }
}
