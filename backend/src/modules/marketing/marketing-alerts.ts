/**
 * marketing-alerts.ts — los 6 avisos deterministas del Resumen (MKT_PANEL_V2 §2). PURO: entradas ya medidas ⇒ filas de `r2`.
 * Sin IA, sin red, sin BD. Umbrales en constantes con nombre (backend y qa los revisan a las 4 semanas, sin preguntar al dueño).
 * Orden fijo AV1…AV6; ≤ 3 elementos por regla (cifra desc, clave asc). Todo umbral de conteo es ≥ 5 EXCEPTO el de la caída
 * de AV2 (la cifra actual puede ser < 5): en `small_cells` esa cifra se cita como «menos de 5», nunca exacta.
 */
import { AV_TEXT, NOT_EVALUATED, NO_ALERTS } from './marketing-alerts.text';

export const AV1_MIN_CHECKOUTS = 5;
export const AV2_MIN_PREVIOUS = 10;
export const AV2_MAX_RATIO = 0.5;
export const AV3_MIN_VIEWS = 10;
export const AV3_MAX_CARTS = 1;
export const AV4_MIN_IMPRESSIONS = 20;
export const AV5_MIN_QUOTES = 5;
export const AV6_MIN_COUNT = 5;
export const AV6_MIN_DAYS = 2;
export const ALERTS_PER_RULE = 3;
const SMALL = 5;

export interface Alert {
  regla: string;
  gravedad: 'alta' | 'media' | 'info';
  titulo: string;
  evidencia: string;
  accion: string;
}

export interface AlertInputs {
  /** `begin_checkout` de la semana (GA4); `null` ⇒ GA4 sin medir. */
  checkoutStarts: number | null;
  paidOrders: number;
  /** Grupos de a4 con sesiones de la semana y de la anterior; `null` ⇒ GA4 sin medir. */
  groups: { name: string; cur: number; prev: number }[] | null;
  /** Fichas con sus vistas/carritos/vendida; `null` ⇒ GA4 sin medir. */
  items: { name: string; views: number; carts: number; sold: boolean }[] | null;
  /** Páginas de Google (nunca consultas); `null` ⇒ Search Console sin medir. */
  scPages: { label: string; impressions: number; clicks: number; position: number }[] | null;
  buylist: { name: string; quotes: number; listed: number }[];
  searchMisses: { term: string; count: number; days: number }[] | null;
  /** `true` = vista del dueño (cifras exactas); `false` = correo/exports/tokens. */
  exact: boolean;
}

const top = <T>(xs: T[], rank: (x: T) => number, key: (x: T) => string): T[] =>
  [...xs].sort((a, b) => rank(b) - rank(a) || key(a).localeCompare(key(b))).slice(0, ALERTS_PER_RULE);

export function evaluateAlerts(i: AlertInputs): Alert[] {
  const out: Alert[] = [];
  const add = (regla: string, gravedad: Alert['gravedad'], t: { titulo: string; evidencia: string; accion: string }) => out.push({ regla, gravedad, ...t });

  if (i.checkoutStarts !== null && i.checkoutStarts >= AV1_MIN_CHECKOUTS && i.paidOrders === 0) add('AV1', 'alta', AV_TEXT.AV1(i.checkoutStarts));

  if (i.groups) {
    const hit = i.groups.filter((g) => g.prev >= AV2_MIN_PREVIOUS && g.cur <= g.prev * AV2_MAX_RATIO);
    for (const g of top(hit, (x) => x.prev, (x) => x.name)) {
      const hidden = !i.exact && g.cur > 0 && g.cur < SMALL;
      const pct = hidden ? null : Math.round(((g.cur - g.prev) / g.prev) * 100);
      add('AV2', 'alta', AV_TEXT.AV2(g.name, g.prev, hidden ? 'menos de 5' : String(g.cur), pct, g.name.startsWith('Instagram')));
    }
  }

  if (i.items) {
    const hit = i.items.filter((x) => x.views >= AV3_MIN_VIEWS && !x.sold && x.carts <= AV3_MAX_CARTS);
    for (const x of top(hit, (y) => y.views, (y) => y.name)) add('AV3', 'media', AV_TEXT.AV3(x.name, x.views));
  }

  if (i.scPages) {
    const hit = i.scPages.filter((p) => p.impressions >= AV4_MIN_IMPRESSIONS && p.clicks === 0);
    for (const p of top(hit, (y) => y.impressions, (y) => y.label)) add('AV4', 'media', AV_TEXT.AV4(p.label, p.impressions, Math.round(p.position * 10) / 10));
  }

  const b = i.buylist.filter((x) => x.quotes >= AV5_MIN_QUOTES && x.listed === 0);
  for (const x of top(b, (y) => y.quotes, (y) => y.name)) add('AV5', 'media', AV_TEXT.AV5(x.name, x.quotes));

  if (i.searchMisses) {
    const hit = i.searchMisses.filter((s) => s.count >= AV6_MIN_COUNT && s.days >= AV6_MIN_DAYS);
    for (const s of top(hit, (y) => y.count, (y) => y.term)) add('AV6', 'info', AV_TEXT.AV6(s.term, s.count, s.days));
  }

  if (out.length === 0) out.push({ regla: '—', gravedad: 'info', ...NO_ALERTS });
  return out;
}

/** Filas «No se evaluó: …» de las fuentes sin medir (se añaden DESPUÉS de los avisos). */
export function notEvaluatedRows(sources: string[]): Alert[] {
  return sources.map((s) => ({ regla: '—', gravedad: 'info' as const, ...NOT_EVALUATED(s) }));
}
