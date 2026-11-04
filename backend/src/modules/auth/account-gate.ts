import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 🔒 v1.117.2⟨cuenta-correo⟩ (API_CONTRACT §CTA.13, ARCHITECTURE §16.1 D-CTA-11; PT-CTA-1 y PT-CTA-4) — el CANDADO DE LA CUENTA.
 *
 * Una transacción cuya 1.ª sentencia es `pg_advisory_xact_lock(ACCOUNT_AUTH_GATE_NAMESPACE, hashtext(userId))`. Pasan por él,
 * enteros, la emisión y el canje de todo `AuthToken` y toda escritura de `email`, `passwordHash`, `emailVerified` o
 * `tokenVersion` de: la emisión tras `register` y `email-only`, `PATCH /users/me/email`, `verify-email/resend`, `verify-email`,
 * `forgot-password`, `reset-password`, `account-setup`, `set-password`, `change-password`, el enlace de `POST /auth/google` y el
 * reset del admin (§M6). Los topes por cuenta (3/h) se cuentan DENTRO.
 *
 * ⛔ Ningún correo ni llamada HTTP dentro: la transacción devuelve `{ to, clear }` y el envío va tras el commit A ESE `to`, sin
 * releer (releer era la carrera de PT-CTA-1). ⛔ Orden de candados: cuenta → libreta (`lockAddressBook` en la MISMA tx), nunca al
 * revés. Un candado de libreta tomado antes que éste en otra tx invertiría el orden y podría interbloquear.
 *
 * Namespace propio: que no se repita con ningún otro `*_NAMESPACE` lo cobra `test/lock-keys.census.spec.ts` (TL-CTA-15), no esta
 * prosa.
 */
export const ACCOUNT_AUTH_GATE_NAMESPACE = 97_120_117;

/**
 * Plazos de la transacción del candado. Bajo contención (K peticiones de la MISMA cuenta a la vez, CTA-B16 con K=20) cada una
 * espera su turno con la conexión tomada: el `timeout` por defecto de Prisma (5 s) y su `maxWait` (2 s) convertirían una cola
 * legítima en un 5xx. Cada turno dura milisegundos (argon2 se calcula FUERA salvo el `verify` de `verify-email`).
 */
export const ACCOUNT_GATE_TX_OPTIONS = { maxWait: 15_000, timeout: 20_000 } as const;

export function withAccountGate<T>(
  prisma: Pick<PrismaService, '$transaction'>,
  userId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ACCOUNT_AUTH_GATE_NAMESPACE}::int, hashtext(${userId}))`;
    return fn(tx);
  }, ACCOUNT_GATE_TX_OPTIONS);
}

/**
 * La ATADURA (§CTA.13): `AuthToken.emailHash = sha256hex(User.email)`, el correo tal como está guardado (ya normalizado), en
 * UTF-8. Bit a bit igual que el relleno de M-97 (`encode(sha256(convert_to(email, 'UTF8')), 'hex')`; CTA-B14m lo compara).
 */
export function emailHash(email: string): string {
  return createHash('sha256').update(email, 'utf8').digest('hex');
}
