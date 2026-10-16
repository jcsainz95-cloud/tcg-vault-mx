/**
 * token-crypto.ts — 🔒 hashing y comparación en tiempo constante del token `marketing-reader`
 * (Brief 2 §7.2, PM-M1/PV-B3; ARCHITECTURE §13.4.2). PURO.
 *
 * - El token claro es aleatorio de **≥256 bits**; la tienda guarda **solo** su SHA-256 (hex).
 * - La comparación se hace sobre los digest de **longitud fija** con `crypto.timingSafeEqual`
 *   (evita fuga de tiempo por comparación de cadenas corta-circuitada).
 */
import { createHash, randomBytes, timingSafeEqual } from 'crypto';

/** Longitud del token claro en bytes (256 bits). */
export const MARKETING_TOKEN_BYTES = 32;

/** Genera un token claro aleatorio ≥256 bits (hex, 64 chars). Se entrega UNA vez; nunca se guarda. */
export function generateClearToken(): string {
  return randomBytes(MARKETING_TOKEN_BYTES).toString('hex');
}

/** SHA-256 (hex, 64 chars) del token claro. Lo ÚNICO que se persiste. */
export function hashToken(clear: string): string {
  return createHash('sha256').update(clear, 'utf8').digest('hex');
}

/**
 * Compara dos digest hex en tiempo constante. Falso si longitudes distintas (sin lanzar). Protege
 * la verificación aunque el `findUnique` por hash ya acote (defensa en profundidad).
 */
export function constantTimeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
