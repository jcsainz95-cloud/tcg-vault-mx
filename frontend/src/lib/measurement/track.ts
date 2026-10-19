/**
 * API_CONTRACT §MKT.H.4 / ARCHITECTURE §14.5 — `track(evento, params)`: el ÚNICO punto por el que la
 * tienda manda un evento del navegador. **Lista cerrada de parámetros por evento**: lo que no está en
 * la lista se descarta sin avisar (C-F6). Solo actúa con el modo `on`, en una ruta de la lista blanca
 * (`routes.ts`) y con la finalidad concedida (analítica ⇒ Google; publicidad ⇒ Meta).
 *
 * ⛔ `generate_lead` no existe aquí: solo lo manda el servidor (la página de venta lleva CLABE/INE).
 * ⛔ Nunca `user_id`, `user_data`, correo, teléfono, `orderNumber` ni término de búsqueda.
 *
 * `track` no carga nada: si las etiquetas no están en el documento (`window.gtag`/`window.fbq`), no
 * hace nada. El cargador vive aparte (`loader.ts`) y solo entra al bundle con el modo `on`.
 */

import { isMeasuredPath } from './routes';
import { readFirstUtm, documentCookieJar, type ConsentChoice, type CookieJar } from './consent';
import { sanitizeMeasurementUrl, sanitizePath } from './utm';

export type BrowserEvent =
  | 'page_view'
  | 'view_item'
  | 'select_content'
  | 'buy_button_visible'
  | 'add_to_cart'
  | 'begin_checkout'
  | 'add_payment_info'
  | 'purchase'
  | 'click_contact'
  | 'search';

/** §MKT.H.4, literal. ⛔ Ampliar esta tabla es un cambio de contrato (regla 9), no de pantalla. */
export const EVENT_PARAMS: Readonly<Record<BrowserEvent, readonly string[]>> = {
  page_view: ['page_location', 'page_referrer'],
  view_item: ['items', 'value', 'currency', 'market_value_shown', 'price_vs_market_pct'],
  select_content: ['content_type', 'item_id', 'page_path'],
  buy_button_visible: ['card_id', 'seconds_to_visible'],
  add_to_cart: ['items', 'value', 'currency'],
  begin_checkout: ['items', 'value', 'currency', 'shipping_cents', 'n_items'],
  add_payment_info: ['payment_type', 'payment_methods_offered', 'value', 'currency'],
  purchase: ['transaction_id', 'items', 'value', 'currency', 'shipping_cents'],
  click_contact: ['contact_channel', 'page_path'],
  search: ['results_count'],
};

/** Claves de cada `items[]` (§MKT.H.4: `items[{item_id, item_name, item_category, price}]`). */
export const ITEM_KEYS: readonly string[] = ['item_id', 'item_name', 'item_category', 'price'];

/** Nombre estándar del píxel (§MKT.H.4). Los que no están aquí no van a Meta. */
export const PIXEL_EVENT: Readonly<Partial<Record<BrowserEvent, string>>> = {
  view_item: 'ViewContent',
  add_to_cart: 'AddToCart',
  begin_checkout: 'InitiateCheckout',
  add_payment_info: 'AddPaymentInfo',
  purchase: 'Purchase',
  click_contact: 'Contact',
};

export interface TrackItem {
  item_id: string;
  item_name: string;
  item_category: 'card' | 'sealed';
  price: number;
}

export type TrackParams = Record<string, unknown>;

type GtagFn = (...args: unknown[]) => void;
type FbqFn = (...args: unknown[]) => void;

export interface TrackRuntime {
  /** Modo horneado (`on` | `off`). */
  on: boolean;
  pathname: string;
  consent: ConsentChoice | null;
  gtag?: GtagFn;
  fbq?: FbqFn;
  jar: CookieJar;
}

function isScalar(v: unknown): v is string | number | boolean {
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

function cleanItems(raw: unknown): Record<string, unknown>[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw
    .filter((it): it is Record<string, unknown> => typeof it === 'object' && it !== null)
    .map((it) => {
      const out: Record<string, unknown> = {};
      for (const k of ITEM_KEYS) if (isScalar(it[k])) out[k] = it[k];
      return out;
    });
}

/** Filtra `params` a la lista cerrada del evento y sanea URL/ruta. Pura (C-F6). */
export function filterParams(event: BrowserEvent, params: TrackParams): Record<string, unknown> {
  const allowed = EVENT_PARAMS[event];
  const out: Record<string, unknown> = {};
  for (const key of allowed) {
    if (!(key in params)) continue;
    const v = params[key];
    if (key === 'items') {
      const items = cleanItems(v);
      if (items) out.items = items;
    } else if (key === 'page_location' || key === 'page_referrer') {
      const s = sanitizeMeasurementUrl(typeof v === 'string' ? v : '');
      if (s) out[key] = s;
    } else if (key === 'page_path') {
      const s = sanitizePath(typeof v === 'string' ? v : '');
      if (s) out[key] = s;
    } else if (key === 'payment_methods_offered' && Array.isArray(v)) {
      out[key] = v.filter((x) => typeof x === 'string').join(',');
    } else if (isScalar(v)) {
      out[key] = v;
    }
  }
  if (event === 'purchase' || event === 'view_item' || event === 'add_to_cart' || event === 'begin_checkout') {
    if ('value' in out || 'items' in out) out.currency = 'MXN';
  }
  return out;
}

/** Parámetros del píxel: derivados SOLO de los ya filtrados. */
function pixelParams(filtered: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof filtered.value === 'number') out.value = filtered.value;
  if (typeof filtered.currency === 'string') out.currency = filtered.currency;
  const items = filtered.items as Record<string, unknown>[] | undefined;
  if (items && items.length > 0) {
    out.content_ids = items.map((i) => String(i.item_id ?? '')).filter(Boolean);
    out.content_type = 'product';
    out.num_items = items.length;
  }
  return out;
}

