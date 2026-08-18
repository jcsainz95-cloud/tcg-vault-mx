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

/** Motivo de revocación (§4-G.3). Derivado, no persistido: el esquema M-25 no lleva columna. */
export type RevocationReason = 'CLAIMED' | 'ROTATED' | 'SUPPORT';

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
   * SHA-256. Devuelve el CLARO (única copia; no se puede recuperar después).
   *
   * `rotate` (default `true`): revoca los tokens vigentes del pedido ⇒ solo el último enlace vale
   * (§4-G.7). Se emite con `rotate:false` en UN caso: el correo de confirmación al liquidar, para
   * no matar el token que `POST /checkout/guest/session` ya entregó al navegador del comprador
   * (ver nota de desviación en docs/BACKEND_NOTES.md).
   */
  async issue(
    orderId: string,
    opts: { rotate?: boolean; requestIp?: string | null; now?: Date } = {},
  ): Promise<{ clear: string; expiresAt: Date }> {
    const now = opts.now ?? new Date();
    const rotate = opts.rotate ?? true;
    const clear = randomBytes(32).toString('base64url');
    const tokenHash = hashOrderAccessToken(clear);
    const expiresAt = new Date(now.getTime() + GUEST_TRACKING_TTL_DAYS * DAY_MS);

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
   * Deriva el motivo de la revocación (§4-G.3 pide `details.reason`). El esquema M-25 NO lleva
   * columna de motivo (diff cerrado, "ni un campo más"), así que se INFIERE:
   *   pedido ya reclamado ⇒ `CLAIMED`; existe un token vigente que lo sustituye ⇒ `ROTATED`;
   *   en otro caso ⇒ `SUPPORT`.
   * Limitación conocida y REPORTADA: la rotación pedida por soporte (§4-G.9b) también deja un
   * token vigente, así que se lee como `ROTATED`. Distinguirla exigiría una columna nueva
   * (decisión del arquitecto). Ver docs/BACKEND_NOTES.md.
   */
  private async revocationReason(token: OrderAccessToken): Promise<RevocationReason> {
    const order = await this.prisma.order.findUnique({
      where: { id: token.orderId },
      select: { claimedAt: true },
    });
    if (order?.claimedAt != null) return 'CLAIMED';
    const liveSuccessors = await this.prisma.orderAccessToken.count({
      where: { orderId: token.orderId, revokedAt: null },
    });
    return liveSuccessors > 0 ? 'ROTATED' : 'SUPPORT';
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
