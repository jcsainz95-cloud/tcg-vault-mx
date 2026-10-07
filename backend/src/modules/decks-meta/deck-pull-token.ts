/**
 * 💰🔒 §AC.8 «pullToken» — firma de la unión que «Agregar de jalón» mete HOY. PURO: la llave la pone quien llama
 * (`PiiCryptoService` cumple `DeckPullSigner`); ⛔ ningún secreto nuevo, ⛔ nada persistido.
 *
 *     token = base64url(JSON{ v:1, slug, listId, ids /* ordenados *\/, iat /* segundos *\/ })
 *             + "." + domainHmac('deck-pull:v1:', <parte 1>)
 *
 * - La firma se compara en tiempo constante (`constantTimeEquals` = `blindIndexEquals`).
 * - Vigencia: 30 días desde `iat` (= vida del carrito). `iat` más de 5 min en el futuro ⇒ inválido.
 * - Orden de comprobación: forma del texto → firma → forma de la carga → vigencia. Una firma mala NUNCA llega a
 *   parsear JSON ni a decir «vencido»: un atacante sin la llave solo ve `invalid_token`.
 * - ⛔ Nunca en URL; viaja solo en el cuerpo.
 */
export const DECK_PULL_DOMAIN = 'deck-pull:v1:';
export const DECK_PULL_TTL_SECONDS = 30 * 24 * 60 * 60;
export const DECK_PULL_TOKEN_MAX_LENGTH = 4096;
/** Tolerancia de reloj entre réplicas para un `iat` «del futuro». */
const IAT_FUTURE_SKEW_SECONDS = 300;

export interface DeckPullPayload {
  v: 1;
  slug: string;
  listId: string;
  ids: string[];
  iat: number;
}

/** Lo que el token necesita de `PiiCryptoService` (y nada más). */
export interface DeckPullSigner {
  domainHmac(domain: string, value: string): string;
  constantTimeEquals(a?: string | null, b?: string | null): boolean;
}

export type PullTokenVerdict =
  | { ok: true; payload: DeckPullPayload }
  /** `slug` solo cuando la firma es buena (vencido); con firma mala no se confía en nada de la carga. */
  | { ok: false; reason: 'invalid_token' | 'expired'; slug: string | null };

const B64URL = /^[A-Za-z0-9_-]+$/;
const INVALID: PullTokenVerdict = { ok: false, reason: 'invalid_token', slug: null };

export function signPullToken(
  signer: DeckPullSigner,
  p: { slug: string; listId: string; ids: readonly string[]; iat: number },
): string {
  const ids = [...new Set(p.ids)].sort();
  // Orden de llaves FIJO: el texto firmado es determinista.
  const json = JSON.stringify({ v: 1, slug: p.slug, listId: p.listId, ids, iat: p.iat });
  const part1 = Buffer.from(json, 'utf8').toString('base64url');
  return `${part1}.${signer.domainHmac(DECK_PULL_DOMAIN, part1)}`;
}

export function verifyPullToken(signer: DeckPullSigner, token: unknown, nowSec: number): PullTokenVerdict {
  if (typeof token !== 'string' || token.length === 0 || token.length > DECK_PULL_TOKEN_MAX_LENGTH) return INVALID;
  const parts = token.split('.');
  if (parts.length !== 2) return INVALID;
  const [part1, sig] = parts;
  if (!B64URL.test(part1) || !B64URL.test(sig)) return INVALID;

  const expected = signer.domainHmac(DECK_PULL_DOMAIN, part1);
  if (!signer.constantTimeEquals(sig, expected)) return INVALID;

  const payload = parsePayload(part1);
  if (!payload) return INVALID;
  if (payload.iat > nowSec + IAT_FUTURE_SKEW_SECONDS) return INVALID;
  if (nowSec - payload.iat > DECK_PULL_TTL_SECONDS) return { ok: false, reason: 'expired', slug: payload.slug };
  return { ok: true, payload };
}

/** Carga estricta: exactamente las 5 llaves, `ids` cadenas ordenadas sin repetir. Cualquier otra cosa ⇒ `null`. */
function parsePayload(part1: string): DeckPullPayload | null {
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(part1, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  if (keys.join(',') !== 'iat,ids,listId,slug,v') return null;
  if (o.v !== 1) return null;
  if (typeof o.slug !== 'string' || o.slug.length === 0) return null;
  if (typeof o.listId !== 'string' || o.listId.length === 0) return null;
  if (typeof o.iat !== 'number' || !Number.isSafeInteger(o.iat) || o.iat < 0) return null;
  if (!Array.isArray(o.ids)) return null;
  const ids = o.ids as unknown[];
  for (let i = 0; i < ids.length; i++) {
    if (typeof ids[i] !== 'string') return null;
    if (i > 0 && !((ids[i - 1] as string) < (ids[i] as string))) return null; // estrictamente ascendente
  }
  return { v: 1, slug: o.slug, listId: o.listId, ids: ids as string[], iat: o.iat };
}
