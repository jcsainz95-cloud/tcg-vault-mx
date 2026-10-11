import { Logger } from '@nestjs/common';

/**
 * v1.80.9 (`API_CONTRACT §M6-U.8 (b)`, invariante **I-STF-1**): las referencias de **cliente** (órdenes, ventas,
 * bóveda, envíos, casos, reembolsos manuales, KYC) siguen siendo `email: string` en el contrato, porque apuntan
 * siempre a una cuenta CON correo — una cuenta sin correo no puede ser parte cliente (`EmailVerifiedGuard` ⇒
 * `403 ACCOUNT_WITHOUT_EMAIL`). Si aun así aparece `null`, la invariante está rota: se registra
 * `logger.error('I-STF-1 …')` y se emite `""` (⛔ nunca `null` en un campo `string`, nunca un 500).
 *
 * ⛔ No es para destinatarios de correo: un envío con `email == null` se OMITE con `logger.warn` (§M6-U.8 (a) E-4).
 */
const logger = new Logger('I-STF-1');

export function customerEmailOrBlank(email: string | null | undefined, where: string, userId?: string | null): string {
  if (typeof email === 'string') return email;
  logger.error(`I-STF-1 roto: referencia de cliente sin correo en ${where}${userId ? ` (user ${userId})` : ''}`);
  return '';
}
