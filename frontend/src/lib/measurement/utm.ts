/**
 * Espejo en el frontend de `backend/src/common/first-utm.ts` (`parseFirstUtm`, §MKT.C / PV-M2), y el
 * saneador de URL de ARCHITECTURE §14.4 (§D2.2): **una sola función** reescribe `page_location`,
 * `page_referrer` y la URL que ve el píxel.
 *
 * Regla: solo `utm_source|utm_medium|utm_campaign|utm_content`; cada valor en minúsculas y solo si
 * cumple `^[a-z0-9._-]{1,64}$`. Lo demás se borra (`token`, `session_id`,
 * `payment_intent_client_secret`, `email`, `code`, el fragmento `#…`). Candado C-F4 (`utm.test.ts`).
 */

export interface FirstUtmValues {
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
}

export const UTM_VALUE_RE = /^[a-z0-9._-]{1,64}$/;

export const UTM_KEY_MAP: ReadonlyArray<readonly [keyof FirstUtmValues, string]> = [
  ['source', 'utm_source'],
  ['medium', 'utm_medium'],
  ['campaign', 'utm_campaign'],
  ['content', 'utm_content'],
];

/** Mismo contrato que el del backend: entra un objeto de params, salen solo los cuatro válidos. */
export function parseFirstUtm(params: Record<string, unknown> | null | undefined): FirstUtmValues {
  const out: FirstUtmValues = {};
  if (params == null || typeof params !== 'object') return out;
  for (const [outKey, queryKey] of UTM_KEY_MAP) {
    const raw = (params as Record<string, unknown>)[queryKey];
    if (typeof raw !== 'string') continue;
    const normalized = raw.toLowerCase();
    if (!UTM_VALUE_RE.test(normalized)) continue;
    out[outKey] = normalized;
  }
  return out;
}

/** `URLSearchParams` ⇒ objeto de params. Una clave repetida cuenta como array (⇒ se descarta). */
export function searchParamsToRecord(search: URLSearchParams): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of new Set(search.keys())) {
    const all = search.getAll(key);
    out[key] = all.length === 1 ? all[0] : all;
  }
  return out;
}

export function utmFromSearch(search: string): FirstUtmValues {
  return parseFirstUtm(searchParamsToRecord(new URLSearchParams(search)));
}

export function hasAnyUtm(v: FirstUtmValues): boolean {
  return Boolean(v.source || v.medium || v.campaign || v.content);
}

/**
 * C-F4 — origen + ruta + solo los `utm_*` válidos. Una URL que no es http(s) absoluta ⇒ `''` (no se
 * manda nada que no se pueda sanear). Ejemplo del contrato:
 * `?token=x&session_id=cs_live_1&payment_intent_client_secret=y&utm_source=ig#a` ⇒ `?utm_source=ig`.
 */
export function sanitizeMeasurementUrl(raw: string | null | undefined): string {
  if (!raw) return '';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return '';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
  const utm = utmFromSearch(url.search);
  const kept = new URLSearchParams();
  for (const [outKey, queryKey] of UTM_KEY_MAP) {
    const v = utm[outKey];
    if (v) kept.set(queryKey, v);
  }
  const qs = kept.toString();
  return `${url.origin}${url.pathname}${qs ? `?${qs}` : ''}`;
}

/** Solo la ruta (sin query ni fragmento) — `page_path` de `select_content`/`click_contact`. */
export function sanitizePath(raw: string | null | undefined): string {
  if (!raw) return '';
  const path = raw.split(/[?#]/)[0] ?? '';
  return path.startsWith('/') ? path : '';
}
