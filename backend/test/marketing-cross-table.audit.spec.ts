/**
 * 🔒💰 CANDADO MKT-TL2 (b, c) — prueba 3 de API_CONTRACT §MKT.H.14 (v1.107): AUDITOR DE CRUCES ENTRE TABLAS.
 *
 * Servicio real (`MarketingAnalyticsService.screen`, `small_cells`, medición `on`) sobre un Prisma de dobles sembrado y un
 * doble de GA4, TODAS las pantallas del periodo. El auditor (`test/support/disclosure-audit.ts`) es propio: ⛔ no importa
 * `small-cells.ts` ni `exposedCells`/`enforceFamily`; declara E1-E7 aquí, LITERALES, y exige que `MARKETING_EQUATIONS` sea igual.
 * Rojo si (D1) un conteo visible tiene oráculo 0<N<5; (D2) un MX$ visible es de un componente oculto; (A1) una celda con N<5 se
 * despeja fuera de X1; (A2) un MX$ con N<5 se despeja.
 *
 * Casos con nombre del contrato + 200 semillas fijas (componentes 1-4 y 5-9, 1-6 orígenes, las cuatro puertas). Determinista
 * (PRNG con semilla, sin reloj real): N=1 por caso. El registro se lee con `import *` para que esta prueba compile también sobre
 * `01440e56` (sin `MARKETING_EQUATIONS`) y allí salga roja POR SU MOTIVO (A1/A2 del caso E3), no por un import.
 *
 * v1.109 (MKT-MEDIR-CS): E8/E9 (b5 ↔ b6, sin total aceptado) y la familia {b5, b6}. Toda auditoría corre DOS veces: la normal y la
 * de X3 (el contador público del torneo ⇒ `b5.torneo` se trata como conocido); en las dos, nada de N<5 a la vista ni despejable.
 * El auditor sabe además que una fila de b5 (un día) vale lo mismo en la semana y en el mes que la contienen (R4 entre periodos).
 */
import * as registry from '../src/modules/marketing/marketing-populations';
import { MarketingAnalyticsService } from '../src/modules/marketing/marketing-analytics.service';
import type { MarketingPeriod, MarketingScreen } from '../src/modules/marketing/marketing-period';
import type { Ga4ReportSpec } from '../src/modules/marketing/marketing-external-sources';
import {
  auditDetermined,
  auditDisclosure,
  type AuditCsRow,
  type AuditEquation,
  type AuditOrder,
  type AuditPeriod,
  type AuditRequest,
  type AuditSession,
  type AuditTerm,
  type AuditWorld,
} from './support/disclosure-audit';

// ──────────────────────────────── E1-E7, literales (§MKT.H.14 «Ecuaciones») ────────────────────────────────

