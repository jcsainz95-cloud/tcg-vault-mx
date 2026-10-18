/**
 * mailbox.util.ts — v1.93⟨cardshow⟩ (API_CONTRACT §CARDSHOW.8, ARCHITECTURE §4.CARDSHOW.e).
 *
 * DOS normalizaciones distintas y deliberadas:
 *  - `normalizeEmail`: minúsculas + trim. Es lo que se GUARDA y lo que da la UNICIDAD `(email, type)`.
 *    `Email@Dominio.MX` y `email@dominio.mx` ⇒ MISMA fila; `email+a@` ⇒ OTRA fila.
 *  - `canonicalizeMailbox`: además quita `+etiqueta` y, en dominios tipo Gmail, los puntos de la parte
 *    local. Es la clave del TOPE por buzón (C2): `victima+1@`, `victima+2@`, `v.ictima@gmail` y
 *    `victima@gmail` comparten buzón ⇒ comparten tope de envíos. (Al revés que §4.57, que es por CUENTA
 *    y ⛔ no canonicaliza: aquí el objetivo es cerrar la evasión del tope.)
 *
 * El `mailboxHmac` se deriva con `PiiCryptoService.blindIndex('card-show-mbox:v1:' + canonicalizeMailbox)`
 * (prefijo de propósito propio, disjunto del de §4.57). Vive en `CardShowMailboxService`.
 */

/** Dominios que tratan la parte local ignorando puntos y tras el `+etiqueta` (familia Gmail). */
const GMAIL_LIKE_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

/** Minúsculas + trim. Lo que se persiste y lo que da la unicidad. ⛔ No quita `+etiqueta` ni puntos. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Parte local y dominio de un correo ya normalizado. `null` si no hay exactamente una `@`. */
function splitEmail(normalized: string): { local: string; domain: string } | null {
  const at = normalized.lastIndexOf('@');
  if (at <= 0 || at === normalized.length - 1) return null;
  const local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  if (local.includes('@')) return null;
  return { local, domain };
}

/**
 * Canonicaliza el BUZÓN para el tope (C2): minúsculas + trim, quita `+etiqueta`, y en dominios tipo
 * Gmail quita los puntos de la parte local. Si el correo no parsea, devuelve el normalizado tal cual
 * (una entrada malformada no debería llegar aquí — la validación la rechaza antes).
 */
export function canonicalizeMailbox(email: string): string {
  const normalized = normalizeEmail(email);
  const parts = splitEmail(normalized);
  if (!parts) return normalized;
  let { local } = parts;
  const { domain } = parts;
  // `+etiqueta` ⇒ fuera (en TODOS los dominios: el `+` es la vía universal de sub-direccionamiento).
  const plus = local.indexOf('+');
  if (plus >= 0) local = local.slice(0, plus);
  // Puntos ⇒ fuera SOLO en la familia Gmail.
  if (GMAIL_LIKE_DOMAINS.has(domain)) local = local.replace(/\./g, '');
  return `${local}@${domain}`;
}

/** El dominio (en minúsculas) de un correo, para el tope por dominio (§CARDSHOW.11). `''` si no parsea. */
export function emailDomain(email: string): string {
  const parts = splitEmail(normalizeEmail(email));
  return parts ? parts.domain : '';
}
