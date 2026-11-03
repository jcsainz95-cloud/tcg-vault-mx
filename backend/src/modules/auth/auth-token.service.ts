import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { AuthTokenType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ACCOUNT_SETUP_TTL_HOURS } from './account-setup';
import { emailHash } from './account-gate';

/** SHA-256 (hex) del token en claro. Basta SHA-256 (no argon2): 32 bytes aleatorios ≈ 256 bits
 * de entropía → no hay riesgo de fuerza bruta (a diferencia de una contraseña). ARCHITECTURE §3.2. */
export function hashAuthToken(clear: string): string {
  return createHash('sha256').update(clear).digest('hex');
}

/** TTL por tipo (ARCHITECTURE §3.2/§4.11): verificación 24h, reset 1h; v1.117 (§CTA.3) «Termina tu cuenta» 24 h. */
export const AUTH_TOKEN_TTL_MS: Record<AuthTokenType, number> = {
  email_verification: 24 * 60 * 60 * 1000,
  password_reset: 60 * 60 * 1000,
  account_setup: ACCOUNT_SETUP_TTL_HOURS * 60 * 60 * 1000,
};

/**
 * AuthTokenService — emisión/consumo de tokens de UN SOLO USO (verificación de correo / reset / «Termina tu cuenta»).
 * NUNCA persiste el token en claro: guarda su SHA-256. ARCHITECTURE §4.11.
 *
 * 🔒 v1.117.2 (API_CONTRACT §CTA.13, D-CTA-11): `issue` y `consume` EXIGEN `tx` — la transacción de `withAccountGate`
 * (`account-gate.ts`) —, así no hay emisión ni canje fuera del candado de la cuenta. Cada token queda ATADO al correo al que se
 * mandó (`emailHash`), y hay a lo sumo UNO vivo por cuenta y tipo: rotación (`updateMany` + `create`) en la tx del candado, más
 * el índice único parcial `AuthToken_one_live_per_user_type` de M-97 (un `P2002` de ese índice es defecto, no flujo).
 */
@Injectable()
export class AuthTokenService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Emite un token para `user` (dentro del candado): 32 bytes aleatorios (base64url) en claro (para el correo), guarda SOLO el
   * SHA-256 y el `emailHash` de `user.email` — el correo LEÍDO DENTRO del candado, al que el llamador manda el enlace tras el
   * commit. Rota (anula) los vivos previos del mismo tipo. Devuelve el token EN CLARO.
   */
  async issue(
    tx: Prisma.TransactionClient,
    user: { id: string; email: string },
    type: AuthTokenType,
    requestIp?: string | null,
  ): Promise<string> {
    const clear = randomBytes(32).toString('base64url');
    const tokenHash = hashAuthToken(clear);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + AUTH_TOKEN_TTL_MS[type]);
    await tx.authToken.updateMany({
      where: { userId: user.id, type, usedAt: null },
      data: { usedAt: now },
    });
    await tx.authToken.create({
      data: { userId: user.id, type, tokenHash, expiresAt, requestIp: requestIp ?? null, emailHash: emailHash(user.email) },
    });
    return clear;
  }

  /**
   * Consume un token (dentro del candado): válido sii existe, es del `type`, no usado, no expirado y su `emailHash` casa con
   * `currentEmail` — el `User.email` LEÍDO DENTRO del candado. Marca `usedAt` en el mismo `updateMany` (un solo uso) y
   * devuelve el `userId`; si no, `null` sin escribir (inválido, caducado, usado, de otro tipo o atado a otro correo: no se
   * distingue). Un correo cambiado por cualquier vía (corrección, panel, consulta a mano) mata los enlaces al anterior.
   */
  async consume(
    tx: Prisma.TransactionClient,
    clear: string,
    type: AuthTokenType,
    currentEmail: string | null,
    now = new Date(),
  ): Promise<string | null> {
    if (currentEmail === null) return null;
    const tokenHash = hashAuthToken(clear);
    const res = await tx.authToken.updateMany({
      where: { tokenHash, type, usedAt: null, expiresAt: { gt: now }, emailHash: emailHash(currentEmail) },
      data: { usedAt: now },
    });
    if (res.count === 0) return null;
    const token = await tx.authToken.findUnique({ where: { tokenHash }, select: { userId: true } });
    return token?.userId ?? null;
  }

  /**
   * `userId` del token (sin consumirlo ni validarlo), para saber QUÉ cuenta bloquear antes del canje. Fuera del candado a
   * propósito: no decide nada (el canje, dentro, vuelve a mirarlo todo).
   */
  async ownerOf(clear: string): Promise<string | null> {
    const token = await this.prisma.authToken.findUnique({
      where: { tokenHash: hashAuthToken(clear) },
      select: { userId: true },
    });
    return token?.userId ?? null;
  }

  /**
   * ¿Canjearía `consume` este claro ahora? Mismas condiciones, SIN escribir. Para `verify-email` en modo `password`: el token
   * se comprueba antes de la contraseña (inválido ⇒ 422, no 401) y solo se consume si la contraseña es buena. Dentro del candado,
   * así nada cambia entre esta lectura y el `consume`.
   */
  async isLive(
    tx: Prisma.TransactionClient,
    clear: string,
    type: AuthTokenType,
    currentEmail: string | null,
    now = new Date(),
  ): Promise<boolean> {
    if (currentEmail === null) return false;
    const n = await tx.authToken.count({
      where: { tokenHash: hashAuthToken(clear), type, usedAt: null, expiresAt: { gt: now }, emailHash: emailHash(currentEmail) },
    });
    return n > 0;
  }

  /**
   * ¿Este claro es de un token YA USADO y atado a `currentEmail`? (idempotencia del doble clic de `verify-email` en modo
   * `password`, v1.117.3). La atadura cuenta también aquí: con el correo cambiado, el enlace viejo es `422`, no `200`.
   */
  async isUsed(tx: Prisma.TransactionClient, clear: string, type: AuthTokenType, currentEmail: string | null): Promise<boolean> {
    if (currentEmail === null) return false;
    const t = await tx.authToken.findUnique({
      where: { tokenHash: hashAuthToken(clear) },
      select: { type: true, usedAt: true, emailHash: true },
    });
    return t !== null && t.type === type && t.usedAt !== null && t.emailHash === emailHash(currentEmail);
  }

  /**
   * v1.117 (§CTA.4 paso 5, §CTA.5): ANULA (`usedAt = now`) los tokens pendientes de la cuenta de esos tipos — el enlace
   * deja de valer sin borrarse (el barrido `auth-token-sweep` lo recoge). En la transacción del llamador (el candado).
   */
  async voidPending(
    tx: Pick<Prisma.TransactionClient, 'authToken'>,
    userId: string,
    types: readonly AuthTokenType[],
    now = new Date(),
  ): Promise<number> {
    const res = await tx.authToken.updateMany({
      where: { userId, type: { in: [...types] }, usedAt: null },
      data: { usedAt: now },
    });
    return res.count;
  }

  /** Nº de tokens de ese tipo emitidos a la cuenta en la última hora (tope anti-abuso), DENTRO del candado. */
  async countIssuedLastHour(
    tx: Pick<Prisma.TransactionClient, 'authToken'>,
    userId: string,
    type: AuthTokenType,
    now = new Date(),
  ): Promise<number> {
    return tx.authToken.count({
      where: { userId, type, createdAt: { gte: new Date(now.getTime() - 60 * 60 * 1000) } },
    });
  }
}