const at = (table: string, key: string, column: string): AuditTerm => ({ table, row: { key }, column });
const all = (table: string, column: string): AuditTerm => ({ table, row: 'all', column });
const B_COLS = ['pedidos', 'mxnPedidos', 'solicitudes', 'mxnOfertado'];
const G1 = 'Pedidos con primer origen utm_medium=paid';
const EQUATIONS: AuditEquation[] = [
  // E1 a1[actual].pedidos = a5[Compras (BD)] = f3[Pedidos pagados] = Σ c7
  { id: 'E1', kind: 'identity', left: at('a1', 'Periodo actual', 'pedidos'), right: [at('a5', 'Compras (BD)', 'n')] },
  { id: 'E1', kind: 'identity', left: at('a1', 'Periodo actual', 'pedidos'), right: [at('f3', 'Pedidos pagados del periodo', 'pedidos')] },
  { id: 'E1', kind: 'sum', left: at('a1', 'Periodo actual', 'pedidos'), right: [all('c7', 'pedidos')] },
  // E2 f3[Con origen registrado] = Σ b1.pedidos
  { id: 'E2', kind: 'sum', left: at('f3', 'Con origen registrado (first_utm_source)', 'pedidos'), right: [all('b1', 'pedidos')] },
  // E3 por puerta m, en las cuatro columnas de b: b2[m] = Σ b1[<source> / m]
  ...[
    ['bio', 'Bio'],
    ['story', 'Story'],
    ['paid', 'Promoción'],
    ['dm', 'Mensaje directo'],
  ].flatMap(([m, door]) =>
    B_COLS.map((column): AuditEquation => ({ id: 'E3', kind: 'sum', left: at('b2', door, column), right: [{ table: 'b1', row: { keySuffix: ` / ${m}` }, column }] })),
  ),
  // E4 g1 ≡ b2[Promoción] (mxn ≡ mxnPedidos)
  { id: 'E4', kind: 'identity', left: at('g1', G1, 'pedidos'), right: [at('b2', 'Promoción', 'pedidos')] },
  { id: 'E4', kind: 'identity', left: at('g1', G1, 'mxn'), right: [at('b2', 'Promoción', 'mxnPedidos')] },
  // E5 b3[Mensaje directo (dm)] ≡ b2[Mensaje directo]
  ...B_COLS.map((column): AuditEquation => ({ id: 'E5', kind: 'identity', left: at('b3', 'Mensaje directo (dm)', column), right: [at('b2', 'Mensaje directo', column)] })),
  // E6 a4[g] ≡ b4[g] (Google orgánico, Asistentes de IA); b4[Asistentes de IA] = Σ e3
  { id: 'E6', kind: 'identity', left: at('a4', 'Google orgánico', 'sesiones'), right: [at('b4', 'Google orgánico', 'sesiones')] },
  { id: 'E6', kind: 'identity', left: at('a4', 'Asistentes de IA', 'sesiones'), right: [at('b4', 'Asistentes de IA', 'sesiones')] },
  { id: 'E6', kind: 'sum', left: at('b4', 'Asistentes de IA', 'sesiones'), right: [all('e3', 'sesiones')] },
  // E7 a5[Sesiones] = Σ a4 = Σ c5
  { id: 'E7', kind: 'sum', left: at('a5', 'Sesiones', 'n'), right: [all('a4', 'sesiones')] },
  { id: 'E7', kind: 'sum', left: at('a5', 'Sesiones', 'n'), right: [all('c5', 'sesiones')] },
  // E8 Σ b5.avisame = Σ b6.avisame · E9 Σ b5.torneo = Σ b6.torneo (v1.109; sin total aceptado: la suma no se publica)
  { id: 'E8', kind: 'sum', left: all('b5', 'avisame'), right: [all('b6', 'avisame')] },
  { id: 'E9', kind: 'sum', left: all('b5', 'torneo'), right: [all('b6', 'torneo')] },
];
/** X3 (§MKT.H.14): el contador público del torneo es una serie exacta ⇒ el auditor trata `b5.torneo` como conocido. */
const X3 = { known: [{ table: 'b5', column: 'torneo' }] } as const;

// ──────────────────────────────── Mundo, dobles y periodos ────────────────────────────────

const NOW = new Date('2027-03-10T12:00:00.000Z');
const W41: MarketingPeriod = { kind: 'week', from: '2026-10-05', to: '2026-10-11', prev: { from: '2026-09-28', to: '2026-10-04' }, label: '2026-W41' };
const FEB27: MarketingPeriod = { kind: 'month', from: '2027-02-01', to: '2027-02-28', prev: { from: '2027-01-01', to: '2027-01-31' }, label: '2027-02' };
const FEB_WEEKS: MarketingPeriod[] = [1, 8, 15, 22].map((d, i) => {
  const from = `2027-02-${String(d).padStart(2, '0')}`;
  const to = `2027-02-${String(d + 6).padStart(2, '0')}`;
  return { kind: 'week', from, to, prev: { from, to }, label: `2027-W0${5 + i}` };
});
const SCREENS: MarketingScreen[] = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
/** Mediodía CDMX = 18:00 UTC. */
const at18 = (ymd: string) => new Date(`${ymd}T18:00:00.000Z`);

type Where = Record<string, unknown>;
const matches = (o: Record<string, unknown>, where: Where = {}): boolean =>
  Object.entries(where).every(([k, cond]) => {
    const v = o[k];
    if (cond === undefined) return true;
    if (cond === null) return v === null || v === undefined;
    if (typeof cond === 'object' && !(cond instanceof Date)) {
      const c = cond as { gte?: Date; lt?: Date; lte?: Date; in?: unknown[]; not?: unknown };
      if ('in' in c) return c.in!.includes(v);
      if ('not' in c) return c.not === null ? v !== null && v !== undefined : v !== c.not;
      const d = v as Date | null;
      if (!d) return false;
      return (!c.gte || d >= c.gte) && (!c.lt || d < c.lt) && (!c.lte || d <= c.lte);
    }
    return v === cond;
  });

