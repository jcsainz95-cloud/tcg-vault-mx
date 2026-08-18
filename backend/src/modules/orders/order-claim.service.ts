import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrderAccessTokenService } from './order-access-token.service';
import { normalizeEmail } from './guest-privacy';

/** Motivo por el que un pedido no se pudo reclamar (§4-G.9). Parcial-tolerante: no tumba el lote. */
export type ClaimFailureCode = 'ORDER_ALREADY_CLAIMED' | 'CLAIM_EMAIL_MISMATCH' | 'NOT_FOUND';

/**
 * OrderClaimService — reclamo del pedido de invitado (conversión a cuenta, §4-G.9 / ARCHITECTURE
 * §4.21f).
 *
 * PRUEBA DE TITULARIDAD: el **correo verificado** de la sesión. Es exactamente la misma prueba con
 * la que el invitado recibió su enlace; sin ella, registrarse con el correo de un tercero bastaría
 * para quedarse su pedido. El `emailVerified` lo exige el `EmailVerifiedGuard` en el controlador;
 * aquí se compara el correo VERIFICADO de la cuenta (leído por `id`, nunca por correo) contra
 * `Order.guestEmail`.
 *
 * El token NO es prueba alternativa: sirve para LEER, nunca para APROPIARSE.
 */
@Injectable()
export class OrderClaimService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tokens: OrderAccessTokenService,
  ) {}

  /** Correo normalizado de la sesión, leído de BD por `id` (no del JWT, que puede ir desfasado). */
  private async sessionEmail(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, emailVerified: true },
    });
    if (!user || !user.emailVerified) return null;
    return normalizeEmail(user.email);
  }

  /**
   * `GET /orders/claimable` — pedidos de invitado SIN reclamar cuyo `guestEmail` == el correo
   * verificado de la sesión. NO es un oráculo: solo informa sobre el correo de quien pregunta y
   * nunca acepta un correo como parámetro.
   */
  async listClaimable(userId: string) {
    const email = await this.sessionEmail(userId);
    if (!email) return { data: [] };
    const orders = await this.prisma.order.findMany({
      where: { guestEmail: email, userId: null, claimedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { items: true } } },
    });
    return {
      data: orders.map((o) => ({
        orderId: o.id,
        orderNumber: o.orderNumber ?? '',
        status: o.status,
        totalCents: o.totalCents,
        itemCount: o._count.items,
        createdAt: o.createdAt,
        settledAt: o.settledAt ?? undefined,
      })),
    };
  }

  /**
   * `POST /orders/claim` — vinculación EXPLÍCITA (nunca silenciosa) y de UNA SOLA VEZ.
   *
   * Ganador único por UPDATE condicional:
   *   `UPDATE Order SET userId=:me, claimedAt=now() WHERE id=:id AND userId IS NULL AND guestEmail=:mail`
   * `count===1` gana; `count===0` ⇒ ya reclamado o correo distinto. Cierra la carrera de dos
   * reclamos simultáneos (criterio 55) sin bloqueos ni transacción serializable.
   *
   * Efectos (y SOLO estos, criterio 54): `userId`, `claimedAt`, revocación de TODOS los
   * `OrderAccessToken` del pedido y `AuditLog`. NO cambia destino, precio, desglose, políticas,
   * estado del pedido ni el estado/propiedad de los items. Un pedido ya enviado se reclama igual.
   */
  async claim(
    actor: { id: string; role: Role },
    orderIds: string[],
    now = new Date(),
  ): Promise<{ claimed: string[]; failed: { orderId: string; code: ClaimFailureCode }[] }> {
    const email = await this.sessionEmail(actor.id);
    const claimed: string[] = [];
    const failed: { orderId: string; code: ClaimFailureCode }[] = [];

    for (const orderId of [...new Set(orderIds)]) {
      const res = email
        ? await this.prisma.order.updateMany({
            where: { id: orderId, userId: null, guestEmail: email },
            data: { userId: actor.id, claimedAt: now },
          })
        : { count: 0 };

      if (res.count === 1) {
        claimed.push(orderId);
        // Una vez que el pedido tiene una credencial real detrás, dejar puertas sin contraseña
        // abiertas suma riesgo sin aportar nada: el enlace viejo responde 410 (reason CLAIMED).
        await this.tokens.revokeAll(orderId, now);
        await this.audit.log({
          actorUserId: actor.id,
          actorRole: actor.role,
          action: 'order.claim',
          entityType: 'Order',
          entityId: orderId,
          after: { claimedAt: now.toISOString() },
        });
        continue;
      }
      failed.push({ orderId, code: await this.failureCodeFor(orderId, email) });
    }
    return { claimed, failed };
  }

  /** Diagnóstico del fallo. Solo sobre ids que el propio llamante envió (uuids no adivinables). */
  private async failureCodeFor(orderId: string, email: string | null): Promise<ClaimFailureCode> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { userId: true, guestEmail: true },
    });
    if (!order || order.guestEmail == null) return 'NOT_FOUND';
    if (order.userId != null) return 'ORDER_ALREADY_CLAIMED';
    if (email == null || order.guestEmail !== email) return 'CLAIM_EMAIL_MISMATCH';
    return 'NOT_FOUND';
  }
}
