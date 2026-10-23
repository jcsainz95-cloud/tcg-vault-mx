/**
 * test/support/disclosure-audit.ts — ORÁCULOS de población del Panel de Marketing (API_CONTRACT §MKT.H.14, MKT-TL2).
 *
 * Un oráculo dice, SIN pasar por el servicio ni por `small-cells.ts`, qué sujetos tiene una población en un rango de días de
 * un mundo de prueba. Lo usa la prueba 1 (`marketing-populations.registry.spec.ts`: toda población del registro tiene oráculo)
 * y el AUDITOR DE CRUCES de abajo (prueba 3, `marketing-cross-table.audit.spec.ts`, MKT-TL2 b/c).
 * ⛔ No importa `small-cells.ts`, `exposedCells`, `enforceFamily` ni el servicio: es la segunda implementación, independiente, de
 * «qué cuenta cada tabla» y de «qué se despeja».
 */
import type { PopulationId } from '../../src/modules/marketing/marketing-populations';

/** Mediodía CDMX = 18:00 UTC; los rangos del oráculo son días civiles CDMX `YYYY-MM-DD`, ambos inclusive. */
export interface AuditRange {
  from: string;
  to: string;
}

export interface AuditOrder {
  id: string;
  settledAt: Date | null;
  status: string;
  firstUtmSource: string | null;
  firstUtmMedium: string | null;
  firstUtmContent: string | null;
  measurementConsentAnalytics: boolean | null;
  totalCents: number;
  /** c7 (prueba 3): `vault` ⇒ «Recogida en persona»; si no, el estado de la dirección. */
  fulfillmentMode?: 'ship' | 'vault';
  state?: string | null;
}
export interface AuditRequest {
  id: string;
  createdAt: Date;
  status: string;
  paidAt: Date | null;
  firstUtmSource: string | null;
  firstUtmMedium: string | null;
  firstUtmContent: string | null;
  quotedTotalCents?: number;
  payoutNetCents?: number;
}
export interface AuditWish {
  cardId: string;
  userId: string;
  createdAt: Date;
}
/** Filas que el doble de GA4/Search Console devuelve por consulta: la unidad de la fuente es el sujeto. */
export interface AuditExternalRow {
  key: string;
  units: number;
}

export interface AuditWorld {
  orders: AuditOrder[];
  requests: AuditRequest[];
  wishes: AuditWish[];
  /** Cartas con piezas `listed` de plataforma HOY (las de WISH son las que NO están aquí). */
  listedCardIds: Set<string>;
  ga4: Partial<Record<'sources' | 'funnel' | 'pages' | 'devices' | 'items' | 'aiReferrals', AuditExternalRow[]>>;
  sc: AuditExternalRow[];
  /** Sesiones de GA4 por día (prueba 3): el fixture declara a qué fila de a4/b4 va cada una (la fuente de verdad del caso). */
  sessions?: AuditSession[];
}
export interface AuditSession {
  day: string;
  source: string;
  medium: string;
  channel: string;
  sessions: number;
  a4: string;
  b4: string | null;
  device: string;
  browser: string;
  landing: string;
}

/** Un sujeto de una población: su id y, para fuentes externas, cuántas unidades representa la fila. */
export interface AuditSubject {
  id: string;
  units: number;
}

const SOLD = new Set(['settled', 'refunded', 'chargeback']);
/** Día civil CDMX (UTC−6, sin horario de verano desde 2022) de un instante. */
const mxDay = (d: Date): string => new Date(d.getTime() - 6 * 3600_000).toISOString().slice(0, 10);
const within = (d: Date | null, r: AuditRange): boolean => d !== null && mxDay(d) >= r.from && mxDay(d) <= r.to;

const paid = (w: AuditWorld, r: AuditRange) => w.orders.filter((o) => SOLD.has(o.status) && within(o.settledAt, r));
const req = (w: AuditWorld, r: AuditRange) => w.requests.filter((s) => within(s.createdAt, r));
const one = (id: string): AuditSubject => ({ id, units: 1 });
const ext = (rows: AuditExternalRow[] | undefined): AuditSubject[] => (rows ?? []).map((x) => ({ id: x.key, units: x.units }));