function prismaOf(w: AuditWorld) {
  const orders = () => w.orders.map((o) => ({ ...o, shippingAddressSnapshot: { state: o.state ?? null } }) as unknown as Record<string, unknown>);
  const requests = () => w.requests as unknown as Record<string, unknown>[];
  return {
    order: {
      findMany: jest.fn(async ({ where }: { where: Where }) => orders().filter((o) => matches(o, where))),
      count: jest.fn(async ({ where }: { where: Where }) => orders().filter((o) => matches(o, where)).length),
      aggregate: jest.fn(async ({ where }: { where: Where }) => {
        const xs = orders().filter((o) => matches(o, where));
        return { _count: { _all: xs.length }, _sum: { totalCents: xs.reduce((n, o) => n + (o.totalCents as number), 0) } };
      }),
    },
    sellRequest: {
      findMany: jest.fn(async ({ where }: { where: Where }) => requests().filter((r) => matches(r, where))),
      aggregate: jest.fn(async ({ where }: { where: Where }) => {
        const xs = requests().filter((r) => matches(r, where));
        const sum = (k: string) => xs.reduce((n, r) => n + ((r[k] as number) ?? 0), 0);
        return { _count: { _all: xs.length }, _sum: { quotedTotalCents: sum('quotedTotalCents'), payoutNetCents: sum('payoutNetCents') } };
      }),
    },
    sellRequestItem: { findMany: jest.fn(async () => []) },
    orderItem: { findMany: jest.fn(async () => []) },
    inventoryItem: { groupBy: jest.fn(async () => []), findMany: jest.fn(async () => []) },
    card: { findMany: jest.fn(async () => []) },
    sealedProduct: { findMany: jest.fn(async () => []) },
    wishlistItem: { groupBy: jest.fn(async () => []) },
    buylistQuoteDailyCount: { groupBy: jest.fn(async () => []) },
    marketingBannerConsentCounter: { count: jest.fn(async () => 0), groupBy: jest.fn(async () => []) },
    cardShowLead: { findMany: jest.fn(async ({ where }: { where: Where }) => ((w.leads ?? []) as unknown as Record<string, unknown>[]).filter((x) => matches(x, where))) },
    cardShowPlayerSignup: { findMany: jest.fn(async ({ where }: { where: Where }) => ((w.signups ?? []) as unknown as Record<string, unknown>[]).filter((x) => matches(x, where))) },
  };
}

/** Doble de GA4: suma las sesiones del rango por las dimensiones que pide la consulta (la fuente es `w.sessions`). */
function ga4Of(w: AuditWorld) {
  const rows = (keys: (x: AuditSession) => string[], from: string, to: string, only?: (x: AuditSession) => boolean) => {
    const acc = new Map<string, { dims: string[]; n: number }>();
    for (const x of (w.sessions ?? []).filter((s) => s.day >= from && s.day <= to && (!only || only(s)))) {
      const dims = keys(x);
      const e = acc.get(dims.join('\u0000')) ?? { dims, n: 0 };
      e.n += x.sessions;
      acc.set(dims.join('\u0000'), e);
    }
    return [...acc.values()].map((e) => ({ dimensions: e.dims, metrics: [e.n] }));
  };
  return {
    ga4Configured: () => true,
    searchConsoleConfigured: () => false,
    ga4Report: jest.fn(async (spec: Ga4ReportSpec, from: string, to: string) => {
      const total = (w.sessions ?? []).filter((s) => s.day >= from && s.day <= to).reduce((n, s) => n + s.sessions, 0);
      switch (spec.dimensions.join(',')) {
        case 'sessionSource,sessionMedium,sessionDefaultChannelGroup':
          return { ok: true, rows: rows((x) => [x.source, x.medium, x.channel], from, to) };
        case 'deviceCategory,browser':
          return { ok: true, rows: rows((x) => [x.device, x.browser], from, to) };
        case 'sessionSource,landingPage': {
          const list = (spec.inList?.values ?? []) as readonly string[];
          return { ok: true, rows: rows((x) => [x.source, x.landing], from, to, (x) => list.includes(x.source)) };
        }
        case '':
          return { ok: true, rows: [{ dimensions: [], metrics: [total] }] };
        case 'eventName':
          return { ok: true, rows: [{ dimensions: ['view_item'], metrics: [total] }] };
        default:
          return { ok: true, rows: [] };
      }
    }),
  };
}

function serviceOf(w: AuditWorld) {
  const prisma = prismaOf(w);
  const sales = {
    report: jest.fn(async ({ from, to }: { from: string; to: string }) => {
      const n = w.orders.filter((o) => o.settledAt && o.settledAt >= at18(from) && o.settledAt <= at18(to)).length;
      const t = { orders: n, chargedCents: 0, avgTicketCents: 0, piecesPerOrder: 1 };
      return { totals: t, previousTotals: t, comparison: { orders: { diff: 0, pct: null }, chargedCents: { diff: 0, pct: null } } };
    }),
  };
  return new MarketingAnalyticsService(prisma as never, sales as never, { forPeriod: jest.fn(async () => []) } as never, { mode: 'on' } as never, ga4Of(w) as never);
}

async function published(w: AuditWorld, period: MarketingPeriod): Promise<AuditPeriod> {
  const svc = serviceOf(w);
  const tables = [];
  for (const s of SCREENS) tables.push(...(await svc.screen(s, period, NOW, 'small_cells')).tables);
  return { label: period.label, range: { from: period.from, to: period.to }, tables };
}

