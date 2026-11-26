/**
 * §ORIGEN-VISITA (docs/API_CONTRACT_ORIGEN.md, CV-1..CV-9) — origen de la visita SIN cookies de medición.
 *
 * Al aterrizar se guarda en `sessionStorage` (no cookie, no `localStorage`, sin identificador) de dónde vino
 * la pestaña: los `utm_*` de la URL de entrada (misma regla que `parseFirstUtm`) o, sin UTM, el referente
 * REDUCIDO AQUÍ al enum del contrato (la URL o el dominio crudo nunca salen del navegador). La primera
 * entrada de la pestaña gana. Se manda como `visitOrigin` en las tres peticiones que crean pedido o
 * solicitud, independiente del banner y de `MEASUREMENT_MODE`. ⛔ Nada de esto va a GA4, Meta, CAPI ni al
 * `MeasurementContext`. Nunca debe romper la compra: `sessionStorage` puede lanzar ⇒ todo en try/catch.
 */

import { hasAnyUtm, parseFirstUtm, searchParamsToRecord } from '@/lib/measurement/utm';

export const VISIT_ORIGIN_KEY = 'th_visit_origin';

export const VISIT_REFERRERS = [
  'google',
  'bing',
  'chatgpt',
  'perplexity',
  'gemini',
  'instagram',
  'facebook',
  'otro',
  'directo',
] as const;
export type VisitReferrer = (typeof VISIT_REFERRERS)[number];

export interface VisitOrigin {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  referrer?: VisitReferrer;
}

const isHost = (host: string, domain: string): boolean => host === domain || host.endsWith(`.${domain}`);

/** Referente crudo ⇒ enum. `ownHost` (y vacío o ilegible) ⇒ `directo`. Cualquier otro sitio ⇒ `otro`. */
export function reduceReferrer(raw: string | null | undefined, ownHost?: string): VisitReferrer {
  if (!raw) return 'directo';
  let host: string;
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    return 'directo';
  }
  if (!host) return 'directo';
  const own = ownHost?.toLowerCase();
  if (own && (host === own || host.endsWith(`.${own}`) || own.endsWith(`.${host}`))) return 'directo';
  if (host === 'gemini.google.com') return 'gemini';
  if (/^(.+\.)?google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(host)) return 'google';
  if (isHost(host, 'bing.com')) return 'bing';
  if (isHost(host, 'chatgpt.com') || isHost(host, 'chat.openai.com')) return 'chatgpt';
  if (isHost(host, 'perplexity.ai')) return 'perplexity';
  if (isHost(host, 'instagram.com')) return 'instagram';
  if (isHost(host, 'facebook.com') || isHost(host, 'fb.com') || isHost(host, 'fb.me')) return 'facebook';
  return 'otro';
}

/** Puro: query de entrada + referente ⇒ origen. UTM válido gana; si no, el referente reducido. */
export function computeVisitOrigin(search: string, referrer: string | null | undefined, ownHost?: string): VisitOrigin {
  const utm = parseFirstUtm(searchParamsToRecord(new URLSearchParams(search)));
  if (hasAnyUtm(utm)) {
    const out: VisitOrigin = {};
    if (utm.source) out.utmSource = utm.source;
    if (utm.medium) out.utmMedium = utm.medium;
    if (utm.campaign) out.utmCampaign = utm.campaign;
    if (utm.content) out.utmContent = utm.content;
    return out;
  }
  return { referrer: reduceReferrer(referrer, ownHost) };
}

/** Guarda el origen si la pestaña aún no tiene uno (primera entrada gana). Nunca lanza. */
export function captureVisitOrigin(): void {
  try {
    if (typeof window === 'undefined') return;
    if (window.sessionStorage.getItem(VISIT_ORIGIN_KEY) !== null) return;
    const origin = computeVisitOrigin(window.location.search, document.referrer, window.location.hostname);
    window.sessionStorage.setItem(VISIT_ORIGIN_KEY, JSON.stringify(origin));
  } catch {
    /* sessionStorage bloqueado o lleno: sin dato, la compra sigue igual */
  }
}

/** Lee y re-valida lo guardado. Sin sessionStorage o sin dato ⇒ `undefined` (se omite el campo). Nunca lanza. */
export function readVisitOrigin(): VisitOrigin | undefined {
  try {
    if (typeof window === 'undefined') return undefined;
    const raw = window.sessionStorage.getItem(VISIT_ORIGIN_KEY);
    if (raw === null) return undefined;
    const p: unknown = JSON.parse(raw);
    if (p == null || typeof p !== 'object' || Array.isArray(p)) return undefined;
    const o = p as Record<string, unknown>;
    const utm = parseFirstUtm({
      utm_source: o.utmSource,
      utm_medium: o.utmMedium,
      utm_campaign: o.utmCampaign,
      utm_content: o.utmContent,
    });
    const out: VisitOrigin = {};
    if (utm.source) out.utmSource = utm.source;
    if (utm.medium) out.utmMedium = utm.medium;
    if (utm.campaign) out.utmCampaign = utm.campaign;
    if (utm.content) out.utmContent = utm.content;
    if (Object.keys(out).length > 0) return out;
    if (typeof o.referrer === 'string' && (VISIT_REFERRERS as readonly string[]).includes(o.referrer)) {
      return { referrer: o.referrer as VisitReferrer };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** Campo de body de `/checkout/session`, `/checkout/guest/session` y `/buylist/requests`. `{}` si no hay dato. */
export function visitOriginBodyField(): { visitOrigin?: VisitOrigin } {
  const v = readVisitOrigin();
  return v ? { visitOrigin: v } : {};
}
