/**
 * v1.80 (C7, contrato §0 «429 TOO_MANY_PASSWORD_ATTEMPTS» y §1 «Límite de intentos por cuenta").
 *
 * Minutos que se pintan en el copy del candado: `max(1, ceil(retryAfterSeconds / 60))` — fórmula
 * normativa del contrato (150 s ⇒ «3 min», 1 s ⇒ «1 min»). Devuelve `null` si el backend no mandó
 * un número usable: entonces se pinta el copy sin cifra, **nunca** un número inventado.
 *
 * ⛔ Este módulo no programa ningún reintento: el contrato prohíbe que el front reintente solo.
 */
export const TOO_MANY_PASSWORD_ATTEMPTS = 'TOO_MANY_PASSWORD_ATTEMPTS';

export function retryAfterMinutes(details: Record<string, unknown> | undefined | null): number | null {
  const s = details?.retryAfterSeconds;
  if (typeof s !== 'number' || !Number.isFinite(s) || s < 0) return null;
  return Math.max(1, Math.ceil(s / 60));
}
