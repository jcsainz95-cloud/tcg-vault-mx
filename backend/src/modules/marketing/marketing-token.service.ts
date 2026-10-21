/**
 * marketing-token.service.ts — 🔒 principal de servicio `marketing-reader` (Brief 2 §7.2, PM-M1/PV-B3;
 * ARCHITECTURE §13.4.2; API_CONTRACT §MKT.D/E). LEE/valida tokens; NO mueve dinero.
 *
 * - Emitir / listar / revocar: `marketing-token-admin.service.ts` (§MKT.G.6). Este servicio es SOLO la puerta.
 * - `verify(bearer, ip, now)` valida: 401 si falta/ inválido/ revocado/ caducado; 429 si la IP está
 *   bloqueada (10 fallos/10min) o el token pasó 60/h. Comparación en tiempo constante. Actualiza
 *   `lastUsedAt` best-effort. ⛔ El bearer NUNCA se escribe en logs (el servicio no loguea el valor).
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { constantTimeHexEqual, hashToken } from './token-crypto';
import { SlidingWindowCounter } from './rate-limiter';

/** Token validado que el guard adjunta a la petición. ⛔ NUNCA incluye el claro ni el hash. */
export interface VerifiedMarketingToken {
  id: string;
  label: string;
}


@Injectable()
export class MarketingTokenService {
  // 60 peticiones/hora POR TOKEN.
  private readonly perToken = new SlidingWindowCounter(60 * 60 * 1000, 60);
  // 10 FALLOS de token por IP en 10 min ⇒ bloqueo mientras dure la ventana.
  private readonly perIpFails = new SlidingWindowCounter(10 * 60 * 1000, 10);

  constructor(private readonly prisma: PrismaService) {}

  private fail(ip: string, nowMs: number, message: string): never {
    this.perIpFails.record(ip, nowMs);
    throw new BusinessException('UNAUTHENTICATED', 401, message);
  }

  /**
   * Valida el bearer. Lanza 401 (falta/ inválido/ revocado/ caducado) o 429 (IP bloqueada / 60/h).
   * ⚠️ Orden: primero el bloqueo de IP (frena fuerza bruta antes de tocar BD).
   */
  async verify(bearer: string | undefined, ip: string, now = new Date()): Promise<VerifiedMarketingToken> {
    const nowMs = now.getTime();

    // IP con ≥10 fallos en 10 min ⇒ bloqueada (429), sin consultar BD.
    if (this.perIpFails.atLimit(ip, nowMs)) {
      throw new BusinessException('RATE_LIMITED', 429, 'Too many failed attempts from this IP; try later');
    }

    if (!bearer || bearer.trim() === '') this.fail(ip, nowMs, 'Missing bearer token');

    const presentedHash = hashToken(bearer!);
    const row = await this.prisma.marketingApiToken.findUnique({
      where: { tokenHash: presentedHash },
      select: { id: true, label: true, tokenHash: true, expiresAt: true, revokedAt: true },
    });
    // Comparación en tiempo constante aunque el findUnique ya acote (defensa en profundidad).
    if (!row || !constantTimeHexEqual(presentedHash, row.tokenHash)) this.fail(ip, nowMs, 'Invalid token');
    if (row!.revokedAt !== null) this.fail(ip, nowMs, 'Token revoked');
    if (row!.expiresAt.getTime() <= nowMs) this.fail(ip, nowMs, 'Token expired');

    // Token válido: límite de 60/h por token (NO cuenta como fallo de IP).
    if (this.perToken.recordAndExceeded(row!.id, nowMs)) {
      throw new BusinessException('RATE_LIMITED', 429, 'Rate limit exceeded (60/hour) for this token');
    }

    // best-effort: marcar último uso (no bloquea la respuesta si falla).
    this.prisma.marketingApiToken
      .update({ where: { id: row!.id }, data: { lastUsedAt: now } })
      .catch(() => undefined);

    return { id: row!.id, label: row!.label };
  }
}