/** Un oráculo por población del registro (`MARKETING_POPULATIONS`). La prueba 1 exige que no falte ninguno. */
export const POPULATION_ORACLES: Record<PopulationId, (w: AuditWorld, r: AuditRange) => AuditSubject[]> = {
  PAID: (w, r) => paid(w, r).map((o) => one(o.id)),
  PAID_ORIGIN: (w, r) => paid(w, r).filter((o) => o.firstUtmSource !== null).map((o) => one(o.id)),
  REQ: (w, r) => req(w, r).map((s) => one(s.id)),
  REQ_ORIGIN: (w, r) => req(w, r).filter((s) => s.firstUtmSource !== null).map((s) => one(s.id)),
  REQ_PAID: (w, r) => w.requests.filter((s) => s.status === 'pagada' && within(s.paidAt, r)).map((s) => one(s.id)),
  // Sujeto = USUARIO (no alta): un usuario con 4 acabados de la misma carta es una persona.
  WISH: (w, r) => {
    const users = new Set(w.wishes.filter((x) => within(x.createdAt, r) && !w.listedCardIds.has(x.cardId)).map((x) => `${x.cardId}|${x.userId}`));
    return [...users].map(one);
  },
  'GA4:sources': (w) => ext(w.ga4.sources),
  'GA4:funnel': (w) => ext(w.ga4.funnel),
  'GA4:pages': (w) => ext(w.ga4.pages),
  'GA4:devices': (w) => ext(w.ga4.devices),
  'GA4:items': (w) => ext(w.ga4.items),
  'GA4:aiReferrals': (w) => ext(w.ga4.aiReferrals),
  SC: (w) => ext(w.sc),
};

// ═════════════════════════════ Auditor de cruces (prueba 3, §MKT.H.14; MKT-TL2 b/c) ═════════════════════════════
//
// Con el payload PUBLICADO de todas las pantallas de un periodo y el mundo de prueba (la verdad), dice qué celda de una
// persona queda a la vista o se despeja cruzando tablas:
//   D1 · conteo visible cuyo oráculo es 0 < N < 5;  D2 · MX$ visible de un componente con el conteo oculto;
//   A1 · celda (conteo) con N < 5 despejable fuera de X1;  A2 · MX$ con N < 5 despejable (⛔ nunca X1).
// Despejable: incógnitas = celdas no publicadas como número; la celda se despeja ⇔ rango(A) = rango(A sin su columna) + 1
// (el criterio de rango; el servicio usa forma escalonada: dos caminos distintos para el mismo hecho). Enteros `bigint`.

/** Centinelas y fila agrupada, literales del contrato (§MKT.G.5, §MKT.H.14). */
export const AUDIT_HIDDEN_VALUES: ReadonlySet<unknown> = new Set(['< 5', 'oculta']);
export const AUDIT_OTROS = 'Otros (< 5 c/u)';

export type AuditRowSel = { key: string } | { keySuffix: string } | 'all';
export interface AuditTerm {
  table: string;
  row: AuditRowSel;
  column: string;
}
export interface AuditEquation {
  id: string;
  kind: 'sum' | 'identity';
  left: AuditTerm;
  right: readonly AuditTerm[];
}

/** Lo publicado de una tabla, tal cual sale de `screen()`. */
export interface AuditPublishedTable {
  id: string;
  measured: boolean;
  rows: Record<string, unknown>[];
}
export interface AuditPeriod {
  label: string;
  range: AuditRange;
  tables: AuditPublishedTable[];
}
export interface AuditFinding {
  rule: 'D1' | 'D2' | 'A1' | 'A2';
  period: string;
  table: string;
  key: string;
  column: string;
}
export interface AuditReport {
  findings: AuditFinding[];
  /** Conteos con N<5 que se despejan aun ocultando TODA celda con dimensión del periodo ≠ 0 (X1, por diseño). */
  x1: string[];
}

type PartsN = Record<string, number>;
interface AuditTableSpec {
  keyCol: string;
  /** componente → columnas (la primera es el conteo). */
  parts: Record<string, readonly string[]>;
  /** Filas que son totales aceptados (no se auditan como dimensión). */
  acceptedRows?: readonly string[];
  /** Sujetos por (fila, componente), desde el mundo. */
  oracle: (w: AuditWorld, r: AuditRange) => Map<string, PartsN>;
}

/** Totales aceptados (constantes en las ecuaciones): §MKT.H.14 «Total aceptado». */
export const AUDIT_ACCEPTED_TABLES: ReadonlySet<string> = new Set(['a1', 'a2', 'a5', 'f3']);

const DOORS: Record<string, string> = { bio: 'Bio', story: 'Story', paid: 'Promoción', dm: 'Mensaje directo' };
const B_PARTS = { pedidos: ['pedidos', 'mxnPedidos'], solicitudes: ['solicitudes', 'mxnOfertado'] } as const;

