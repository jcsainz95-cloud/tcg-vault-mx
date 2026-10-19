/**
 * measurement-bodies.ts — constructores PUROS de los cuerpos de servidor (API_CONTRACT §MKT.H.5; ARCHITECTURE §14.7).
 *
 * Lista CERRADA de claves por nivel: el cuerpo se arma campo a campo desde un «hecho» mínimo ya proyectado (ids opacos,
 * montos, nombres de producto). ⛔ Los hechos de entrada NO llevan correo, teléfono, dirección, CLABE, `orderNumber`,
 * tokens ni IP: no hay de dónde filtrarlos. Candado C-B3 (`test/measurement.bodies.spec.ts`).
 *
 * ⛔ Prohibido en cualquier nivel (GA4): `user_id`, `user_data`, `ip_override`, `user_agent`, `user_location`,
 * `user_properties`. ⛔ En `user_data` de CAPI solo `fbp`/`fbc` (sin `client_user_agent`: ARCHITECTURE §14.10 (2), por
 * defecto no).
 */
import { randomInt } from 'node:crypto';

export type ItemCategory = 'card' | 'sealed' | 'accessory';

export interface MeasurementItem {
  item_id: string;
  item_name: string;
  item_category: ItemCategory;
  price: number;
  quantity: number;
}

/** Hecho de compra (proyectado de `Order` + líneas). */
export interface PurchaseFact {
  orderId: string;
  totalCents: number;
  shippingFeeCents: number;
  settledAt: Date;
  items: MeasurementItem[];
  consentAnalytics: boolean;
  firstUtm: { source?: string; medium?: string; campaign?: string; content?: string };
}

/** Hecho de solicitud de venta (proyectado de `SellRequest`). */
export interface LeadFact {
  sellRequestId: string;
  quotedTotalCents: number;
  createdAt: Date;
  consentAnalytics: boolean;
  firstUtm: { source?: string; medium?: string; campaign?: string; content?: string };
}

/** Identificadores del navegador (solo los consentidos; `MeasurementContext`). */
export interface BrowserIds {
  gaClientId?: string | null;
  fbp?: string | null;
  fbc?: string | null;
}

/** `event_id` determinista (§14.6): el navegador lo calcula igual ⇒ Meta deduplica navegador + servidor. */
export const purchaseEventId = (orderId: string): string => `p_${orderId}`;
export const leadEventId = (sellRequestId: string): string => `l_${sellRequestId}`;

/** Centavos → pesos con 2 decimales (enteros ⇒ sin deriva). */
export const pesos = (cents: number): number => Math.round(cents) / 100;

/** `client_id` aleatorio NUEVO por evento (sin analítica): misma forma que el de gtag (`<n>.<epoch>`). */
export function randomClientId(now: Date): string {
  return `${randomInt(1_000_000_000, 2_000_000_000)}.${Math.floor(now.getTime() / 1000)}`;
}

function utmParams(fact: { consentAnalytics: boolean; firstUtm: PurchaseFact['firstUtm'] }): Record<string, string> {
  if (!fact.consentAnalytics) return {};
  const out: Record<string, string> = {};
  if (fact.firstUtm.source) out.first_utm_source = fact.firstUtm.source;
  if (fact.firstUtm.medium) out.first_utm_medium = fact.firstUtm.medium;
  if (fact.firstUtm.campaign) out.first_utm_campaign = fact.firstUtm.campaign;
  if (fact.firstUtm.content) out.first_utm_content = fact.firstUtm.content;
  return out;
}

const item = (i: MeasurementItem): MeasurementItem => ({
  item_id: i.item_id,
  item_name: i.item_name,
  item_category: i.item_category,
  price: i.price,
  quantity: i.quantity,
});

/**
 * `client_id`: el `gaClientId` del navegador SOLO con analítica; si no, uno aleatorio por evento (C-B4). El llamador
 * pasa `ids` tal como están en `MeasurementContext` (que ya solo los tiene si hubo consentimiento al crear).
 */