/** Auditoría normal + la de X3, juntas: hallazgos de las dos; `x1` de la normal y `x1x3` de la de X3. */
function auditBoth(w: AuditWorld, ps: AuditPeriod[], opts: Parameters<typeof auditDisclosure>[3] = {}) {
  const normal = auditDisclosure(w, ps, EQUATIONS, opts);
  const x3 = auditDisclosure(w, ps, EQUATIONS, { ...opts, ...X3 });
  return { findings: [...normal.findings, ...x3.findings.map((f) => ({ ...f, rule: `${f.rule}·X3` }))], x1: normal.x1, x1x3: x3.x1 };
}

async function audit(w: AuditWorld, period: MarketingPeriod) {
  return auditBoth(w, [await published(w, period)]);
}

// ── fábricas del mundo ──

let seq = 0;
const world = (): AuditWorld => ({ orders: [], requests: [], wishes: [], listedCardIds: new Set(), ga4: {}, sc: [], sessions: [], leads: [], signups: [] });
type CsUtm = [string | null, string | null, string | null, string | null];
/** `n` preregistros confirmados el `day` (mediodía CDMX), cada uno de un buzón nuevo salvo que se pase `box`. */
function cs(w: AuditWorld, kind: 'leads' | 'signups', n: number, day: string, utm: CsUtm = [null, null, null, null], box?: string, status = 'new'): void {
  for (let i = 0; i < n; i++) {
    const row: AuditCsRow = {
      id: `cs${++seq}`,
      mailboxHmac: box ?? `box${seq}`,
      confirmedAt: status === 'pending' ? null : at18(day),
      status,
      utmSource: utm[0],
      utmMedium: utm[1],
      utmCampaign: utm[2],
      utmContent: utm[3],
    };
    w[kind]!.push(row);
  }
}
function orders(w: AuditWorld, n: number, day: string, utm: [string, string, string | null] | null, cents = 10000, extra: Partial<AuditOrder> = {}): void {
  for (let i = 0; i < n; i++) {
    w.orders.push({
      id: `o${++seq}`,
      settledAt: at18(day),
      status: 'settled',
      firstUtmSource: utm ? utm[0] : null,
      firstUtmMedium: utm ? utm[1] : null,
      firstUtmContent: utm ? utm[2] : null,
      measurementConsentAnalytics: utm ? true : null,
      totalCents: cents,
      fulfillmentMode: 'ship',
      state: 'Jalisco',
      ...extra,
    });
  }
}
function requests(w: AuditWorld, n: number, day: string, utm: [string, string, string | null] | null, cents = 10000, extra: Partial<AuditRequest> = {}): void {
  for (let i = 0; i < n; i++) {
    w.requests.push({
      id: `r${++seq}`,
      createdAt: at18(day),
      status: 'enviada',
      paidAt: null,
      firstUtmSource: utm ? utm[0] : null,
      firstUtmMedium: utm ? utm[1] : null,
      firstUtmContent: utm ? utm[2] : null,
      quotedTotalCents: cents,
      payoutNetCents: 0,
      ...extra,
    });
  }
}

/** Fuentes de GA4 del fixture, con la fila de a4/b4 que les toca (§MKT.H.9; sin `medium=paid` en Google ni IA). */
const GA4_SOURCES: Omit<AuditSession, 'day' | 'sessions' | 'device' | 'browser' | 'landing'>[] = [
  { source: 'instagram', medium: 'bio', channel: 'Organic Social', a4: 'Instagram orgánico', b4: null },
  { source: 'instagram', medium: 'paid', channel: 'Paid Social', a4: 'Instagram pagado', b4: null },
  { source: 'google', medium: 'organic', channel: 'Organic Search', a4: 'Google orgánico', b4: 'Google orgánico' },
  { source: 'chatgpt.com', medium: 'referral', channel: 'Referral', a4: 'Asistentes de IA', b4: 'Asistentes de IA' },
  { source: 'claude.ai', medium: 'referral', channel: 'Referral', a4: 'Asistentes de IA', b4: 'Asistentes de IA' },
  { source: '(direct)', medium: '(none)', channel: 'Direct', a4: 'Directo/otros', b4: 'Directo' },
  { source: 'foro.mx', medium: 'referral', channel: 'Referral', a4: 'Directo/otros', b4: 'Referencia: foro.mx' },
];
const DEVICES: [string, string][] = [
  ['mobile', 'Instagram'],
  ['mobile', 'Safari'],
  ['desktop', 'Chrome'],
];
const LANDINGS = ['/es', '/es/como-funciona'];
function sessions(w: AuditWorld, day: string, src: number, n: number, device = 0, landing = 0): void {
  if (n > 0) w.sessions!.push({ day, ...GA4_SOURCES[src], sessions: n, device: DEVICES[device][0], browser: DEVICES[device][1], landing: LANDINGS[landing] });
}