function bOracle(keyOf: (s: string, m: string | null, c: string | null) => string | null) {
  return (w: AuditWorld, r: AuditRange): Map<string, PartsN> => {
    const out = new Map<string, PartsN>();
    const bump = (k: string | null, part: 'pedidos' | 'solicitudes') => {
      if (k === null) return;
      const e = out.get(k) ?? { pedidos: 0, solicitudes: 0 };
      e[part] += 1;
      out.set(k, e);
    };
    for (const o of paid(w, r)) if (o.firstUtmSource !== null) bump(keyOf(o.firstUtmSource, o.firstUtmMedium, o.firstUtmContent), 'pedidos');
    for (const s of req(w, r)) if (s.firstUtmSource !== null) bump(keyOf(s.firstUtmSource, s.firstUtmMedium, s.firstUtmContent), 'solicitudes');
    return out;
  };
}
const sessionsIn = (w: AuditWorld, r: AuditRange) => (w.sessions ?? []).filter((x) => x.day >= r.from && x.day <= r.to);
function sessionOracle(keyOf: (x: AuditSession) => string | null, always: readonly string[] = []) {
  return (w: AuditWorld, r: AuditRange): Map<string, PartsN> => {
    const out = new Map<string, PartsN>(always.map((k) => [k, { sesiones: 0 }]));
    for (const x of sessionsIn(w, r)) {
      const k = keyOf(x);
      if (k === null) continue;
      const e = out.get(k) ?? { sesiones: 0 };
      e.sesiones += x.sessions;
      out.set(k, e);
    }
    return out;
  };
}

/** Las tablas con dimensión que la prueba 3 audita, con su oráculo (segunda implementación de «qué cuenta cada fila»). */
export const AUDIT_TABLES: Readonly<Record<string, AuditTableSpec>> = {
  b1: { keyCol: 'origen', parts: B_PARTS, oracle: bOracle((s, m) => `${s} / ${m ?? '—'}`) },
  b2: { keyCol: 'puerta', parts: B_PARTS, oracle: bOracle((_s, m) => (m !== null && DOORS[m] ? DOORS[m] : null)) },
  b3: { keyCol: 'pieza', parts: B_PARTS, oracle: bOracle((_s, m, c) => (m === 'dm' ? 'Mensaje directo (dm)' : c)) },
  g1: {
    keyCol: 'concepto',
    parts: { pedidos: ['pedidos', 'mxn'] },
    oracle: (w, r) =>
      new Map([['Pedidos con primer origen utm_medium=paid', { pedidos: paid(w, r).filter((o) => o.firstUtmSource !== null && o.firstUtmMedium === 'paid').length }]]),
  },
  c7: {
    keyCol: 'estado',
    parts: { pedidos: ['pedidos'] },
    oracle: (w, r) => {
      const byState = new Map<string, number>();
      let pickup = 0;
      for (const o of paid(w, r)) {
        if (o.fulfillmentMode === 'vault') pickup += 1;
        else byState.set(o.state || 'Sin estado', (byState.get(o.state || 'Sin estado') ?? 0) + 1);
      }
      const out = new Map<string, PartsN>();
      let rest = 0;
      for (const [k, n] of byState) (n >= 5 ? out.set(k, { pedidos: n }) : (rest += n));
      if (rest > 0) out.set('Otros estados', { pedidos: rest });
      if (pickup > 0) out.set('Recogida en persona', { pedidos: pickup });
      return out;
    },
  },
  a3: {
    keyCol: 'concepto',
    parts: { n: ['n', 'mxn'] },
    acceptedRows: ['Solicitudes enviadas (generate_lead)'],
    oracle: (w, r) => new Map([['Ofertas aceptadas / pagadas', { n: w.requests.filter((s) => s.status === 'pagada' && within(s.paidAt, r)).length }]]),
  },
  a4: { keyCol: 'grupo', parts: { sesiones: ['sesiones'] }, oracle: sessionOracle((x) => x.a4, ['Instagram orgánico', 'Instagram pagado', 'Google orgánico', 'Asistentes de IA', 'Directo/otros']) },
  b4: { keyCol: 'canal', parts: { sesiones: ['sesiones'] }, oracle: sessionOracle((x) => x.b4) },
  c5: { keyCol: 'dispositivo', parts: { sesiones: ['sesiones'] }, oracle: sessionOracle((x) => `${x.device} · ${x.browser}`) },
  e3: { keyCol: 'fuente', parts: { sesiones: ['sesiones'] }, oracle: sessionOracle((x) => (x.b4 === 'Asistentes de IA' ? `${x.source} · ${x.landing}` : null)) },
};

