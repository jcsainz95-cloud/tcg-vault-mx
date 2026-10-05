/**
 * 🔒 guest-mail-link.ts — la liga del CLIENTE en los avisos de un PEDIDO (`API_CONTRACT §M4-SHIP.19.35.1`, P-D2E-1; PS-87 reescrita;
 * SDX-R14 de §19.35.6; `ARCHITECTURE §4.60 (ab)`). UN cuerpo, dos caminos de envío: los avisos de envío (`ShipmentsService.claimAndNotify`:
 * `AV-4/5/6/17/18/19`) y el de reembolso (`RefundLedgerService.notifyCustomer`: `AV-12`). ⛔ No se copia.
 *
 * ```
 * order.userId ≠ null (registrado o RECLAMADO)        ⇒ appUrl('orders/<id>')                       ⛔ sin token
 * order.userId = null ∧ guestEmail ≠ null:
 *    sin origen público (APP_PUBLIC_URL)            ⇒ null  (un enlace que no se puede escribir no acuña token)
 *    createdAt < now − GUEST_TRACKING_MAX_AGE_DAYS  ⇒ null  (sin CTA; §4-G.7 «tope de edad»)
 *    si no ⇒ OrderAccessTokenService.issue(id, { rotate: false })  (90 días; ⛔ NO rota: la liga de la confirmación y la de
 *            cada aviso anterior SIGUEN sirviendo, T.8) + AuditLog `order.tracking_link.reissue` actor `system:mail`
 *            `{ notice, rotated: false }` (⛔ ni el claro ni el hash) ⇒ appUrl('pedido?token=<claro>')
 *    la emisión falla ⇒ null + log warn (⛔ sin token ni mensaje crudo); el aviso sale igual, sin CTA
 * ```
 * - **Discriminante `order.userId`, no `guestEmail`:** un pedido reclamado conserva `guestEmail` (el correo le sigue llegando ahí,
 *   §R.5) pero el reclamo revocó todos sus tokens; emitirle uno reabriría la puerta que el reclamo cerró.
 * - ⛔ **Cuándo:** SOLO desde el camino de envío, después de ganar el sello y con destinatario, justo antes de renderizar. Jamás desde
 *   `resolveRecipient` (también lo usa `recipientEmailOf`, la compra de la guía: acuñaría tokens que nadie recibe).
 * - ⛔ **Cupo:** no consulta `resendQuotaExceeded`, y `resendQuotaExceeded` no cambia (sigue contando todas las filas). Efecto aceptado
 *   (§19.35.1): un día con ≥ 5 emisiones deja el reenvío self-service en no-op hasta que corra la ventana.
 * - El interruptor no cambia: el reenvío (§4-G.4), el reenvío de soporte (§4-G.9b) y el reclamo revocan TODOS, incluidos estos.
 */
import { Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { appUrl } from '../buylist/mail-shell';
import { OrderAccessTokenService } from '../orders/order-access-token.service';
import { DAY_MS, GUEST_TRACKING_MAX_AGE_DAYS } from '../orders/guest-checkout.constants';

/** Actor de la bitácora de la emisión por correo (sin persona: `actorUserId` nulo). */
export const MAIL_ACTOR = 'system:mail';

/** Los avisos con CTA al cliente de un pedido (§19.35.1 «Aplica a»). */
export type OrderMailNotice = 'AV-4' | 'AV-5' | 'AV-6' | 'AV-12' | 'AV-17' | 'AV-18' | 'AV-19';

/** Lo que la regla lee del pedido (por id, ⛔ nunca del body ni del snapshot). */
export interface OrderMailLinkTarget {
  id: string;
  userId: string | null;
  guestEmail: string | null;
  createdAt: Date;
}

export interface OrderMailLinkDeps {
  prisma: PrismaService;
  /** `@Optional()` en los servicios (pruebas unitarias legacy): sin él, el invitado va sin CTA (y se avisa). */
  tokens?: OrderAccessTokenService;
  logger: Logger;
}

/** El enlace del CTA de un aviso de pedido. Nunca lanza: ante cualquier fallo devuelve `null` (sin CTA). */
export async function orderMailLinkOf(
  deps: OrderMailLinkDeps,
  order: OrderMailLinkTarget,
  locale: string | null,
  notice: OrderMailNotice,
  now: Date = new Date(),
): Promise<string | null> {
  try {
    if (order.userId != null) return appUrl(`orders/${encodeURIComponent(order.id)}`, locale) ?? null;
    if (!order.guestEmail) return null;
    if (!appUrl('pedido', locale)) return null;
    if (order.createdAt.getTime() < now.getTime() - GUEST_TRACKING_MAX_AGE_DAYS * DAY_MS) return null;
    if (!deps.tokens) {
      deps.logger.warn(`${notice} for order ${order.id}: guest link skipped (OrderAccessTokenService unavailable)`);
      return null;
    }
    const { clear, expiresAt } = await deps.tokens.issue(order.id, { rotate: false });
    await deps.prisma.auditLog.create({
      data: {
        actorUserId: null,
        actorRole: null,
        action: 'order.tracking_link.reissue',
        entityType: 'Order',
        entityId: order.id,
        after: { actor: MAIL_ACTOR, notice, rotated: false, expiresAt: expiresAt.toISOString() },
      },
    });
    return appUrl(`pedido?token=${encodeURIComponent(clear)}`, locale) ?? null;
  } catch (e) {
    // ⛔ Ni el claro ni el mensaje crudo (un error de Prisma puede citar valores): solo la clase/código. Si la bitácora falló
    // DESPUÉS de emitir, ese token queda vivo sin haber viajado a nadie (inofensivo: el claro se descarta aquí).
    const code = (e as { code?: unknown } | null)?.code;
    deps.logger.warn(`${notice} for order ${order.id}: guest link not issued (${e instanceof Error ? e.name : 'error'}${code ? ` ${String(code)}` : ''}); mail goes without CTA`);
    return null;
  }
}
