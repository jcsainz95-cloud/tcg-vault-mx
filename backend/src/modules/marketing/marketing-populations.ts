/**
 * marketing-populations.ts — REGISTRO de poblaciones del Panel de Marketing (API_CONTRACT §MKT.H.14, v1.107; MKT-TL2 a).
 * Fuente EN CÓDIGO de la tabla «Poblaciones / Tabla · Componentes» del contrato. PURO (sin IO).
 *
 * Para qué: la supresión de una celda solo protege si se sabe contra qué otra cifra del mismo periodo se puede cruzar. Toda
 * tabla que el servicio emite tiene que estar aquí, con cada columna que no sea texto asignada a un COMPONENTE (conteo de
 * sujetos de una población + sus MX$/derivadas) o declarada EXACTA por diseño. Una tabla nueva sin fila aquí pone roja
 * `test/marketing-populations.registry.spec.ts` (prueba 1): nadie publica una tabla sin decidir de qué población sale.
 *
 * También aquí (MKT-TL2 b): las ecuaciones entre tablas del mismo periodo (`MARKETING_EQUATIONS`, E1-E7), las familias que se
 * calculan juntas (`MARKETING_FAMILIES`), `exposedCells` (qué celda oculta se despeja) y `enforceFamily` (R3b y R4). Su
 * auditor, independiente de este fichero, es `test/marketing-cross-table.audit.spec.ts` (prueba 3).
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

/**
 * Totales sin dimensión que el dueño acepta exactos (Brief 2 §5.2; §MKT.H.14 «Total aceptado»): `<tabla>` entera o
 * `<tabla>:<fila>`. En las ecuaciones son CONSTANTES (se publican siempre) y R3b nunca los oculta (`isAcceptedTotal`).
 */
export const ACCEPTED_TOTALS: readonly string[] = ['a1', 'a2', 'a3:Solicitudes enviadas (generate_lead)', 'a5', 'f3'];

/** ¿Es (tabla, fila) un total aceptado? */
export const isAcceptedTotal = (table: string, key: string): boolean => ACCEPTED_TOTALS.includes(table) || ACCEPTED_TOTALS.includes(`${table}:${key}`);

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

// ─────────────────────────── Ecuaciones entre tablas (§MKT.H.14 «Ecuaciones», MKT-TL2 b) ───────────────────────────

/** Filas de una tabla que entran en un término: una clave, las claves que acaban en un sufijo (b1 por puerta) o todas. */
export type RowSelector = { key: string } | { keySuffix: string } | 'all';
/** Un término: la suma de `column` sobre las filas que elige `row` en `table`. */
export interface EquationTerm {
  table: string;
  row: RowSelector;
  column: string;
}
/**
 * `left = Σ right`, en el mismo periodo. `identity`: dos celdas que valen lo mismo por construcción (R4: comparten estado).
 * `id` es el de §MKT.H.14 (E1-E7); una ecuación del contrato puede dar varias filas (E3: cuatro puertas × cuatro columnas).
 */
export interface MarketingEquation {
  id: 'E1' | 'E2' | 'E3' | 'E4' | 'E5' | 'E6' | 'E7';
  kind: 'sum' | 'identity';
  left: EquationTerm;
  right: readonly EquationTerm[];
}

const at = (table: string, key: string, column: string): EquationTerm => ({ table, row: { key }, column });
const allOf = (table: string, column: string): EquationTerm => ({ table, row: 'all', column });
/** Puertas de b2 (`first_utm_medium` → etiqueta de fila). */
export const B2_DOORS: Readonly<Record<string, string>> = { bio: 'Bio', story: 'Story', paid: 'Promoción', dm: 'Mensaje directo' };
const B_COLUMNS = ['pedidos', 'mxnPedidos', 'solicitudes', 'mxnOfertado'] as const;
/** Fila única de g1 (también su clave de coherencia mes↔semanas). */
export const G1_ROW = 'Pedidos con primer origen utm_medium=paid';
/** Fila de dm de b3 (un mensaje directo no tiene pieza). */
export const B3_DM_ROW = 'Mensaje directo (dm)';