const expectClean = (r: { findings: unknown[] }) => expect(r.findings).toEqual([]);

// ──────────────────────────────── Pruebas ────────────────────────────────

describe('MKT-TL2 · el registro de ecuaciones es el del contrato', () => {
  it('MARKETING_EQUATIONS = E1-E9 declaradas aquí, literal (mismo conjunto)', () => {
    const eqs = (registry as Record<string, unknown>).MARKETING_EQUATIONS as unknown[] | undefined;
    const canon = (xs: unknown[]) => xs.map((x) => JSON.stringify(x)).sort();
    expect(canon(eqs ?? [])).toEqual(canon(EQUATIONS));
  });
});

describe('MKT-TL2 · el auditor muerde (sistemas a mano con exposición conocida)', () => {
  const sys = (...rows: Record<string, number>[]) => rows.map((r) => new Map(Object.entries(r).map(([k, n]) => [k, BigInt(n)])));
  it('1) x + y = c con y visible (no entra) ⇒ x despejada', () => {
    expect(auditDetermined(sys({ x: 1 }), 'x')).toBe(true);
  });
  it('2) x + y = c y x + y + z = d ⇒ z despejada; x e y no', () => {
    const s = sys({ x: 1, y: 1 }, { x: 1, y: 1, z: 1 });
    expect([auditDetermined(s, 'x'), auditDetermined(s, 'y'), auditDetermined(s, 'z')]).toEqual([false, false, true]);
  });
  it('3) cadena: a − b = 0, b − c = 0, c + d = k, d = const ⇒ a despejada; sin «d = const», no', () => {
    expect(auditDetermined(sys({ a: 1, b: -1 }, { b: 1, c: -1 }, { c: 1 }), 'a')).toBe(true);
    expect(auditDetermined(sys({ a: 1, b: -1 }, { b: 1, c: -1 }, { c: 1, d: 1 }), 'a')).toBe(false);
  });
});

