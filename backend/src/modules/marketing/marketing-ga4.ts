/**
 * marketing-ga4.ts — las consultas de GA4 Data API del Panel y su cálculo en la tienda (API_CONTRACT v1.105 §MKT.H.9, tabla
 * «Consultas de GA4»). PURO: solo specs de `runReport` y funciones de filas → `DimensionRow[]`. Sin red ni BD.
 *
 * ⚠️ Los nombres de dimensiones y métricas son los estándar de la Data API; contrastarlos con `properties/<id>/metadata`:
 * **NO VERIFICADO** (lo cierra backend con credenciales reales al encender; hasta entonces, dobles).
 */
import type { DimensionRow } from './small-cells';
import type { Ga4ReportSpec, Ga4Row } from './marketing-external-sources';

/** e3 / a4 / b4 — asistentes de IA: lista fija en código (§MKT.H.9). */
export const AI_ASSISTANT_SOURCES = ['chatgpt.com', 'perplexity.ai', 'gemini.google.com', 'copilot.microsoft.com', 'claude.ai'] as const;
const INSTAGRAM_SOURCES = ['instagram', 'ig', 'l.instagram.com'];

/** a5 — pasos del embudo, en orden. */
export const FUNNEL_EVENTS = ['view_item', 'add_to_cart', 'begin_checkout', 'add_payment_info', 'purchase'] as const;

export const GA4_SPECS = {
  sources: { dimensions: ['sessionSource', 'sessionMedium', 'sessionDefaultChannelGroup'], metrics: ['sessions'], limit: 1000 },
  funnelEvents: {
    dimensions: ['eventName'],
    metrics: ['eventCount'],
    inList: { dimension: 'eventName', values: [...FUNNEL_EVENTS] },
  },
  funnelSessions: { dimensions: [], metrics: ['sessions'] },
  pages: {
    dimensions: ['pagePath'],
    metrics: ['screenPageViews', 'totalUsers', 'userEngagementDuration'],
    orderByMetricDesc: 'screenPageViews',
    limit: 50,
  },
  devices: { dimensions: ['deviceCategory', 'browser'], metrics: ['sessions'], limit: 100 },
  items: { dimensions: ['itemId'], metrics: ['itemsViewed', 'itemsAddedToCart'], limit: 1000 },
  aiReferrals: {
    dimensions: ['sessionSource', 'landingPage'],
    metrics: ['sessions'],
    inList: { dimension: 'sessionSource', values: [...AI_ASSISTANT_SOURCES] },
    limit: 100,
  },
} as const satisfies Record<string, Ga4ReportSpec>;

const lc = (s: string | undefined): string => (s ?? '').trim().toLowerCase();
const isAi = (source: string): boolean => (AI_ASSISTANT_SOURCES as readonly string[]).includes(lc(source));
const isGoogleOrganic = (source: string, channel: string): boolean => channel === 'Organic Search' && lc(source) === 'google';

/** a4 — los cinco grupos. */
export const A4_GROUPS = ['Instagram orgánico', 'Instagram pagado', 'Google orgánico', 'Asistentes de IA', 'Directo/otros'] as const;

export function a4Group(source: string, medium: string, channel: string): (typeof A4_GROUPS)[number] {
  if (lc(medium) === 'paid') return 'Instagram pagado';
  if (INSTAGRAM_SOURCES.includes(lc(source))) return 'Instagram orgánico';
  if (isGoogleOrganic(source, channel)) return 'Google orgánico';
  if (isAi(source)) return 'Asistentes de IA';
  return 'Directo/otros';
}

/** b4 — Google orgánico, Directo, Referencias por dominio, Asistentes de IA (lo demás no entra en b4). */
export function b4Group(source: string, medium: string, channel: string): string | null {
  if (isGoogleOrganic(source, channel)) return 'Google orgánico';
  if (isAi(source)) return 'Asistentes de IA';
  if (lc(source) === '(direct)' || channel === 'Direct') return 'Directo';
  // Instagram (también su enlazador `l.instagram.com`) es de a4/b1-b3, no una «referencia» de b4.
  if (lc(medium) === 'referral' && !INSTAGRAM_SOURCES.includes(lc(source))) return `Referencia: ${lc(source)}`;
  return null;
}

function sumBy(rows: Ga4Row[], keyOf: (r: Ga4Row) => string | null, metric = 0): DimensionRow[] {
  const acc = new Map<string, number>();
  for (const r of rows) {
    const k = keyOf(r);
    if (k === null) continue;
    acc.set(k, (acc.get(k) ?? 0) + (r.metrics[metric] ?? 0));
  }
  return [...acc.entries()].map(([key, count]) => ({ key, count, money: {} }));
}

export function a4Rows(rows: Ga4Row[]): DimensionRow[] {
  const got = sumBy(rows, (r) => a4Group(r.dimensions[0], r.dimensions[1], r.dimensions[2]));
  return A4_GROUPS.map((g) => got.find((x) => x.key === g) ?? { key: g, count: 0, money: {} });
}

export function b4Rows(rows: Ga4Row[]): DimensionRow[] {
  return sumBy(rows, (r) => b4Group(r.dimensions[0], r.dimensions[1], r.dimensions[2])).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/** c1 — 50 primeras por vistas. `count` = usuarios (la persona es lo que protege la celda pequeña). */
export function c1Rows(rows: Ga4Row[], labelOf: (path: string) => string): DimensionRow[] {
  return rows
    .slice()
    .sort((a, b) => (b.metrics[0] ?? 0) - (a.metrics[0] ?? 0))
    .slice(0, 50)
    .map((r) => {
      const views = r.metrics[0] ?? 0;
      const duration = r.metrics[2] ?? 0;
      return { key: labelOf(r.dimensions[0]), count: r.metrics[1] ?? 0, money: { vistas: views, tiempoMedio: views > 0 ? Math.round((duration / views) * 10) / 10 : null } };
    });
}

export function c5Rows(rows: Ga4Row[]): DimensionRow[] {
  return sumBy(rows, (r) => `${r.dimensions[0]} · ${r.dimensions[1]}`).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export function e3Rows(rows: Ga4Row[]): DimensionRow[] {
  return sumBy(rows, (r) => (isAi(r.dimensions[0]) ? `${lc(r.dimensions[0])} · ${r.dimensions[1]}` : null)).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/** d1/d2 — vistas y altas al carrito por `itemId`. */
export function itemViews(rows: Ga4Row[]): Map<string, { views: number; carts: number }> {
  const out = new Map<string, { views: number; carts: number }>();
  for (const r of rows) {
    const e = out.get(r.dimensions[0]) ?? { views: 0, carts: 0 };
    e.views += r.metrics[0] ?? 0;
    e.carts += r.metrics[1] ?? 0;
    out.set(r.dimensions[0], e);
  }
  return out;
}

/** d2 — umbral de vistas sin venta. */
export const D2_MIN_VIEWS = 20;

/** Ruta de ficha ⇒ id (`/<locale>/catalog/<cardId>` o `/<locale>/sellado/<inventoryItemId>`). */
export function fichaOf(path: string): { kind: 'card' | 'sealed'; id: string } | null {
  const m = /^\/(?:es|en)\/(catalog|sellado)\/([A-Za-z0-9_-]{1,64})\/?$/.exec(path.split(/[?#]/)[0]);
  if (!m) return null;
  return { kind: m[1] === 'catalog' ? 'card' : 'sealed', id: m[2] };
}