function clientIdOf(consentAnalytics: boolean, ids: BrowserIds, now: Date): string {
  return consentAnalytics && ids.gaClientId ? ids.gaClientId : randomClientId(now);
}

const GA4_ENVELOPE = {
  non_personalized_ads: true,
  consent: { ad_user_data: 'DENIED', ad_personalization: 'DENIED' },
} as const;

export function buildGa4Purchase(f: PurchaseFact, ids: BrowserIds, now: Date): Record<string, unknown> {
  return {
    client_id: clientIdOf(f.consentAnalytics, ids, now),
    non_personalized_ads: GA4_ENVELOPE.non_personalized_ads,
    consent: { ...GA4_ENVELOPE.consent },
    events: [
      {
        name: 'purchase',
        params: {
          transaction_id: f.orderId,
          value: pesos(f.totalCents),
          currency: 'MXN',
          items: f.items.map(item),
          shipping_cents: f.shippingFeeCents,
          source: 'server',
          ...utmParams(f),
        },
      },
    ],
  };
}

export function buildGa4Lead(f: LeadFact, ids: BrowserIds, now: Date): Record<string, unknown> {
  return {
    client_id: clientIdOf(f.consentAnalytics, ids, now),
    non_personalized_ads: GA4_ENVELOPE.non_personalized_ads,
    consent: { ...GA4_ENVELOPE.consent },
    events: [
      {
        name: 'generate_lead',
        params: {
          quote_id: f.sellRequestId,
          value: pesos(f.quotedTotalCents),
          currency: 'MXN',
          source: 'server',
          ...utmParams(f),
        },
      },
    ],
  };
}

function userData(ids: BrowserIds): { fbp?: string; fbc?: string } {
  const out: { fbp?: string; fbc?: string } = {};
  if (ids.fbp) out.fbp = ids.fbp;
  if (ids.fbc) out.fbc = ids.fbc;
  return out;
}

/** CAPI: el token viaja en el cuerpo como `access_token` (lo añade el emisor, no el constructor: así C-B3 mira el resto). */
export function buildCapiPurchase(f: PurchaseFact, ids: BrowserIds, eventSourceUrl: string): Record<string, unknown> {
  return {
    data: [
      {
        event_name: 'Purchase',
        event_time: Math.floor(f.settledAt.getTime() / 1000),
        event_id: purchaseEventId(f.orderId),
        action_source: 'website',
        event_source_url: eventSourceUrl,
        user_data: userData(ids),
        custom_data: {
          currency: 'MXN',
          value: pesos(f.totalCents),
          content_ids: f.items.map((i) => i.item_id),
          content_type: 'product',
          num_items: f.items.reduce((n, i) => n + i.quantity, 0),
        },
      },
    ],
  };
}

export function buildCapiLead(f: LeadFact, ids: BrowserIds, eventSourceUrl: string): Record<string, unknown> {
  return {
    data: [
      {
        event_name: 'Lead',
        event_time: Math.floor(f.createdAt.getTime() / 1000),
        event_id: leadEventId(f.sellRequestId),
        action_source: 'website',
        event_source_url: eventSourceUrl,
        user_data: userData(ids),
        custom_data: { currency: 'MXN', value: pesos(f.quotedTotalCents) },
      },
    ],
  };
}

/**
 * `event_source_url` = origen de `APP_BASE_URL` + la página que crea el hecho: `/checkout` (compra) o `/buylist`
 * (solicitud) — API_CONTRACT v1.105 §MKT.H.13 (sin `sourcePath`). Solo origen + ruta: ⛔ sin query ni fragmento.
 */
export function eventSourceUrl(origin: string, path: string): string {
  let o = origin.trim().replace(/\/+$/, '');
  try {
    o = new URL(o).origin;
  } catch {
    o = 'https://tcghunt.mx';
  }
  const p = path.startsWith('/') ? path.split(/[?#]/)[0] : '/';
  return `${o}${p}`;
}
