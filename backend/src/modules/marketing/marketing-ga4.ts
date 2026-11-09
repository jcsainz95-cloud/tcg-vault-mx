/**
 * marketing-ga4.ts — las consultas de GA4 Data API del Panel y su cálculo en la tienda (API_CONTRACT v1.105 §MKT.H.9, tabla
 * «Consultas de GA4»). PURO: solo specs de `runReport` y funciones de filas → `DimensionRow[]`. Sin red ni BD.
 *
 * ⚠️ Los nombres de dimensiones y métricas son los estándar de la Data API; contrastarlos con `properties/<id>/metadata`:
 * **NO VERIFICADO** (lo cierra backend con credenciales reales al encender; hasta entonces, dobles).
 */
import { SMALL_CELL_THRESHOLD, type DimensionRow } from './small-cells';
import type { Ga4ReportSpec, Ga4Row } from './marketing-external-sources';

/** e3 / a4 / b4 — asistentes de IA: lista fija en código (§MKT.H.9). */
export const AI_ASSISTANT_SOURCES = ['chatgpt.com', 'perplexity.ai', 'gemini.google.com', 'copilot.microsoft.com', 'claude.ai'] as const;
export const INSTAGRAM_SOURCES = ['instagram', 'ig', 'l.instagram.com'];

/** a5 — pasos del embudo, en orden. */
export const FUNNEL_EVENTS = ['view_item', 'add_to_cart', 'begin_checkout', 'add_payment_info', 'purchase'] as const;

export const GA4_SPECS = {
  sources: { dimensions: ['sessionSource', 'sessionMedium', 'sessionDefaultChannelGroup'], metrics: ['sessions'], limit: 1000 },
  // MKT-V2 §5: la misma consulta de eventos con dos más (`buy_button_visible` para c4, `search`); a5 sigue leyendo FUNNEL_EVENTS.
  events: {
    dimensions: ['eventName'],
    metrics: ['eventCount'],
    inList: { dimension: 'eventName', values: [...FUNNEL_EVENTS, 'buy_button_visible', 'search'] },
  },
  // `sessions` primero (a5); `totalUsers` = «visitantes reales» de r1.
  funnelSessions: { dimensions: [], metrics: ['sessions', 'totalUsers'] },
  // limit 250: se clasifica por tipo de página (c2); c1 sigue mostrando las 50 primeras tras agregar.
  pages: {
    dimensions: ['pagePath'],
    metrics: ['screenPageViews', 'totalUsers', 'userEngagementDuration'],
    orderByMetricDesc: 'screenPageViews',
    limit: 250,
  },
  nvr: { dimensions: ['newVsReturning'], metrics: ['totalUsers'], limit: 10 },
  dailyNvr: { dimensions: ['date', 'newVsReturning'], metrics: ['totalUsers'], limit: 100 },
  dailySrc: { dimensions: ['date', 'sessionSource', 'sessionMedium', 'sessionDefaultChannelGroup'], metrics: ['sessions'], limit: 2000 },
  landing: { dimensions: ['landingPage'], metrics: ['sessions', 'engagedSessions'], limit: 250 },
  landingInstagram: {
    dimensions: ['landingPage'],
    metrics: ['sessions', 'engagedSessions'],
    inList: { dimension: 'sessionSource', values: [...INSTAGRAM_SOURCES] },
    limit: 250,
  },
  region: { dimensions: ['region'], metrics: ['totalUsers'], limit: 100 },
  devices: { dimensions: ['deviceCategory', 'browser'], metrics: ['sessions'], limit: 100 },
  // `sessionSource` puede no ser compatible con las métricas por ítem (NO VERIFICADO): si falla con el filtro, se reintenta sin él.
  items: { dimensions: ['itemId'], metrics: ['itemsViewed', 'itemsAddedToCart'], limit: 1000, fallbackUnfiltered: true },
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
  // GA4: la unidad de la fuente (sesiones) es el sujeto (§MKT.H.14).
  return [...acc.entries()].map(([key, count]) => ({ key, count, subjects: count, money: {} }));
}

export function a4Rows(rows: Ga4Row[]): DimensionRow[] {
  const got = sumBy(rows, (r) => a4Group(r.dimensions[0], r.dimensions[1], r.dimensions[2]));
  return A4_GROUPS.map((g) => got.find((x) => x.key === g) ?? { key: g, count: 0, subjects: 0, money: {} });
}