/** E1-E7 de §MKT.H.14. ⛔ T (mes = Σ semanas) no está aquí: la cubre R2 y solo la mide la prueba 3. */
export const MARKETING_EQUATIONS: readonly MarketingEquation[] = [
  { id: 'E1', kind: 'identity', left: at('a1', 'Periodo actual', 'pedidos'), right: [at('a5', 'Compras (BD)', 'n')] },
  { id: 'E1', kind: 'identity', left: at('a1', 'Periodo actual', 'pedidos'), right: [at('f3', 'Pedidos pagados del periodo', 'pedidos')] },
  { id: 'E1', kind: 'sum', left: at('a1', 'Periodo actual', 'pedidos'), right: [allOf('c7', 'pedidos')] },
  { id: 'E2', kind: 'sum', left: at('f3', 'Con origen registrado (first_utm_source)', 'pedidos'), right: [allOf('b1', 'pedidos')] },
  ...Object.entries(B2_DOORS).flatMap(([medium, door]) =>
    B_COLUMNS.map((column): MarketingEquation => ({ id: 'E3', kind: 'sum', left: at('b2', door, column), right: [{ table: 'b1', row: { keySuffix: ` / ${medium}` }, column }] })),
  ),
  { id: 'E4', kind: 'identity', left: at('g1', G1_ROW, 'pedidos'), right: [at('b2', 'Promoción', 'pedidos')] },
  { id: 'E4', kind: 'identity', left: at('g1', G1_ROW, 'mxn'), right: [at('b2', 'Promoción', 'mxnPedidos')] },
  ...B_COLUMNS.map((column): MarketingEquation => ({ id: 'E5', kind: 'identity', left: at('b3', B3_DM_ROW, column), right: [at('b2', 'Mensaje directo', column)] })),
  { id: 'E6', kind: 'identity', left: at('a4', 'Google orgánico', 'sesiones'), right: [at('b4', 'Google orgánico', 'sesiones')] },
  { id: 'E6', kind: 'identity', left: at('a4', 'Asistentes de IA', 'sesiones'), right: [at('b4', 'Asistentes de IA', 'sesiones')] },
  { id: 'E6', kind: 'sum', left: at('b4', 'Asistentes de IA', 'sesiones'), right: [allOf('e3', 'sesiones')] },
  { id: 'E7', kind: 'sum', left: at('a5', 'Sesiones', 'n'), right: [allOf('a4', 'sesiones')] },
  { id: 'E7', kind: 'sum', left: at('a5', 'Sesiones', 'n'), right: [allOf('c5', 'sesiones')] },
];

/** Familias de §MKT.H.14: se calculan juntas por periodo y régimen, pida la pantalla que pida. */
export const MARKETING_FAMILIES: readonly (readonly string[])[] = [
  ['b1', 'b2', 'b3', 'g1', 'f3'],
  ['a1', 'a5', 'f3', 'c7'],
  ['a4', 'a5', 'b4', 'c5', 'e3'],
];

// ─────────────────────────── Despejable, R3b y R4 (§MKT.H.14) ───────────────────────────

/** Una celda de una tabla con dimensión de la familia, ANTES de publicar (el plan). Los totales aceptados no tienen celdas. */
export interface FamilyCell {
  table: string;
  key: string;
  /** Componente (b1-b3: `pedidos`/`solicitudes`; tabla de una parte: su columna de conteo). Se oculta entero. */
  part: string;
  column: string;
  /** Valor que se publicaría si queda visible (R3b elige la de menor valor). */
  value: number | null;
  hidden: boolean;
  /** `0 < sujetos < 5` del componente: lo que R3b protege. */
  small: boolean;
}
export type FamilyCellId = string;
export const familyCellId = (c: Pick<FamilyCell, 'table' | 'key' | 'column'>): FamilyCellId => `${c.table}\u0000${c.key}\u0000${c.column}`;

export interface FamilyPlan {
  cells: readonly FamilyCell[];
  /** Tablas de la familia que no se publican en el periodo: cada término suyo es una incógnita que nadie controla. */
  unmeasured?: readonly string[];
  /** Salida: celdas con N<5 que siguen despejables sin candidata (X1; por diseño, solo conteos). */
  x1?: readonly FamilyCellId[];
}

