import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { OrderAccessToken } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DAY_MS, GUEST_RESEND_MAX_PER_DAY, GUEST_TRACKING_TTL_DAYS } from './guest-checkout.constants';

/**
 * SHA-256 (hex) del token en claro. Basta SHA-256 (no argon2): 32 bytes aleatorios ≈ 256 bits de
 * entropía → no hay fuerza bruta posible (a diferencia de una contraseña). Mismo criterio que
 * `hashAuthToken` (ARCHITECTURE §3.2); se duplica a propósito para no acoplar `orders` a `auth`.
 */
export function hashOrderAccessToken(clear: string): string {
  return createHash('sha256').update(clear).digest('hex');
}

/**
 * Motivo de revocación (§4-G.3). **Derivado, no persistido** (M-25 no lleva columna de motivo y
 * v1.21.1 decide explícitamente NO añadir una para pintar un texto de UX).
 * Valores normativos tras v1.21.1: `CLAIMED` | `ROTATED`. **`SUPPORT` fue ELIMINADO del contrato.**
 */
export type RevocationReason = 'CLAIMED' | 'ROTATED';

/** Resultado de validar un token presentado. Respuestas NEUTRAS: nunca revela si el pedido existe. */
export type TokenValidation =
  | { ok: true; token: OrderAccessToken }
  | { ok: false; code: 'INVALID_TOKEN' }
  | { ok: false; code: 'TOKEN_EXPIRED'; token: OrderAccessToken }
  | { ok: false; code: 'TOKEN_REVOKED'; token: OrderAccessToken; reason: RevocationReason };

/**
 * OrderAccessTokenService — emisión / validación / rotación / revocación del ENLACE DE SEGUIMIENTO
 * del pedido de invitado (API_CONTRACT §4-G.7, ARCHITECTURE §4.21e).
 *
 * Espejo de `AuthTokenService` con UNA diferencia semántica deliberada: este token es **MULTI-USO**
 * (el invitado reabre su enlace cada vez que quiere ver el pedido), así que `usedAt` (consumo) se
 * sustituye por `revokedAt` (revocación) + `useCount`/`lastUsedAt` (telemetría). Por eso NO se reusa
 * el modelo `AuthToken` (su `userId` es obligatorio y su `consume()` es de un solo uso).
 *
 * Invariantes que este servicio garantiza:
 *  - El claro NUNCA se persiste ni se loguea: solo su SHA-256 (`tokenHash @unique`).
 *  - El lookup es por hash exacto (sin prefijos ni comparación parcial).
 *  - El token NO es una credencial de sesión: no otorga rol y solo identifica UN pedido.
 */