describe('MKT-TL2 · casos con nombre (§MKT.H.14 prueba 3)', () => {
  it('«SEC-MKT-1»: 1 pedido de $12,345.67 + 4 solicitudes (2026-W41, instagram/paid/pieza-x) ⇒ limpio', async () => {
    const w = world();
    orders(w, 1, '2026-10-07', ['instagram', 'paid', 'pieza-x'], 1234567);
    requests(w, 4, '2026-10-08', ['instagram', 'paid', 'pieza-x']);
    expectClean(await audit(w, W41));
  });

  it('«b2 7 = b1 6 + 1, pareja fuera de la puerta»: 6 instagram/paid $100 + 1 facebook/paid $7,777.77 + 5 google/organic + 9 tiktok/bio ⇒ limpio', async () => {
    const w = world();
    orders(w, 6, '2026-10-07', ['instagram', 'paid', null], 10000);
    orders(w, 1, '2026-10-07', ['facebook', 'paid', null], 777777);
    orders(w, 5, '2026-10-07', ['google', 'organic', null], 10000);
    orders(w, 9, '2026-10-07', ['tiktok', 'bio', null], 10000);
    const p = await published(w, W41);
    expectClean(auditDisclosure(w, [p], EQUATIONS));
    // Lo que seguridad reprodujo: b2[Promoción] − b1[instagram / paid] no puede quedar con los dos números a la vista.
    const t = (id: string) => p.tables.find((x) => x.id === id)!;
    const promo = t('b2').rows.find((r) => r.puerta === 'Promoción')!;
    const ig = t('b1').rows.find((r) => r.origen === 'instagram / paid')!;
    expect(typeof promo.mxnPedidos === 'number' && typeof ig.mxnPedidos === 'number').toBe(false);
  });

  it('«g1 pareja en b2»: la pareja de R3a en b2 es Promoción ⇒ g1 (su idéntica, E4) se oculta con ella (R4)', async () => {
    const w = world();
    orders(w, 2, '2026-10-07', ['tiktok', 'story', null]);
    orders(w, 5, '2026-10-07', ['instagram', 'paid', null]);
    orders(w, 9, '2026-10-07', ['google', 'bio', null]);
    const p = await published(w, W41);
    expectClean(auditDisclosure(w, [p], EQUATIONS));
    const g1 = p.tables.find((x) => x.id === 'g1')!.rows[0];
    const promo = p.tables.find((x) => x.id === 'b2')!.rows.find((r) => r.puerta === 'Promoción')!;
    expect([typeof g1.pedidos, typeof promo.pedidos]).toEqual(['string', 'string']);
  });

  it('«b3 dm ≡ b2 dm»: misma celda en dos tablas ⇒ mismo estado (R4) y limpio', async () => {
    const w = world();
    orders(w, 2, '2026-10-07', ['instagram', 'story', 'pieza-1']);
    orders(w, 5, '2026-10-07', ['instagram', 'dm', null]);
    orders(w, 9, '2026-10-07', ['instagram', 'bio', 'pieza-2']);
    const p = await published(w, W41);
    expectClean(auditDisclosure(w, [p], EQUATIONS));
    const b3 = p.tables.find((x) => x.id === 'b3')!.rows.find((r) => r.pieza === 'Mensaje directo (dm)')!;
    const b2 = p.tables.find((x) => x.id === 'b2')!.rows.find((r) => r.puerta === 'Mensaje directo')!;
    expect(B_COLS.map((c) => typeof b3[c])).toEqual(B_COLS.map((c) => typeof b2[c]));
  });

  it.each([1, 2, 3, 4])('«a3 pagadas 1..4»: %i pagadas ⇒ «< 5» sin MX$ (limpio)', async (n) => {
    const w = world();
    requests(w, n, '2026-10-06', null, 50000, { status: 'pagada', paidAt: at18('2026-10-07'), payoutNetCents: 40000 });
    const p = await published(w, W41);
    expectClean(auditDisclosure(w, [p], EQUATIONS));
    expect(p.tables.find((x) => x.id === 'a3')!.rows[1]).toMatchObject({ n: '< 5', mxn: 'oculta' });
  });

  it('«c7↔a1»: un estado chico solo se agrupa con otro (E1 con a1); con una sola fila, X1 (conteo, por diseño)', async () => {
    const w = world();
    orders(w, 9, '2027-02-03', null, 10000, { state: 'Jalisco' });
    orders(w, 6, '2027-02-10', null, 10000, { state: 'CDMX' });
    orders(w, 2, '2027-02-17', null, 10000, { state: 'Puebla' });
    orders(w, 7, '2027-02-24', null, 10000, { fulfillmentMode: 'vault' });
    expectClean(await audit(w, FEB27));
    const solo = world();
    orders(solo, 2, '2027-02-17', null, 10000, { state: 'Puebla' });
    const r = await audit(solo, FEB27);
    expectClean(r);
    expect(r.x1).toEqual(['2027-02|c7|Otros estados|pedidos']);
  });

  it('«febrero 2027 [3,6,6,6] en b1 con f3»: mes y sus cuatro semanas, con T (mes = Σ semanas) ⇒ limpio', async () => {
    const w = world();
    const days = ['2027-02-03', '2027-02-10', '2027-02-17', '2027-02-24'];
    const put = (src: string, per: number[]) => per.forEach((n, i) => orders(w, n, days[i], [src, 'bio', null]));
    put('a', [8, 8, 7, 7]);
    put('k', [3, 6, 6, 6]);
    put('l', [0, 7, 0, 0]);
    put('m', [6, 6, 6, 6]);
    const ps = [await published(w, FEB27), ...(await Promise.all(FEB_WEEKS.map((p) => published(w, p))))];
    expectClean(auditBoth(w, ps, { monthOfWeeks: { month: FEB27.label, weeks: FEB_WEEKS.map((p) => p.label) } }));
  });

  it('sesiones (E6, E7): IA chica en a4/b4 y e3, Google orgánico pareja ⇒ limpio', async () => {
    const w = world();
    const d = '2026-10-07';
    sessions(w, d, 0, 40, 0);
    sessions(w, d, 2, 6, 2);
    sessions(w, d, 3, 2, 1, 0);
    sessions(w, d, 4, 1, 1, 1);
    sessions(w, d, 5, 12, 2);
    expectClean(await audit(w, W41));
  });
});

// ──────────────────────────────── v1.109 · b5/b6 del Card Show (MKT-MEDIR-CS) ────────────────────────────────

/** Enero 2027 (vie 1 a dom 31): la primera semana que lo toca empieza el lunes 28-dic ⇒ la pareja de R3a puede caer fuera del mes. */
const JAN27: MarketingPeriod = { kind: 'month', from: '2027-01-01', to: '2027-01-31', prev: { from: '2026-12-01', to: '2026-12-31' }, label: '2027-01' };
const JAN_WEEKS: MarketingPeriod[] = ['2026-12-28', '2027-01-04', '2027-01-11', '2027-01-18', '2027-01-25'].map((from, i) => {
  const to = new Date(new Date(`${from}T00:00:00.000Z`).getTime() + 6 * 86400_000).toISOString().slice(0, 10);
  return { kind: 'week', from, to, prev: { from, to }, label: `2027-W0${i}` };
});
async function janAudit(w: AuditWorld) {
  const ps = [await published(w, JAN27), ...(await Promise.all(JAN_WEEKS.map((p) => published(w, p))))];
  return { ps, r: auditBoth(w, ps) };
}
const cellOf = (p: AuditPeriod, t: string, col: string, key: string, c: string) => p.tables.find((x) => x.id === t)!.rows.find((r) => r[col] === key)![c];

