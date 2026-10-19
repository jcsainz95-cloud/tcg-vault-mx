/**
 * marketing-populations.ts — REGISTRO de poblaciones del Panel de Marketing (API_CONTRACT §MKT.H.14, v1.107; MKT-TL2 a).
 * Fuente EN CÓDIGO de la tabla «Poblaciones / Tabla · Componentes» del contrato. PURO (sin IO).
 *
 * Para qué: la supresión de una celda solo protege si se sabe contra qué otra cifra del mismo periodo se puede cruzar. Toda
 * tabla que el servicio emite tiene que estar aquí, con cada columna que no sea texto asignada a un COMPONENTE (conteo de
 * sujetos de una población + sus MX$/derivadas) o declarada EXACTA por diseño. Una tabla nueva sin fila aquí pone roja
 * `test/marketing-populations.registry.spec.ts` (prueba 1): nadie publica una tabla sin decidir de qué población sale.
 *
 * ⚠️ Fuera de este fichero, por ahora (MKT-TL2, docs/TECH_DEBT.md): las ecuaciones entre tablas (`MARKETING_EQUATIONS`),
 * `exposedCells` y `enforceFamily` (R3b/R4) y su auditor (prueba 3). Hasta su verde, MKT-TL2 sigue abierta con caducidad.
 */

/** Poblaciones de sujetos (§MKT.H.14 «Poblaciones»). `GA4:<consulta>` y `SC`: la unidad de la fuente. */
export const MARKETING_POPULATIONS = {
  /** `Order.settledAt` en el periodo y `status ∈ {settled, refunded, chargeback}`. Sujeto: pedido. */
  PAID: { subject: 'pedido', source: 'BD' },
  /** `PAID` ∧ `firstUtmSource IS NOT NULL` — base de b1, b2, b3 y g1. Sujeto: pedido. */
  PAID_ORIGIN: { subject: 'pedido', source: 'BD' },
  /** `SellRequest` creada en el periodo. Sujeto: solicitud. */
  REQ: { subject: 'solicitud', source: 'BD' },
  /** `REQ` ∧ `firstUtmSource IS NOT NULL`. Sujeto: solicitud. */
  REQ_ORIGIN: { subject: 'solicitud', source: 'BD' },
  /** `SellRequest.status = 'pagada'` ∧ `paidAt` en el periodo. Sujeto: solicitud. */
  REQ_PAID: { subject: 'solicitud', source: 'BD' },
  /** Altas de `WishlistItem` en el periodo de cartas con 0 piezas `listed` de plataforma hoy. Sujeto: usuario. */
  WISH: { subject: 'usuario', source: 'BD' },
  'GA4:sources': { subject: 'sesión', source: 'GA4' },
  'GA4:funnel': { subject: 'evento', source: 'GA4' },
  'GA4:pages': { subject: 'usuario', source: 'GA4' },
  'GA4:devices': { subject: 'sesión', source: 'GA4' },
  'GA4:items': { subject: 'vista', source: 'GA4' },
  'GA4:aiReferrals': { subject: 'sesión', source: 'GA4' },
  SC: { subject: 'clic', source: 'SC' },
} as const;
export type PopulationId = keyof typeof MARKETING_POPULATIONS;

/** Un componente: el conteo de sujetos de UNA población y las MX$/derivadas de esos sujetos (§MKT.H.14). */
export interface PopulationComponent {
  /** Columna de conteo (`null` si la tabla solo publica derivadas, como a2). */
  count: string | null;
  /** Columnas de MX$ o derivadas de ESOS sujetos (se ocultan con el conteo). */
  derived: readonly string[];
  population: PopulationId;
  /** Fila a la que se limita (tablas cuyas filas son poblaciones distintas: a3, a5, f3). Sin ella, todas. */
  row?: string;
  /** Filtro adicional sobre la población, en palabras (g1: `firstUtmMedium='paid'`; d1: carta suelta). */
  filter?: string;
}

/** Clase de la tabla (§MKT.H.14, última columna del registro). */
export type TableClass = 'accepted_total' | 'mixed' | 'dimension' | 'single_row' | 'anonymous' | 'text' | 'deferred';

export interface TableRegistration {
  class: TableClass;
  components: readonly PopulationComponent[];
  /** Columnas no texto EXACTAS por diseño (no son de una persona, o son % de un total aceptado). */
  exact: readonly string[];
}

const c = (count: string | null, derived: readonly string[], population: PopulationId, extra: Partial<PopulationComponent> = {}): PopulationComponent => ({
  count,
  derived,
  population,
  ...extra,
});