@Injectable()
export class OrderAccessTokenService {
  private readonly logger = new Logger(OrderAccessTokenService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Emite un token para `orderId`: 32 bytes aleatorios (base64url, 43 chars) en claro —que el
   * llamador envía por correo o devuelve a quien acaba de crear el pedido— y persiste SOLO el
   * SHA-256. Devuelve el CLARO (única copia; **no se puede recuperar después**: esa
   * irrecuperabilidad es la propiedad de seguridad T5, no un defecto).
   *
   * **Dos vidas, misma tabla, sin columna nueva (§4-G.7a / ARCHITECTURE §4.21e-bis):**
   *  - `ttlMs` por defecto = `GUEST_TRACKING_TTL_DAYS` (90 días) ⇒ token de SEGUIMIENTO, el que
   *    viaja por correo (settle, reenvío, soporte).
   *  - `POST /checkout/guest/session` lo emite con `GUEST_CHECKOUT_TOKEN_TTL_MS` (120 min) ⇒ token
   *    de CHECKOUT, el único que la API devuelve en claro. Lo único que los distingue es
   *    `expiresAt`.
   *
   * `rotate` (default `true`): revoca los tokens vigentes del pedido ⇒ solo el último enlace vale.
   * **Excepción acotada `rotate:false`:** el correo de confirmación del settle, para no matar el
   * token de checkout que el navegador está usando en la confirmación post-3DS (§4-G.7a). Es
   * seguro porque ese token se apaga solo en 2 h. **Reenvío y soporte SÍ rotan.**
   */
  async issue(
    orderId: string,
    opts: { rotate?: boolean; requestIp?: string | null; now?: Date; ttlMs?: number } = {},
  ): Promise<{ clear: string; expiresAt: Date }> {
    const now = opts.now ?? new Date();
    const rotate = opts.rotate ?? true;
    const clear = randomBytes(32).toString('base64url');
    const tokenHash = hashOrderAccessToken(clear);
    const expiresAt = new Date(now.getTime() + (opts.ttlMs ?? GUEST_TRACKING_TTL_DAYS * DAY_MS));

    if (rotate) await this.revokeAll(orderId, now);
    await this.prisma.orderAccessToken.create({
      data: { orderId, tokenHash, expiresAt, requestIp: opts.requestIp ?? null },
    });
    return { clear, expiresAt };
  }

  /** Revoca TODOS los tokens vigentes del pedido (reclamo, rotación, soporte). Idempotente. */
  async revokeAll(orderId: string, now = new Date()): Promise<number> {
    const res = await this.prisma.orderAccessToken.updateMany({
      where: { orderId, revokedAt: null },
      data: { revokedAt: now },
    });
    return res.count;
  }

  /**
   * Valida un token presentado. Orden de comprobación: existencia → revocación → expiración.
   * NUNCA lanza: devuelve un discriminante para que el llamador emita la respuesta neutra.
   */
  async validate(clear: string, now = new Date()): Promise<TokenValidation> {
    const tokenHash = hashOrderAccessToken(clear);
    const token = await this.prisma.orderAccessToken.findUnique({ where: { tokenHash } });
    if (!token) return { ok: false, code: 'INVALID_TOKEN' };
    if (token.revokedAt != null) {
      return { ok: false, code: 'TOKEN_REVOKED', token, reason: await this.revocationReason(token) };
    }
    if (token.expiresAt.getTime() <= now.getTime()) {
      return { ok: false, code: 'TOKEN_EXPIRED', token };
    }
    return { ok: true, token };
  }

  /**
   * Deriva el motivo de la revocación (§4-G.3 pide `details.reason`). **Regla normativa v1.21.1,
   * literal:** `order.claimedAt != null` ⇒ `CLAIMED`; en cualquier otro caso ⇒ `ROTATED`.
   *
   * No se persiste ningún motivo: el esquema M-25 no lleva columna y el arquitecto decidió NO
   * añadir una para cambiar un texto de UX. Una rotación pedida por **soporte** se reporta como
   * `ROTATED` —que es justo lo que el usuario necesita saber ("tu enlace fue sustituido")—; la
   * distinción forense de QUIÉN rotó vive donde corresponde: el reenvío de soporte deja
   * `AuditLog` (`order.tracking_link.reissue`, con actor y timestamp) y el self-service no.
   */
  private async revocationReason(token: OrderAccessToken): Promise<RevocationReason> {
    const order = await this.prisma.order.findUnique({
      where: { id: token.orderId },
      select: { claimedAt: true },
    });
    return order?.claimedAt != null ? 'CLAIMED' : 'ROTATED';
  }

  /**
   * **SELECTOR de reenvío (§4-G.4, v1.21.1).** Devuelve el `orderId` del token presentado
   * buscando **solo por hash**, SIN filtrar por `expiresAt` ni por `revokedAt`.
   *
   * Es deliberado y es el caso NORMAL: a `POST /orders/guest/resend-link` se llega justamente
   * desde la pantalla de "enlace expirado" (o con un `checkoutToken` de 120 min ya vencido). Si
   * este lookup filtrara por validez, el reenvío no funcionaría precisamente cuando se necesita.
   * Un token caduco/revocado sirve para **identificar** el pedido, nunca para **leerlo**: la
   * lectura pasa por `validate()` (§4-G.3), que sí exige vigencia.
   */
  async orderIdForSelector(clear: string): Promise<string | null> {
    const tokenHash = hashOrderAccessToken(clear);
    const token = await this.prisma.orderAccessToken.findUnique({
      where: { tokenHash },
      select: { orderId: true },
    });
    return token?.orderId ?? null;
  }

  /** Telemetría de uso (best-effort: su fallo nunca rompe la lectura del pedido). */
  async markUsed(tokenId: string, now = new Date()): Promise<void> {
    await this.prisma.orderAccessToken
      .update({ where: { id: tokenId }, data: { lastUsedAt: now, useCount: { increment: 1 } } })
      .catch((e: unknown) => {
        this.logger.debug(`markUsed falló para ${tokenId}: ${(e as Error).message}`);
      });
  }

  /** ¿El pedido superó el tope de enlaces emitidos en 24h? (GUEST_RESEND_MAX_PER_DAY). */
  async resendQuotaExceeded(orderId: string, now = new Date()): Promise<boolean> {
    const issued = await this.prisma.orderAccessToken.count({
      where: { orderId, createdAt: { gte: new Date(now.getTime() - DAY_MS) } },
    });
    return issued >= GUEST_RESEND_MAX_PER_DAY;
  }
}