describe('MKT-MEDIR-CS · b5/b6 (§MKT.H.14 E8, E9, X3; prueba 3)', () => {
  it.each([
    ['E8', 'leads', 'avisame'],
    ['E9', 'signups', 'torneo'],
  ] as const)('«%s · b5 sola en el mes»: 2 el 2-ene (pareja el 30-dic, fuera del mes) + 8 el 12-ene ⇒ en el mes se oculta b6, no un día que la semana publica', async (_e, kind, col) => {
    const w = world();
    cs(w, kind, 6, '2026-12-30');
    cs(w, kind, 2, '2027-01-02');
    cs(w, kind, 8, '2027-01-12');
    const { ps, r } = await janAudit(w);
    expect(r.findings).toEqual([]);
    const [month] = ps;
    // El 12-ene sale igual en el mes que en su semana (R4 entre periodos); lo que tapa el 2-ene en el mes es b6.
    expect([cellOf(month, 'b5', 'dia', '2027-01-12', col), cellOf(ps[3], 'b5', 'dia', '2027-01-12', col)]).toEqual([8, 8]);
    expect(cellOf(month, 'b5', 'dia', '2027-01-02', col)).toBe('< 5');
    expect(cellOf(month, 'b6', 'utm', 'Sin UTM', col)).toBe('oculta');
  });

  it('«X3 · b6 con su pareja»: torneo A=2, B=11 y b5 conocida (contador público) ⇒ R3a oculta B en b6 y nada se despeja', async () => {
    const w = world();
    const A: CsUtm = ['instagram', 'story', 'cs', null];
    const B: CsUtm = ['facebook', 'paid', 'cs', null];
    cs(w, 'signups', 2, '2026-10-05', A);
    cs(w, 'signups', 5, '2026-10-06', B);
    cs(w, 'signups', 6, '2026-10-07', B);
    const p = await published(w, W41);
    const r = auditBoth(w, [p]);
    expect(r.findings).toEqual([]);
    expect(p.tables.find((x) => x.id === 'b6')!.rows.map((x) => [x.utm, x.torneo])).toEqual([
      ['facebook / paid / cs', 'oculta'],
      ['instagram / story / cs', '< 5'],
    ]);
  });

  it('«X3 · una sola fuente»: todo el torneo de un UTM con N<5 ⇒ se despeja del contador público aun ocultándolo todo: X1 (conteo, por diseño)', async () => {
    const w = world();
    cs(w, 'signups', 3, '2026-10-06', ['instagram', 'story', 'cs', null]);
    cs(w, 'leads', 9, '2026-10-06');
    const r = await audit(w, W41);
    expect(r.findings).toEqual([]);
    expect(r.x1x3).toEqual(['2026-W41|b6|instagram / story / cs|torneo']);
  });

  it('«buzón con dos filas»: 3 buzones × (visitor + merchant) = 6 filas ⇒ «< 5» en b5 y b6, y limpio', async () => {
    const w = world();
    for (const b of ['x', 'y', 'z']) cs(w, 'leads', 2, '2026-10-08', [null, null, null, null], `box-${b}`);
    cs(w, 'leads', 9, '2026-10-09', ['instagram', 'bio', 'cs', null]);
    const p = await published(w, W41);
    expect(auditBoth(w, [p]).findings).toEqual([]);
    expect(cellOf(p, 'b5', 'dia', '2026-10-08', 'avisame')).toBe('< 5');
    expect(cellOf(p, 'b6', 'utm', 'Sin UTM', 'avisame')).toBe('< 5');
  });
});

// ──────────────────────────────── 200 semillas fijas ────────────────────────────────