/** Una entrada por `tables[].id` de MKT.G.4. Orden: el del catálogo. */
export const MARKETING_TABLES: Readonly<Record<string, TableRegistration>> = {
  a1: { class: 'accepted_total', components: [c('pedidos', ['mxn'], 'PAID')], exact: [] },
  a2: { class: 'accepted_total', components: [c(null, ['ticket', 'piezasPorPedido'], 'PAID')], exact: [] },
  a3: {
    class: 'mixed',
    components: [
      c('n', ['mxn'], 'REQ', { row: 'Solicitudes enviadas (generate_lead)' }),
      c('n', ['mxn'], 'REQ_PAID', { row: 'Ofertas aceptadas / pagadas' }),
    ],
    exact: [],
  },
  a4: { class: 'dimension', components: [c('sesiones', [], 'GA4:sources')], exact: [] },
  a5: {
    class: 'accepted_total',
    components: [c('n', [], 'GA4:funnel'), c('n', [], 'PAID', { row: 'Compras (BD)' })],
    exact: ['pct'],
  },
  b1: { class: 'dimension', components: [c('pedidos', ['mxnPedidos'], 'PAID_ORIGIN'), c('solicitudes', ['mxnOfertado'], 'REQ_ORIGIN')], exact: [] },
  b2: { class: 'dimension', components: [c('pedidos', ['mxnPedidos'], 'PAID_ORIGIN'), c('solicitudes', ['mxnOfertado'], 'REQ_ORIGIN')], exact: [] },
  b3: { class: 'dimension', components: [c('pedidos', ['mxnPedidos'], 'PAID_ORIGIN'), c('solicitudes', ['mxnOfertado'], 'REQ_ORIGIN')], exact: [] },
  b4: { class: 'dimension', components: [c('sesiones', [], 'GA4:sources')], exact: [] },
  c1: { class: 'dimension', components: [c('usuarios', ['vistas', 'tiempoMedio'], 'GA4:pages')], exact: [] },
  c2: { class: 'deferred', components: [], exact: [] },
  c3: { class: 'deferred', components: [], exact: [] },
  c4: { class: 'deferred', components: [], exact: [] },
  c5: { class: 'dimension', components: [c('sesiones', [], 'GA4:devices')], exact: [] },
  c6: { class: 'deferred', components: [], exact: [] },
  c7: { class: 'dimension', components: [c('pedidos', [], 'PAID')], exact: [] },
  c8: { class: 'deferred', components: [], exact: [] },
  d1: {
    class: 'dimension',
    components: [c('unidadesVendidas', ['mxn', 'vistas'], 'PAID', { filter: 'carta suelta; sujeto = pedido distinto' })],
    exact: ['aLaVentaHoy'],
  },
  d2: { class: 'dimension', components: [c('vistas', ['carritoPct'], 'GA4:items')], exact: [] },
  d3: { class: 'dimension', components: [c('listaDeseos', [], 'WISH', { filter: 'sujeto = usuario distinto' })], exact: ['aLaVentaHoy'] },
  d4: { class: 'anonymous', components: [], exact: ['calculos'] },
  d4b: { class: 'dimension', components: [c('solicitudes', [], 'REQ', { filter: 'por carta; sujeto = solicitud distinta' })], exact: [] },
  e1: { class: 'dimension', components: [c('clics', ['impresiones', 'ctr', 'posicion'], 'SC')], exact: [] },
  e3: { class: 'dimension', components: [c('sesiones', [], 'GA4:aiReferrals')], exact: [] },
  f1: { class: 'anonymous', components: [], exact: ['total', 'movil', 'escritorio', 'tableta', 'sinDato'] },
  f3: {
    class: 'accepted_total',
    components: [
      c('pedidos', [], 'PAID', { row: 'Pedidos pagados del periodo' }),
      c('pedidos', [], 'PAID_ORIGIN', { row: 'Con origen registrado (first_utm_source)' }),
      c('pedidos', [], 'PAID', { row: 'Aceptaron la analítica', filter: 'measurementConsentAnalytics = true' }),
      c('pedidos', [], 'PAID', { row: 'La rechazaron', filter: 'measurementConsentAnalytics = false' }),
      c('pedidos', [], 'PAID', {
        row: 'Sin elección registrada (no respondió al aviso, o pedido anterior a la medición)',
        filter: 'measurementConsentAnalytics IS NULL',
      }),
    ],
    exact: ['pct'],
  },
  g1: { class: 'single_row', components: [c('pedidos', ['mxn'], 'PAID_ORIGIN', { filter: "firstUtmMedium = 'paid'" })], exact: [] },
  h1: { class: 'text', components: [], exact: [] },
};

/** Totales sin dimensión que el dueño acepta exactos (Brief 2 §5.2; §MKT.H.14 «Total aceptado»). */
export const ACCEPTED_TOTALS: readonly string[] = ['a1', 'a2', 'a3:Solicitudes enviadas (generate_lead)', 'a5', 'f3'];

/** Columnas no texto que el registro cubre en una tabla (componentes + exactas). */
export function registeredColumns(id: string): Set<string> {
  const t = MARKETING_TABLES[id];
  const out = new Set<string>(t ? t.exact : []);
  for (const comp of t?.components ?? []) {
    if (comp.count) out.add(comp.count);
    for (const d of comp.derived) out.add(d);
  }
  return out;
}
