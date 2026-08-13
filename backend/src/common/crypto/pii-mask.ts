/**
 * pii-mask.ts — Helpers PUROS de enmascarado de PII (sin claves ni cifrado).
 *
 * Se usan en TODAS las vistas/DTOs salvo el endpoint dedicado de reveal (pago SPEI):
 * ficha 360°, listados, portafolio, respuestas de buylist, KYC propio del usuario.
 * Nunca exponen la CLABE ni el RFC en claro.
 */

/** CLABE enmascarada dejando solo los últimos 4 dígitos (ej. `**************4567`). */
export function maskClabe(clabe?: string | null): string | undefined {
  if (!clabe) return undefined;
  const last4 = clabe.slice(-4);
  return `${'*'.repeat(Math.max(0, clabe.length - 4))}${last4}`;
}

/**
 * RFC enmascarado dejando visibles solo los primeros 3 caracteres (iniciales del
 * nombre/razón social) y ocultando el resto (fecha + homoclave). Ej. `XAX**********`.
 */
export function maskRfc(rfc?: string | null): string | undefined {
  if (!rfc) return undefined;
  const head = rfc.slice(0, 3);
  return `${head}${'*'.repeat(Math.max(0, rfc.length - 3))}`;
}