/** El núcleo, con su entorno inyectado (pruebas C-F6). Devuelve lo que mandó (o `null`). */
export function trackWith(rt: TrackRuntime, event: BrowserEvent, params: TrackParams = {}) {
  if (!rt.on || !rt.consent) return null;
  if (!isMeasuredPath(rt.pathname)) return null;
  if (!(event in EVENT_PARAMS)) return null;
  const filtered = filterParams(event, params);
  const sent: { ga4?: Record<string, unknown>; pixel?: { name: string; params: Record<string, unknown>; eventID?: string } } = {};

  if (rt.consent.analytics && rt.gtag) {
    const ga = { ...filtered };
    const utm = readFirstUtm(rt.jar);
    if (utm) {
      if (utm.source) ga.first_utm_source = utm.source;
      if (utm.medium) ga.first_utm_medium = utm.medium;
      if (utm.campaign) ga.first_utm_campaign = utm.campaign;
      if (utm.content) ga.first_utm_content = utm.content;
    }
    rt.gtag('event', event, ga);
    sent.ga4 = ga;
  }

  const pixelName = PIXEL_EVENT[event];
  if (rt.consent.ads && rt.fbq && pixelName) {
    const p = pixelParams(filtered);
    // Deduplicación con CAPI (§MKT.H.4/.5): el MISMO id que el servidor, `p_<Order.id>`.
    const eventID = event === 'purchase' && typeof filtered.transaction_id === 'string' ? `p_${filtered.transaction_id}` : undefined;
    if (eventID) rt.fbq('track', pixelName, p, { eventID });
    else rt.fbq('track', pixelName, p);
    sent.pixel = { name: pixelName, params: p, eventID };
  }
  return sent.ga4 || sent.pixel ? sent : null;
}

// ── Estado de la pestaña (lo fija el proveedor de consentimiento) ──────────────────────────────
// `undefined` = el proveedor aún no leyó `th_consent` (los efectos de los hijos corren ANTES que los
// del padre: el `view_item` de una ficha llega antes que la lectura de la cookie). `null` = sin
// elección: lo que esperaba se tira (nada se manda por una elección posterior).
let runtimeConsent: ConsentChoice | null | undefined = undefined;

export function setRuntimeConsent(c: ConsentChoice | null): void {
  runtimeConsent = c;
  if (c === null || (!c.analytics && !c.ads)) pending.length = 0;
}

export function getRuntimeConsent(): ConsentChoice | null {
  return runtimeConsent ?? null;
}

/**
 * Eventos que llegan con la elección ya hecha pero ANTES de que el cargador termine (p. ej. el
 * `view_item` de una ficha abierta en frío). Se guardan en memoria, con su ruta, y los vacía el
 * proveedor tras cargar (`flushPendingEvents`). Tope corto: no es una cola, es el primer instante.
 */
const pending: Array<{ event: BrowserEvent; params: TrackParams; pathname: string }> = [];
const PENDING_MAX = 20;

function runtimeFor(pathname: string): TrackRuntime {
  const w = window as unknown as { gtag?: GtagFn; fbq?: FbqFn };
  return { on: true, pathname, consent: runtimeConsent ?? null, gtag: w.gtag, fbq: w.fbq, jar: documentCookieJar() };
}

/** API pública. Con el modo `off` horneado no hace nada (y no lee nada). */
export function track(event: BrowserEvent, params: TrackParams = {}): void {
  if (process.env.NEXT_PUBLIC_MEASUREMENT_MODE !== 'on') return;
  if (typeof window === 'undefined') return;
  const rt = runtimeFor(window.location.pathname);
  const c = rt.consent;
  // `loadMeasurement` define los dos stubs en la misma llamada síncrona: o no hay ninguno (aún
  // cargando) o están los que la elección permite. Se guarda en ese caso y mientras el proveedor no
  // haya leído la cookie.
  const waiting = runtimeConsent === undefined || (!!c && (c.analytics || c.ads) && !rt.gtag && !rt.fbq);
  if (waiting) {
    if (isMeasuredPath(rt.pathname) && pending.length < PENDING_MAX) pending.push({ event, params, pathname: rt.pathname });
    return;
  }
  trackWith(rt, event, params);
}

/** Lo llama el proveedor tras `loadMeasurement`. Solo manda lo que sigue en la MISMA ruta. */
export function flushPendingEvents(): void {
  if (process.env.NEXT_PUBLIC_MEASUREMENT_MODE !== 'on') return;
  if (typeof window === 'undefined') return;
  const here = window.location.pathname;
  const batch = pending.splice(0, pending.length);
  for (const p of batch) if (p.pathname === here) trackWith(runtimeFor(here), p.event, p.params);
}

/** Pesos con IVA a 2 decimales desde centavos (§MKT.H.4: `value` en pesos; `*_cents` enteros). */
export function centsToValue(cents: number): number {
  return Math.round(cents) / 100;
}