// ── álgebra: rango con enteros `bigint` (eliminación sin fracciones) ──

const absB = (x: bigint): bigint => (x < 0n ? -x : x);
const gcdB = (a: bigint, b: bigint): bigint => {
  let x = absB(a);
  let y = absB(b);
  while (y) [x, y] = [y, x % y];
  return x;
};

/** Rango de un sistema de filas `var → coeficiente`, ignorando la columna `skip`. */
export function auditRank(rows: readonly ReadonlyMap<string, bigint>[], skip?: string): number {
  const vars = [...new Set(rows.flatMap((r) => [...r.keys()]))].filter((v) => v !== skip);
  const m = rows.map((r) => vars.map((v) => r.get(v) ?? 0n));
  let rank = 0;
  for (let c = 0; c < vars.length && rank < m.length; c++) {
    const p = m.findIndex((row, i) => i >= rank && row[c] !== 0n);
    if (p < 0) continue;
    [m[rank], m[p]] = [m[p], m[rank]];
    for (let i = rank + 1; i < m.length; i++) {
      if (m[i][c] === 0n) continue;
      const a = m[rank][c];
      const b = m[i][c];
      let row = m[i].map((x, j) => x * a - m[rank][j] * b);
      const g = row.reduce((acc, x) => gcdB(acc, x), 0n);
      if (g > 1n) row = row.map((x) => x / g);
      m[i] = row;
    }
    rank++;
  }
  return rank;
}

/** ¿El sistema fija el valor de `v`? Solo sobre la componente conexa de `v` (mismo resultado, menos trabajo). */
export function auditDetermined(rows: readonly ReadonlyMap<string, bigint>[], v: string): boolean {
  const seen = new Set([v]);
  const picked = new Set<number>();
  let frontier = [v];
  while (frontier.length) {
    const next: string[] = [];
    rows.forEach((r, i) => {
      if (picked.has(i) || !frontier.some((x) => r.has(x))) return;
      picked.add(i);
      for (const k of r.keys()) if (!seen.has(k)) (seen.add(k), next.push(k));
    });
    frontier = next;
  }
  const sub = [...picked].map((i) => rows[i]);
  if (!sub.some((r) => r.has(v))) return false;
  return auditRank(sub) === auditRank(sub, v) + 1;
}

const isNum = (x: unknown): x is number => typeof x === 'number';