export function b4Rows(rows: Ga4Row[]): DimensionRow[] {
  return sumBy(rows, (r) => b4Group(r.dimensions[0], r.dimensions[1], r.dimensions[2])).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/**
 * c1 — 50 primeras por vistas, AGREGADAS por la etiqueta (`key`): la misma ficha en `/es/…` y `/en/…` es una fila
 * (TL-MKT2-D5). `count` = usuarios (la persona es lo que protege la celda pequeña). GA4 no da los únicos de la unión: la
 * suma es su cota alta y el mayor de los componentes su cota baja. Si la cota baja es < 5 la unión PUEDE ser < 5 ⇒ `count`
 * = esa cota baja (queda «< 5»); si no, la unión es ≥ 5 seguro ⇒ `count` = la suma. El corte de 50 va DESPUÉS de agregar.
 */
export function c1Rows(rows: Ga4Row[], labelOf: (path: string) => string): DimensionRow[] {
  const acc = new Map<string, { views: number; users: number; maxUsers: number; duration: number }>();
  for (const r of rows) {
    const key = labelOf(r.dimensions[0]);
    const e = acc.get(key) ?? { views: 0, users: 0, maxUsers: 0, duration: 0 };
    e.views += r.metrics[0] ?? 0;
    e.users += r.metrics[1] ?? 0;
    e.maxUsers = Math.max(e.maxUsers, r.metrics[1] ?? 0);
    e.duration += r.metrics[2] ?? 0;
    acc.set(key, e);
  }
  return [...acc.entries()]
    .sort(([ka, a], [kb, b]) => b.views - a.views || ka.localeCompare(kb))
    .slice(0, 50)
    .map(([key, e]) => {
      const count = e.maxUsers < SMALL_CELL_THRESHOLD ? e.maxUsers : e.users;
      return { key, count, subjects: count, money: { vistas: e.views, tiempoMedio: e.views > 0 ? Math.round((e.duration / e.views) * 10) / 10 : null } };
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

// ───────────────────────── MKT-V2: tipo de página (c2, c3, c8) y filas nuevas ─────────────────────────

export const PAGE_TYPES = ['home', 'catalogo', 'ficha-carta', 'sellado', 'ficha-sellado', 'checkout', 'buylist', 'cuenta', 'card-show', 'otras'] as const;
export type PageType = (typeof PAGE_TYPES)[number];
export const PAGE_TYPE_LABEL: Record<PageType, string> = {
  home: 'Inicio',
  catalogo: 'Catálogo (lista)',
  'ficha-carta': 'Ficha de carta',
  sellado: 'Sellado (lista)',
  'ficha-sellado': 'Ficha de sellado',
  checkout: 'Carrito y pago',
  buylist: 'Buylist (vender cartas)',
  cuenta: 'Cuenta y bóveda',
  'card-show': 'Card Show',
  otras: 'Otras páginas',
};

/** Tipo de página de una ruta; ignora query/hash y el idioma (`es|en`). PURO. */
export function pageTypeOf(path: string): PageType {
  const clean = (path.split(/[?#]/)[0] ?? '').replace(/\/+$/, '');
  if (clean === '/card-show') return 'card-show';
  const parts = clean.split('/').filter(Boolean);
  if (parts.length === 0) return 'otras';
  if (parts[0] === 'es' || parts[0] === 'en') parts.shift();
  const a = parts[0];
  if (a === undefined) return 'home';
  const n = parts.length;
  if ((a === 'catalog' || a === 'compra') && n === 1) return 'catalogo';
  if (a === 'catalog' && n === 2) return 'ficha-carta';
  if (a === 'sellado' && n === 1) return 'sellado';
  if (a === 'sellado' && n === 2) return 'ficha-sellado';
  if (a === 'checkout' || a === 'cart' || a === 'carrito') return 'checkout';
  if (a === 'buylist') return 'buylist';
  if (a === 'account' || a === 'vault' || a === 'orders' || a === 'cuenta' || a === 'boveda') return 'cuenta';
  return 'otras';
}

/** c2 — misma agregación de c1 (usuarios con cota, vistas, tiempo medio) pero por TIPO de página. */
export function c2Rows(rows: Ga4Row[]): DimensionRow[] {
  return c1Rows(rows, (p) => PAGE_TYPE_LABEL[pageTypeOf(p)]);
}

/**
 * c3 / c8 — por tipo de página de aterrizaje: sesiones y abandono = 1 − engagedSessions/sessions (en %, 1 decimal).
 * `count` = sesiones (la unidad de la fuente); sin sesiones ⇒ abandono `null`.
 */
export function landingRows(rows: Ga4Row[]): DimensionRow[] {
  const acc = new Map<string, { s: number; e: number }>();
  for (const r of rows) {
    const k = PAGE_TYPE_LABEL[pageTypeOf(r.dimensions[0])];
    const e = acc.get(k) ?? { s: 0, e: 0 };
    e.s += r.metrics[0] ?? 0;
    e.e += r.metrics[1] ?? 0;
    acc.set(k, e);
  }
  return [...acc.entries()]
    .sort(([ka, a], [kb, b]) => b.s - a.s || ka.localeCompare(kb))
    .map(([key, e]) => ({ key, count: e.s, subjects: e.s, money: { abandono: e.s > 0 ? Math.round((1 - Math.min(e.e, e.s) / e.s) * 1000) / 10 : null } }));
}

/** c9 — usuarios por estado (`region` de GA4); sin ciudad. «(not set)» se rotula. */
export function regionRows(rows: Ga4Row[]): DimensionRow[] {
  return sumBy(rows, (r) => (r.dimensions[0] === '' || r.dimensions[0] === '(not set)' ? 'Sin dato' : r.dimensions[0])).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/** Nuevos / recurrentes (`newVsReturning`: `new` | `returning`; `(not set)` no entra). */
export function nvrOf(rows: Ga4Row[]): { nuevos: number; recurrentes: number } {
  let nuevos = 0;
  let recurrentes = 0;
  for (const r of rows) {
    if (r.dimensions[0] === 'new') nuevos += r.metrics[0] ?? 0;
    else if (r.dimensions[0] === 'returning') recurrentes += r.metrics[0] ?? 0;
  }
  return { nuevos, recurrentes };
}
