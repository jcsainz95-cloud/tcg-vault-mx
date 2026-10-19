/**
 * ARCHITECTURE §14.3 / API_CONTRACT §MKT.H.8 — la elección del visitante y las cookies propias.
 *
 * - `th_consent`: guarda la elección (necesaria). 180 días. Contenido: versión del formato, `a`
 *   (analítica), `m` (publicidad), versión del aviso y fecha. Si la versión del aviso cambia, se
 *   vuelve a preguntar (`readConsent` devuelve `null`).
 * - `th_first_utm`: primer origen, SOLO con analítica. 90 días, no se sobrescribe.
 * Todas `Secure`, `SameSite=Lax`, `Path=/` y dominio apex (en `tcghunt.mx`; en otro host, sin `Domain`).
 *
 * Funciones puras sobre una «jarra» de cookies inyectable (`CookieJar`) para poder probarlas sin
 * navegador; `documentCookieJar()` es la real.
 */

import { hasAnyUtm, type FirstUtmValues } from './utm';

export const CONSENT_COOKIE = 'th_consent';
export const FIRST_UTM_COOKIE = 'th_first_utm';
export const CONSENT_MAX_AGE_S = 180 * 24 * 60 * 60;
export const FIRST_UTM_MAX_AGE_S = 90 * 24 * 60 * 60;
const CONSENT_FORMAT = 1;
const APEX = 'tcghunt.mx';

export interface ConsentChoice {
  analytics: boolean;
  ads: boolean;
}

export interface StoredConsent extends ConsentChoice {
  noticeVersion: string;
  /** AAAA-MM-DD en que se guardó. */
  savedOn: string;
}

export interface CookieJar {
  /** Valor crudo de `document.cookie`. */
  read(): string;
  /** Escribe UNA cookie (`nombre=valor; atributos`). */
  write(cookie: string): void;
  /** Host actual (para decidir el dominio apex). */
  hostname: string;
}

export function documentCookieJar(): CookieJar {
  return {
    read: () => (typeof document === 'undefined' ? '' : document.cookie),
    write: (c) => {
      if (typeof document !== 'undefined') document.cookie = c;
    },
    hostname: typeof window === 'undefined' ? '' : window.location.hostname,
  };
}

export function parseCookies(raw: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const name = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (name && !out.has(name)) out.set(name, value);
  }
  return out;
}

function domainAttr(hostname: string): string {
  const h = hostname.toLowerCase();
  return h === APEX || h.endsWith(`.${APEX}`) ? `; Domain=${APEX}` : '';
}

function attrs(jar: CookieJar, maxAge: number): string {
  return `; Max-Age=${maxAge}; Path=/${domainAttr(jar.hostname)}; SameSite=Lax; Secure`;
}

const VERSION_RE = /^[A-Za-z0-9._-]{1,32}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function serializeConsent(c: StoredConsent): string {
  return encodeURIComponent(
    JSON.stringify({ v: CONSENT_FORMAT, a: c.analytics ? 1 : 0, m: c.ads ? 1 : 0, n: c.noticeVersion, d: c.savedOn }),
  );
}

export function deserializeConsent(raw: string | undefined): StoredConsent | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(decodeURIComponent(raw)) as Record<string, unknown>;
    if (o.v !== CONSENT_FORMAT) return null;
    if ((o.a !== 0 && o.a !== 1) || (o.m !== 0 && o.m !== 1)) return null;
    if (typeof o.n !== 'string' || !VERSION_RE.test(o.n)) return null;
    if (typeof o.d !== 'string' || !DATE_RE.test(o.d)) return null;
    return { analytics: o.a === 1, ads: o.m === 1, noticeVersion: o.n, savedOn: o.d };
  } catch {
    return null;
  }
}

/** La elección vigente, o `null` si no hay, está rota o es de OTRA versión del aviso (se re-pregunta). */
export function readConsent(jar: CookieJar, noticeVersion: string): StoredConsent | null {
  const stored = deserializeConsent(parseCookies(jar.read()).get(CONSENT_COOKIE));
  if (!stored || stored.noticeVersion !== noticeVersion) return null;
  return stored;
}

/**
 * Escribe `th_consent` y comprueba que quedó (un navegador puede bloquearla). `false` ⇒ la elección
 * vive solo en memoria de la pestaña (MKT2-UX.2 fila 4).
 */
export function writeConsent(jar: CookieJar, c: StoredConsent): boolean {
  jar.write(`${CONSENT_COOKIE}=${serializeConsent(c)}${attrs(jar, CONSENT_MAX_AGE_S)}`);
  const back = readConsent(jar, c.noticeVersion);
  return back !== null && back.analytics === c.analytics && back.ads === c.ads;
}

export interface StoredFirstUtm extends FirstUtmValues {
  landedAt: string;
}

export function readFirstUtm(jar: CookieJar): StoredFirstUtm | null {
  const raw = parseCookies(jar.read()).get(FIRST_UTM_COOKIE);
  if (!raw) return null;
  try {
    const o = JSON.parse(decodeURIComponent(raw)) as Record<string, unknown>;
    const out: StoredFirstUtm = { landedAt: typeof o.t === 'string' ? o.t : '' };
    for (const k of ['source', 'medium', 'campaign', 'content'] as const) {
      const v = o[k];
      if (typeof v === 'string' && /^[a-z0-9._-]{1,64}$/.test(v)) out[k] = v;
    }
    return hasAnyUtm(out) ? out : null;
  } catch {
    return null;
  }
}

/** Solo con analítica (lo decide quien llama), solo si hay algún UTM válido y ⛔ nunca sobrescribe. */
export function writeFirstUtmOnce(jar: CookieJar, utm: FirstUtmValues, landedAt: Date): boolean {
  if (!hasAnyUtm(utm)) return false;
  if (readFirstUtm(jar) !== null) return false;
  const payload = encodeURIComponent(JSON.stringify({ ...utm, t: landedAt.toISOString() }));
  jar.write(`${FIRST_UTM_COOKIE}=${payload}${attrs(jar, FIRST_UTM_MAX_AGE_S)}`);
  return true;
}

/** Cookies de una finalidad que la tienda puede borrar en su dominio (§14.3 «Revocar»). */
export function cookiesToClear(names: Iterable<string>, revoked: ConsentChoice): string[] {
  const out: string[] = [];
  for (const name of names) {
    if (revoked.analytics && (name === FIRST_UTM_COOKIE || name === '_gid' || name === '_ga' || name.startsWith('_ga_'))) {
      out.push(name);
    }
    if (revoked.ads && (name === '_fbp' || name === '_fbc')) out.push(name);
  }
  return out;
}

/** Borra con y sin `Domain` (las de terceros pueden estar en el apex o en el host). */
export function clearCookies(jar: CookieJar, names: readonly string[]): void {
  const host = jar.hostname;
  for (const name of names) {
    jar.write(`${name}=; Max-Age=0; Path=/`);
    jar.write(`${name}=; Max-Age=0; Path=/${domainAttr(host)}`);
    if (host) jar.write(`${name}=; Max-Age=0; Path=/; Domain=${host}`);
  }
}

/** ¿Se quitó algo que estaba concedido? Es el único caso con recarga (MKT2-UX.7). */
export function revokedFrom(prev: ConsentChoice | null, next: ConsentChoice): ConsentChoice {
  return {
    analytics: Boolean(prev?.analytics) && !next.analytics,
    ads: Boolean(prev?.ads) && !next.ads,
  };
}

export function todayIso(now: Date): string {
  return now.toISOString().slice(0, 10);
}
