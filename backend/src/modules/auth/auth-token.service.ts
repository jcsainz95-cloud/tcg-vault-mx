import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { AuthTokenType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** SHA-256 (hex) del token en claro. Basta SHA-256 (no argon2): 32 bytes aleatorios ≈ 256 bits
 * de entropía → no hay riesgo de fuerza bruta (a diferencia de una contraseña). ARCHITECTURE §3.2. */
export function hashAuthToken(clear: string): string {
  return createHash('sha256').update(clear).digest('hex');
}

/** TTL por tipo (ARCHITECTURE §3.2/§4.11): verificación 24h, reset 1h. */
export const AUTH_TOKEN_TTL_MS: Record<AuthTokenType, number> = {
  email_verification: 24 * 60 * 60 * 1000,
  password_reset: 60 * 60 * 1000,
};

/**
 * AuthTokenService — emisión/consumo de tokens de UN SOLO USO (verificación de correo / reset).
 * NUNCA persiste el token en claro: guarda su SHA-256. Al emitir uno nuevo del mismo tipo para
 * el usuario, invalida (rota) los previos no usados → solo el último link vale. ARCHITECTURE §4.11.
 */
@Injectable()
export class AuthTokenService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Emite un token: 32 bytes aleatorios (base64url) en claro (para el correo), guarda SOLO el
   * SHA-256. Rota los tokens vigentes previos del mismo tipo. Devuelve el token EN CLARO.
   */
  async issue(userId: string, type: AuthTokenType, requestIp?: string | null): Promise<string> {
    const clear = randomBytes(32).toString('base64url');
    const tokenHash = hashAuthToken(clear);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + AUTH_TOKEN_TTL_MS[type]);

    // Rotación: invalida los previos no usados de ese tipo (marca usedAt).
    await this.prisma.authToken.updateMany({
      where: { userId, type, usedAt: null },
      data: { usedAt: now },
    });
    await this.prisma.authToken.create({
      data: { userId, type, tokenHash, expiresAt, requestIp: requestIp ?? null },
    });
    return clear;
  }

  /**
   * Consume un token atómicamente: válido sii existe, es del `type`, no usado y no expirado.
   * Marca `usedAt` (un solo uso) en el mismo `updateMany` (cierra la carrera de doble consumo)
   * y devuelve el `userId`; si es inválido/expirado/usado devuelve `null`.
   */
  async consume(clear: string, type: AuthTokenType, now = new Date()): Promise<string | null> {
    const tokenHash = hashAuthToken(clear);
    const res = await this.prisma.authToken.updateMany({
      where: { tokenHash, type, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (res.count === 0) return null;
    const token = await this.prisma.authToken.findUnique({
      where: { tokenHash },
      select: { userId: true },
    });
    return token?.userId ?? null;
  }

  /** userId del token (sin consumirlo). Para la idempotencia de verify-email (doble clic). */
  async ownerOf(clear: string): Promise<string | null> {
    const tokenHash = hashAuthToken(clear);
    const token = await this.prisma.authToken.findUnique({
      where: { tokenHash },
      select: { userId: true },
    });
    return token?.userId ?? null;
  }

  /** Nº de tokens de ese tipo emitidos por el usuario en la última hora (tope anti-abuso). */
  async countIssuedLastHour(userId: string, type: AuthTokenType, now = new Date()): Promise<number> {
    return this.prisma.authToken.count({
      where: { userId, type, createdAt: { gte: new Date(now.getTime() - 60 * 60 * 1000) } },
    });
  }
}
