/**
 * Espejo en el frontend de `backend/src/common/first-utm.ts` (`parseFirstUtm`, §MKT.C / PV-M2), y el
 * saneador de URL de ARCHITECTURE §14.4 (§D2.2): **una sola función** reescribe `page_location`,
 * `page_referrer` y la URL que ve el píxel.
 *
 * Regla (`parseFirstUtm`): solo `utm_source|utm_medium|utm_campaign|utm_content`; cada valor en minúsculas
 * y solo si cumple `^[a-z0-9._-]{1,64}$`. La query que sale hacia Google/Meta la decide
 * `MEASUREMENT_QUERY_ALLOWLIST` (D-MKT2-11): GA4 esos cuatro; el píxel, además `fbclid`. Lo demás se
 * borra (`q`, `token`, `session_id`, `email`, `code`, el fragmento `#…`). Candado C-F4 (`utm.test.ts`).
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

export type MeasurementDest = 'ga4' | 'pixel';

/** Valor de un `utm_*`: el que deje `parseFirstUtm` (minúsculas, `UTM_VALUE_RE`), o nada. */
function utmValue(key: string): (v: string) => string | null {
  return (v) => {
    const parsed = parseFirstUtm({ [key]: v });
    const outKey = UTM_KEY_MAP.find(([, q]) => q === key)?.[0];
    return (outKey && parsed[outKey]) || null;
  };
}

/** `fbclid` tal cual llega (Meta arma `_fbc` con él; el aviso lo declara). */
export const FBCLID_RE = /^[A-Za-z0-9_-]{1,255}$/;
const fbclidValue = (v: string): string | null => (FBCLID_RE.test(v) ? v : null);

const UTM_ALLOWED = {
  utm_source: utmValue('utm_source'),
  utm_medium: utmValue('utm_medium'),
  utm_campaign: utmValue('utm_campaign'),
  utm_content: utmValue('utm_content'),
} as const;

/**
 * ARCHITECTURE §14.4 D-MKT2-11 (v1.112.2, SEC-MED-1) — FUENTE ÚNICA de la query que puede salir hacia
 * Google o Meta, por destino: clave admitida ⇒ su validador (devuelve el valor que sale, o `null`).
 * El orden es el de salida. ⛔ Fuera siempre: `q`, `utm_term`, `utm_id`, `gclid`, `_gl`, todo lo demás
 * (`token`, `session_id`, `email`, `code`…) y el `#…`. Una clave nueva es cambio de contrato (regla 9).
 */
export const MEASUREMENT_QUERY_ALLOWLIST: Readonly<Record<MeasurementDest, Readonly<Record<string, (v: string) => string | null>>>> = {
  ga4: UTM_ALLOWED,
  pixel: { ...UTM_ALLOWED, fbclid: fbclidValue },
};

function parseHttpUrl(raw: string | null | undefined): URL | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
}

/**
 * C-F4 — origen + ruta + solo las claves de `MEASUREMENT_QUERY_ALLOWLIST[dest]` con valor válido (una
 * clave repetida se descarta). Una URL que no es http(s) absoluta ⇒ `''` (no se manda nada que no se
 * pueda sanear). Ejemplos del contrato:
 * `?token=x&session_id=cs_live_1&payment_intent_client_secret=y&utm_source=ig#a` ⇒ `?utm_source=ig`;
 * `?q=pikachu&utm_term=x&gclid=y&fbclid=AbC&utm_source=ig` ⇒ `ga4` `?utm_source=ig`, `pixel` `?utm_source=ig&fbclid=AbC`.
 */
export function sanitizeMeasurementUrl(raw: string | null | undefined, dest: MeasurementDest): string {
  const url = parseHttpUrl(raw);
  if (!url) return '';
  const allowed = MEASUREMENT_QUERY_ALLOWLIST[dest];
  const kept = new URLSearchParams();
  for (const [key, validate] of Object.entries(allowed)) {
    const all = url.searchParams.getAll(key);
    if (all.length !== 1) continue;
    const v = validate(all[0]!);
    if (v) kept.set(key, v);
  }
  const qs = kept.toString();
  return `${url.origin}${url.pathname}${qs ? `?${qs}` : ''}`;
}

/**
 * ¿Puede el píxel de Meta ver ESTA URL tal cual? (la librería del píxel lee `location.href` por su cuenta y no
 * deja reescribirla.) Verdadero solo si es http(s), sin `#`, y toda clave de su query está en la lista
 * del píxel, sin repetir y con valor válido.
 */
export function isPixelSafeUrl(href: string | null | undefined): boolean {
  if (!href || href.includes('#')) return false;
  const url = parseHttpUrl(href);
  if (!url) return false;
  const allowed = MEASUREMENT_QUERY_ALLOWLIST.pixel;
  const keys = [...url.searchParams.keys()];
  if (new Set(keys).size !== keys.length) return false;
  for (const key of keys) {
    const validate = Object.prototype.hasOwnProperty.call(allowed, key) ? allowed[key] : undefined;
    if (!validate || !validate(url.searchParams.get(key) ?? '')) return false;
  }
  return true;
}

/**
 * El documento entero que ve el píxel: su URL pasa `isPixelSafeUrl` y su referente (`document.referrer`,
 * que la librería del píxel también lee), si es de NUESTRO origen, también. Un referente de otro origen no cuenta.
 */
export function isPixelSafeDocument(href: string | null | undefined, referrer: string | null | undefined): boolean {
  if (!isPixelSafeUrl(href)) return false;
  if (!referrer) return true;
  const here = parseHttpUrl(href);
  const ref = parseHttpUrl(referrer);
  if (!ref) return true;
  if (here && ref.origin !== here.origin) return true;
  return isPixelSafeUrl(referrer);
}

/** Solo la ruta (sin query ni fragmento) — `page_path` de `select_content`/`click_contact`. */
export function sanitizePath(raw: string | null | undefined): string {
  if (!raw) return '';
  const path = raw.split(/[?#]/)[0] ?? '';
  return path.startsWith('/') ? path : '';
}