/** El auditor. `monthOfWeeks`: añade T (mes = Σ semanas) entre `periods[month]` y `periods[weeks]`. */
export function auditDisclosure(
  world: AuditWorld,
  periods: readonly AuditPeriod[],
  equations: readonly AuditEquation[],
  opts: { monthOfWeeks?: { month: string; weeks: readonly string[] } } = {},
): AuditReport {
  interface Ctx {
    p: AuditPeriod;
    pub: Map<string, AuditPublishedTable>;
    oracle: Map<string, Map<string, PartsN>>;
  }
  const ctxs = new Map<string, Ctx>();
  for (const p of periods) {
    const pub = new Map<string, AuditPublishedTable>();
    for (const t of p.tables) if (!pub.has(t.id)) pub.set(t.id, t);
    const oracle = new Map<string, Map<string, PartsN>>();
    for (const [id, spec] of Object.entries(AUDIT_TABLES)) oracle.set(id, spec.oracle(world, p.range));
    ctxs.set(p.label, { p, pub, oracle });
  }
  const measured = (c: Ctx, t: string) => c.pub.get(t)?.measured === true;
  const rowOf = (c: Ctx, t: string, key: string) => c.pub.get(t)?.rows.find((r) => r[AUDIT_TABLES[t].keyCol] === key);
  const v = (c: Ctx, t: string, key: string, col: string) => `${c.p.label}|${t}|${key}|${col}`;
  /** Incógnitas de UNA celda (vacío ⇒ constante: publicada como número, o fila inexistente ⇒ 0). */
  const cell = (c: Ctx, t: string, key: string, col: string, allUnknown: boolean): string[] => {
    if (AUDIT_ACCEPTED_TABLES.has(t) || !AUDIT_TABLES[t]) return [];
    if (!measured(c, t)) return [`?${c.p.label}|${t}|${key}|${col}`];
    const row = rowOf(c, t, key);
    // En «ciego» (X1) toda celda que se PUEDE ocultar es incógnita; un 0 publicado no (R1/R3: nunca se oculta un 0).
    if (row) return isNum(row[col]) && (!allUnknown || row[col] === 0) ? [] : [v(c, t, key, col)];
    return c.oracle.get(t)?.has(key) ? [v(c, t, key, col)] : [];
  };
  const keysOf = (c: Ctx, t: string): string[] => {
    const pubKeys = (c.pub.get(t)?.rows ?? []).map((r) => String(r[AUDIT_TABLES[t].keyCol]));
    const members = [...(c.oracle.get(t)?.keys() ?? [])].filter((k) => !pubKeys.includes(k));
    return [...pubKeys, ...members.filter(() => pubKeys.includes(AUDIT_OTROS))];
  };
  const term = (c: Ctx, tm: AuditTerm, allUnknown: boolean): string[] => {
    if (AUDIT_ACCEPTED_TABLES.has(tm.table) || !AUDIT_TABLES[tm.table]) return [];
    if (!measured(c, tm.table)) return [`?${c.p.label}|${tm.table}|${JSON.stringify(tm.row)}|${tm.column}`];
    if (tm.row !== 'all' && 'key' in tm.row) return cell(c, tm.table, tm.row.key, tm.column, allUnknown);
    const pubKeys = (c.pub.get(tm.table)?.rows ?? []).map((r) => String(r[AUDIT_TABLES[tm.table].keyCol]));
    const keys = tm.row === 'all' ? pubKeys : keysOf(c, tm.table).filter((k) => k.endsWith((tm.row as { keySuffix: string }).keySuffix));
    return keys.flatMap((k) => cell(c, tm.table, k, tm.column, allUnknown));
  };
  const system = (allUnknown: boolean): Map<string, bigint>[] => {
    const rows: Map<string, bigint>[] = [];
    const push = (plus: string[], minus: string[]) => {
      const r = new Map<string, bigint>();
      for (const x of plus) r.set(x, (r.get(x) ?? 0n) + 1n);
      for (const x of minus) r.set(x, (r.get(x) ?? 0n) - 1n);
      for (const [k, n] of r) if (n === 0n) r.delete(k);
      if (r.size) rows.push(r);
    };
    for (const c of ctxs.values()) {
      for (const eq of equations) push(term(c, eq.left, allUnknown), eq.right.flatMap((t) => term(c, t, allUnknown)));
      // «Otros (< 5 c/u)» = Σ de las filas del oráculo que no se publican.
      for (const [t, spec] of Object.entries(AUDIT_TABLES)) {
        if (!measured(c, t) || !rowOf(c, t, AUDIT_OTROS)) continue;
        const members = keysOf(c, t).filter((k) => !rowOf(c, t, k));
        for (const col of Object.values(spec.parts).flat()) push(cell(c, t, AUDIT_OTROS, col, allUnknown), members.flatMap((k) => cell(c, t, k, col, allUnknown)));
      }
    }
    const mw = opts.monthOfWeeks;
    if (mw) {
      const month = ctxs.get(mw.month)!;
      const weeks = mw.weeks.map((w) => ctxs.get(w)!);
      for (const [t, spec] of Object.entries(AUDIT_TABLES)) {
        if (![month, ...weeks].every((c) => measured(c, t))) continue;
        for (const k of month.oracle.get(t)!.keys()) {
          for (const col of Object.values(spec.parts).flat()) push(cell(month, t, k, col, allUnknown), weeks.flatMap((w) => cell(w, t, k, col, allUnknown)));
        }
      }
    }
    return rows;
  };
  const normal = system(false);
  const blind = system(true);
  const findings: AuditFinding[] = [];
  const x1: string[] = [];
  for (const c of ctxs.values()) {
    for (const [t, spec] of Object.entries(AUDIT_TABLES)) {
      if (!measured(c, t)) continue;
      for (const [key, ns] of c.oracle.get(t)!) {
        if (spec.acceptedRows?.includes(key)) continue;
        for (const [part, cols] of Object.entries(spec.parts)) {
          const n = ns[part] ?? 0;
          if (!(n > 0 && n < 5)) continue;
          const row = rowOf(c, t, key);
          for (const [i, col] of cols.entries()) {
            const at = { period: c.p.label, table: t, key, column: col };
            if (row && isNum(row[col])) {
              if (i === 0) findings.push({ rule: 'D1', ...at });
              else if (!isNum(row[cols[0]])) findings.push({ rule: 'D2', ...at });
              continue;
            }
            const u = cell(c, t, key, col, false);
            if (u.length !== 1 || !auditDetermined(normal, u[0])) continue;
            if (i === 0 && auditDetermined(blind, u[0])) x1.push(u[0]);
            else findings.push({ rule: i === 0 ? 'A1' : 'A2', ...at });
          }
        }
      }
    }
  }
  return { findings, x1 };
}