/** Racional exacto con `bigint` (⛔ coma flotante, §MKT.H.14 «Despejable»). */
type Q = { n: bigint; d: bigint };
const gcd = (a: bigint, b: bigint): bigint => {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y) [x, y] = [y, x % y];
  return x;
};
const q = (n: bigint, d = 1n): Q => {
  if (d < 0n) [n, d] = [-n, -d];
  const g = gcd(n, d) || 1n;
  return { n: n / g, d: d / g };
};
const sub = (a: Q, b: Q): Q => q(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Q, b: Q): Q => q(a.n * b.n, a.d * b.d);
const div = (a: Q, b: Q): Q => q(a.n * b.d, a.d * b.n);

interface Instance {
  eq: MarketingEquation;
  /** Coeficiente por incógnita (las visibles son constantes y no entran). */
  row: Map<string, bigint>;
  /** Celdas del plan que el término elige (visibles u ocultas). */
  members: FamilyCell[];
}

/** Instancia las ecuaciones sobre las celdas del plan. Una tabla sin celdas (total aceptado, fila ausente) es constante. */
function instantiate(cells: readonly FamilyCell[], equations: readonly MarketingEquation[], unmeasured: ReadonlySet<string>): Instance[] {
  const byTable = new Map<string, FamilyCell[]>();
  for (const c of cells) {
    const list = byTable.get(c.table) ?? [];
    list.push(c);
    byTable.set(c.table, list);
  }
  return equations.map((eq) => {
    const row = new Map<string, bigint>();
    const members: FamilyCell[] = [];
    const add = (t: EquationTerm, sign: bigint) => {
      if (unmeasured.has(t.table)) {
        const u = `?${t.table}\u0000${JSON.stringify(t.row)}\u0000${t.column}`;
        row.set(u, (row.get(u) ?? 0n) + sign);
        return;
      }
      const sel = t.row;
      const chosen = (byTable.get(t.table) ?? []).filter(
        (c) => c.column === t.column && (sel === 'all' ? true : 'key' in sel ? c.key === sel.key : c.key.endsWith(sel.keySuffix)),
      );
      members.push(...chosen);
      for (const c of chosen) if (c.hidden) row.set(familyCellId(c), (row.get(familyCellId(c)) ?? 0n) + sign);
    };
    add(eq.left, 1n);
    for (const t of eq.right) add(t, -1n);
    for (const [k, v] of row) if (v === 0n) row.delete(k);
    return { eq, row, members };
  });
}

/**
 * Celdas OCULTAS que el resto del periodo despeja (§MKT.H.14 «Despejable»): su vector unitario está en el espacio de filas
 * de las ecuaciones instanciadas (visibles = constantes; ocultas = incógnitas; las cotas «< 5» no entran). Forma escalonada
 * reducida con racionales `bigint`: x se despeja ⇔ es pivote y su fila no tiene ninguna otra incógnita.
 */
export function exposedCells(
  cells: readonly FamilyCell[],
  equations: readonly MarketingEquation[] = MARKETING_EQUATIONS,
  unmeasured: readonly string[] = [],
): FamilyCellId[] {
  const eqs = instantiate(cells, equations, new Set(unmeasured))
    .map((e) => e.row)
    .filter((r) => r.size > 0);
  const vars = [...new Set(eqs.flatMap((r) => [...r.keys()]))].sort();
  const col = new Map(vars.map((v, i) => [v, i]));
  const m: Q[][] = eqs.map((r) => {
    const out = vars.map(() => q(0n));
    for (const [k, v] of r) out[col.get(k)!] = q(v);
    return out;
  });
  const pivots: { row: number; col: number }[] = [];
  let r = 0;
  for (let c = 0; c < vars.length && r < m.length; c++) {
    const p = m.findIndex((row, i) => i >= r && row[c].n !== 0n);
    if (p < 0) continue;
    [m[r], m[p]] = [m[p], m[r]];
    const piv = m[r][c];
    m[r] = m[r].map((x) => div(x, piv));
    for (let i = 0; i < m.length; i++) {
      if (i === r || m[i][c].n === 0n) continue;
      const f = m[i][c];
      m[i] = m[i].map((x, j) => sub(x, mul(f, m[r][j])));
    }
    pivots.push({ row: r, col: c });
    r++;
  }
  const hiddenIds = new Set(cells.filter((c) => c.hidden).map(familyCellId));
  return pivots
    .filter(({ row, col: c }) => m[row].every((x, j) => j === c || x.n === 0n))
    .map(({ col: c }) => vars[c])
    .filter((v) => hiddenIds.has(v))
    .sort();
}