/** mulberry32: PRNG determinista. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SOURCES = ['instagram', 'facebook', 'google', 'tiktok', 'whatsapp', 'x'];
const DOORS = ['bio', 'story', 'paid', 'dm'];
const PIECES = ['pieza-1', 'pieza-2', 'pieza-3', null];

/** UTM de los preregistros sembrados: sin UTM, válidos, uno con `@` («No válido») y uno en mayúsculas. */
const CS_UTMS: CsUtm[] = [
  [null, null, null, null],
  ['instagram', 'story', 'cardshow', null],
  ['instagram', 'bio', 'cardshow', null],
  ['facebook', 'paid', 'cs-promo', 'reel-1'],
  ['instagram', 'story', 'juan@correo.com', null],
  ['WhatsApp', 'DM', null, null],
];
const W41_DAYS = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'];
function seeded(seed: number, days: readonly string[] = W41_DAYS): AuditWorld {
  const r = rng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
  /** Componente chico (1-4) o grande (5-9), o nada. */
  const n = () => (r() < 0.3 ? 0 : r() < 0.5 ? 1 + Math.floor(r() * 4) : 5 + Math.floor(r() * 5));
  const w = world();
  const sources = SOURCES.slice(0, 1 + Math.floor(r() * 6));
  for (const s of sources) {
    for (const m of DOORS) {
      if (r() < 0.4) continue;
      const no = n();
      for (let i = 0; i < no; i++) orders(w, 1, pick(days), [s, m, m === 'dm' ? null : pick(PIECES)], 100 + Math.floor(r() * 99900));
      const ns = n();
      for (let i = 0; i < ns; i++) requests(w, 1, pick(days), [s, m, m === 'dm' ? null : pick(PIECES)], 100 + Math.floor(r() * 99900));
    }
    if (r() < 0.3) orders(w, n(), pick(days), [s, 'organic', null]);
  }
  orders(w, Math.floor(r() * 6), pick(days), null);
  const paidReq = Math.floor(r() * 7);
  requests(w, paidReq, pick(days), null, 5000, { status: 'pagada', paidAt: at18(pick(days)), payoutNetCents: 4000 });
  for (let i = 0; i < GA4_SOURCES.length; i++) sessions(w, pick(days), i, n(), Math.floor(r() * DEVICES.length), Math.floor(r() * LANDINGS.length));
  // v1.109: preregistros del Card Show (al final: las semillas de antes generan el mismo mundo de pedidos y sesiones).
  for (const kind of ['leads', 'signups'] as const) {
    const nBoxes = Math.floor(r() * 16);
    for (let i = 0; i < nBoxes; i++) {
      const box = `${kind}-${seed}-${i}`;
      const rows = r() < 0.25 ? 2 : 1;
      for (let k = 0; k < rows; k++) cs(w, kind, 1, pick(days), pick(CS_UTMS), box, r() < 0.1 ? 'pending' : 'new');
    }
  }
  return w;
}

describe('MKT-TL2 · 200 semillas fijas (2026-W41)', () => {
  it('ninguna semilla deja una celda de N<5 a la vista ni despejable', async () => {
    const bad: string[] = [];
    /** Cobertura (v1.109): semillas en las que b5/b6 publican alguna celda oculta (si no, las semillas no prueban b5/b6). */
    const csHidden = { b5: 0, b6: 0, noValido: 0 };
    for (let seed = 1; seed <= 200; seed++) {
      const w = seeded(seed);
      const p = await published(w, W41);
      const r = auditBoth(w, [p]);
      for (const f of r.findings) bad.push(`semilla ${seed}: ${f.rule} ${f.table}[${f.key}].${f.column}`);
      const rows = (id: string) => p.tables.find((t) => t.id === id)!.rows;
      for (const id of ['b5', 'b6'] as const) if (rows(id).some((x) => ['< 5', 'oculta'].includes(String(x.avisame)) || ['< 5', 'oculta'].includes(String(x.torneo)))) csHidden[id] += 1;
      if (rows('b6').some((x) => x.utm === 'No válido')) csHidden.noValido += 1;
    }
    expect(bad).toEqual([]);
    expect([csHidden.b5 >= 100, csHidden.b6 >= 100, csHidden.noValido >= 50]).toEqual([true, true, true]);
  }, 300_000);
});

describe('MKT-TL2 · 40 semillas fijas en febrero 2027 (mes + sus cuatro semanas, con T)', () => {
  const FEB_DAYS = Array.from({ length: 28 }, (_, i) => `2027-02-${String(i + 1).padStart(2, '0')}`);
  it('ninguna semilla deja una celda de N<5 a la vista ni despejable entre el mes y sus semanas', async () => {
    const bad: string[] = [];
    for (let seed = 1; seed <= 40; seed++) {
      const w = seeded(1000 + seed, FEB_DAYS);
      const ps = [await published(w, FEB27), ...(await Promise.all(FEB_WEEKS.map((p) => published(w, p))))];
      const r = auditBoth(w, ps, { monthOfWeeks: { month: FEB27.label, weeks: FEB_WEEKS.map((p) => p.label) } });
      for (const f of r.findings) bad.push(`semilla ${1000 + seed}: ${f.rule} ${f.period} ${f.table}[${f.key}].${f.column}`);
    }
    expect(bad).toEqual([]);
  }, 300_000);
});