const tieBreak = (a: FamilyCell, b: FamilyCell): number =>
  a.table < b.table ? -1 : a.table > b.table ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : a.column < b.column ? -1 : a.column > b.column ? 1 : 0;

/**
 * R3b (complementaria de familia) y R4 (identidad), hasta punto fijo (solo oculta ⇒ termina). Devuelve el plan con las celdas
 * que haga falta ocultar y, en `x1`, las de N<5 que siguen despejables sin candidata.
 *  - R4: en una ecuación `identity`, si un lado está oculto, el otro también (su componente entero).
 *  - R3b: mientras una celda con N<5 sea despejable, se oculta en su sitio la visible de menor valor (≠ 0; desempate tabla,
 *    clave, columna) que comparta ecuación con ella; ⛔ nunca un total aceptado (no tienen celdas). Si sus ecuaciones no tienen
 *    visible, se busca en las de las ocultas con las que comparte ecuación (la cadena por la que se despeja) — BACKEND_NOTES.
 */
export function enforceFamily(plan: FamilyPlan, equations: readonly MarketingEquation[] = MARKETING_EQUATIONS): FamilyPlan {
  const cells = plan.cells.map((c) => ({ ...c }));
  const unmeasured = new Set(plan.unmeasured ?? []);
  const byId = new Map(cells.map((c) => [familyCellId(c), c]));
  const hidePart = (c: FamilyCell): boolean => {
    let changed = false;
    for (const x of cells) {
      if (x.table === c.table && x.key === c.key && x.part === c.part && !x.hidden) {
        x.hidden = true;
        changed = true;
      }
    }
    return changed;
  };
  let x1: FamilyCellId[] = [];
  for (let guard = 0; guard <= cells.length + 1; guard++) {
    const eqs = instantiate(cells, equations, unmeasured);
    // R4 · identidad: comparten estado.
    let changed = false;
    for (const { eq, members } of eqs) {
      if (eq.kind !== 'identity' || members.length !== 2) continue;
      const [a, b] = members;
      if (a.hidden !== b.hidden) changed = hidePart(a.hidden ? b : a) || changed;
    }
    if (changed) continue;
    // R3b · complementaria de familia.
    const exposed = exposedCells(cells, equations, [...unmeasured])
      .map((id) => byId.get(id)!)
      .filter((c) => c.small)
      .sort(tieBreak);
    const eqsOf = (id: FamilyCellId) => eqs.filter((e) => e.members.some((x) => familyCellId(x) === id));
    let hid = false;
    x1 = [];
    for (const target of exposed) {
      const seen = new Set([familyCellId(target)]);
      let frontier = [familyCellId(target)];
      let candidate: FamilyCell | undefined;
      while (frontier.length > 0 && !candidate) {
        const ring = frontier.flatMap(eqsOf).flatMap((e) => e.members);
        candidate = ring.filter((c) => !c.hidden && c.value !== null && c.value !== 0).sort((a, b) => a.value! - b.value! || tieBreak(a, b))[0];
        frontier = [...new Set(ring.filter((c) => c.hidden).map(familyCellId))].filter((id) => !seen.has(id));
        for (const id of frontier) seen.add(id);
      }
      if (candidate) {
        hidePart(candidate);
        hid = true;
        break;
      }
      x1.push(familyCellId(target));
    }
    if (!hid) break;
  }
  return { ...plan, cells, x1 };
}
