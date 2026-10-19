/**
 * 🔒💰 CANDADO SEC-MKT-1 — prueba 2 de API_CONTRACT §MKT.H.14 (R0, R1; v1.107). Celdas pequeñas POR COMPONENTE y POR SUJETO.
 *
 * Servicio real (`MarketingAnalyticsService.screen`, régimen `small_cells`) sobre un Prisma doble EN MEMORIA que filtra por las
 * mismas condiciones que la consulta real (periodo, estado, `firstUtmSource IS NOT NULL`, `firstUtmMedium`). Sin red, sin BD.
 * Deliberadamente NO importa nada nuevo de `small-cells.ts`: así la prueba compila sobre `bfd91ab2` y allí sale roja POR SU
 * MOTIVO (la sonda de seguridad), no por un import que falta.
 *
 *  1. Sonda literal de seguridad (2026-W41, `instagram/paid/pieza-x`, 1 pedido de $12,345.67 + 4 solicitudes) ⇒ ninguna celda
 *     de b1-b3 ni g1 vale 12345.67; `pedidos` es «< 5» (y las cuatro celdas de la fila, ocultas).
 *  2. 1 pedido + 7 solicitudes por $700 ⇒ `{pedidos:'< 5', mxnPedidos:'oculta', solicitudes:7, mxnOfertado:700}`.
 *  3. d1: UN pedido de 5 piezas de la misma carta ⇒ «< 5» y `mxn:'oculta'` (cuenta pedidos, no piezas).
 *  4. d3: 2 usuarios × 3 acabados (6 altas) ⇒ «< 5» (cuenta usuarios, no altas).
 *  5. g1 con la base de b1-b3 (`firstUtmSource IS NOT NULL`): g1 ≡ b2[Promoción].
 *  6. R0 en un mes (febrero 2027): una fila «oculta» no cae entre dos visibles; y, en TODA tabla de este fichero, ninguna
 *     celda oculta de la primera columna de conteo va antes de una visible.
 *
 * Deterministas (sin reloj ni azar): N=1 por caso.
 */
import { MarketingAnalyticsService } from '../src/modules/marketing/marketing-analytics.service';
import { SMALL_CELL_HIDDEN, SMALL_CELL_SENTINEL, type CellPrivacy } from '../src/modules/marketing/small-cells';
import type { MarketingPeriod, MarketingScreen } from '../src/modules/marketing/marketing-period';
import type { AggTable, Cell, ScreenPayload } from '../src/modules/marketing/marketing-aggregates.types';

// ──────────────────────────────── Datos y doble de Prisma ────────────────────────────────

interface Order {
  id: string;
  settledAt: Date;
  status: 'settled';
  firstUtmSource: string | null;
  firstUtmMedium: string | null;
  firstUtmContent: string | null;
  totalCents: number;
  /** Piezas del pedido: una línea por pieza (carta suelta). */
  pieces: { cardId: string; cents: number }[];
}
interface Req {
  createdAt: Date;
  firstUtmSource: string | null;
  firstUtmMedium: string | null;
  firstUtmContent: string | null;
  quotedTotalCents: number;
}
interface Wish {
  cardId: string;
  userId: string;
  createdAt: Date;
}
interface World {
  orders: Order[];
  requests: Req[];
  wishes: Wish[];
}

type Range = { gte: Date; lt: Date };
const inRange = (d: Date, r: Range | undefined) => !r || (d >= r.gte && d < r.lt);
const notNullOk = (v: unknown, w: unknown) => w === undefined || (typeof w === 'object' && w !== null && 'not' in w ? v !== null : v === w);
const cardOf = (id: string) => ({ name: `Carta ${id}`, number: '001', set: { name: 'Set MX' } });

function prismaOf(world: World) {
  type OrderWhere = { settledAt?: Range; status?: { in: string[] }; firstUtmSource?: unknown; firstUtmMedium?: unknown };
  const orderMatch = (o: Order, w: OrderWhere = {}) =>
    inRange(o.settledAt, w.settledAt) &&
    (!w.status || w.status.in.includes(o.status)) &&
    notNullOk(o.firstUtmSource, w.firstUtmSource) &&
    notNullOk(o.firstUtmMedium, w.firstUtmMedium);
  return {
    order: {
      findMany: jest.fn(async ({ where }: { where: OrderWhere }) => world.orders.filter((o) => orderMatch(o, where))),
      aggregate: jest.fn(async ({ where }: { where: OrderWhere }) => {
        const xs = world.orders.filter((o) => orderMatch(o, where));
        return { _count: { _all: xs.length }, _sum: { totalCents: xs.reduce((n, o) => n + o.totalCents, 0) } };
      }),
      count: jest.fn(async ({ where }: { where: OrderWhere }) => world.orders.filter((o) => orderMatch(o, where)).length),
    },
    sellRequest: {
      findMany: jest.fn(async ({ where }: { where: { createdAt?: Range; firstUtmSource?: unknown } }) =>
        world.requests.filter((r) => inRange(r.createdAt, where.createdAt) && notNullOk(r.firstUtmSource, where.firstUtmSource)),
      ),
      aggregate: jest.fn(async () => ({ _count: { _all: 0 }, _sum: { quotedTotalCents: 0, payoutNetCents: 0 } })),
    },
    sellRequestItem: { findMany: jest.fn(async () => []) },
    orderItem: {
      findMany: jest.fn(async ({ where }: { where: { order: OrderWhere } }) =>
        world.orders
          .filter((o) => orderMatch(o, where.order))
          .flatMap((o) => o.pieces.map((p) => ({ orderId: o.id, unitPriceCents: p.cents, inventoryItem: { cardId: p.cardId, card: cardOf(p.cardId) } }))),
      ),
    },
    // Stock 0 hoy en todas las cartas ⇒ toda carta deseada es «agotada con demanda».
    inventoryItem: { groupBy: jest.fn(async () => []), findMany: jest.fn(async () => []) },
    card: { findMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => ({ id, ...cardOf(id) }))) },
    // groupBy genérico por las llaves que pida la consulta (`by`), con `_count._all`.
    wishlistItem: {
      groupBy: jest.fn(async ({ by, where }: { by: (keyof Wish)[]; where: { createdAt?: Range } }) => {
        const acc = new Map<string, Record<string, unknown> & { _count: { _all: number } }>();
        for (const w of world.wishes.filter((x) => inRange(x.createdAt, where.createdAt))) {
          const k = by.map((b) => String(w[b])).join('|');
          const e = acc.get(k) ?? { ...Object.fromEntries(by.map((b) => [b, w[b]])), _count: { _all: 0 } };
          e._count._all += 1;
          acc.set(k, e);
        }
        return [...acc.values()];
      }),
    },
    buylistQuoteDailyCount: { groupBy: jest.fn(async () => []) },
    marketingBannerConsentCounter: { count: jest.fn(async () => 0) },
  };
}

function service(world: World) {
  const svc = new MarketingAnalyticsService(
    prismaOf(world) as never,
    { report: jest.fn() } as never,
    { forPeriod: jest.fn(async () => []) } as never,
    // Medición encendida (b1-b3 y g1 se calculan); sin fuentes externas ⇒ las tablas GA4 salen «NO MEDIDO».
    { mode: 'on' } as never,
  );
  return (screen: MarketingScreen, period: MarketingPeriod, privacy: CellPrivacy = 'small_cells') => svc.screen(screen, period, NOW, privacy);
}

// ──────────────────────────────── Periodos y fábricas ────────────────────────────────

const NOW = new Date('2027-03-10T12:00:00.000Z');
/** 2026-W41 (lunes 5 a domingo 11 de octubre), la semana de la sonda de seguridad. */
const W41: MarketingPeriod = { kind: 'week', from: '2026-10-05', to: '2026-10-11', prev: { from: '2026-09-28', to: '2026-10-04' }, label: '2026-W41' };
/** Febrero 2027: empieza en lunes 1 y acaba en domingo 28 ⇒ el mes es exactamente sus cuatro semanas. */
const FEB27: MarketingPeriod = { kind: 'month', from: '2027-02-01', to: '2027-02-28', prev: { from: '2027-01-01', to: '2027-01-31' }, label: '2027-02' };
/** Mediodía CDMX de un día (18:00 UTC). */
const at = (ymd: string) => new Date(`${ymd}T18:00:00.000Z`);

let seq = 0;
const order = (o: Partial<Order> & { settledAt: Date }): Order => ({
  id: `o-${++seq}`,
  status: 'settled',
  firstUtmSource: null,
  firstUtmMedium: null,
  firstUtmContent: null,
  totalCents: 10000,
  pieces: [],
  ...o,
});
const utm = (source: string, medium: string, content: string | null = null) => ({ firstUtmSource: source, firstUtmMedium: medium, firstUtmContent: content });
const request = (createdAt: Date, quotedTotalCents: number, u: ReturnType<typeof utm>): Req => ({ createdAt, quotedTotalCents, ...u });
const empty = (): World => ({ orders: [], requests: [], wishes: [] });

const tableOf = (p: ScreenPayload, id: string): AggTable => {
  const t = p.tables.find((x) => x.id === id);
  if (!t) throw new Error(`tabla ${id} ausente`);
  return t;
};
const rowOf = (t: AggTable, col: string, key: string) => {
  const r = t.rows.find((x) => x[col] === key);
  if (!r) throw new Error(`${t.id}: fila «${key}» ausente (${JSON.stringify(t.rows)})`);
  return r;
};
const isHidden = (c: Cell | undefined) => c === SMALL_CELL_SENTINEL || c === SMALL_CELL_HIDDEN;

/**
 * R0: en la PRIMERA columna de conteo de la tabla, ninguna celda oculta va antes de una visible (una fila oculta colocada
 * por su N real entre un 9 y un 7 diría que vale entre 7 y 9). Se aplica a TODA tabla medida de cada payload del fichero.
 */
function expectHiddenAfterVisible(p: ScreenPayload): void {
  for (const t of p.tables.filter((x) => x.measured)) {
    const col = t.columns.find((c) => c.kind === 'count');
    if (!col) continue;
    const cells = t.rows.map((r) => r[col.key]);
    const firstHidden = cells.findIndex(isHidden);
    const lastVisible = cells.map((c) => !isHidden(c)).lastIndexOf(true);
    expect({ table: t.id, column: col.key, order: cells, hiddenBeforeVisible: firstHidden >= 0 && firstHidden < lastVisible }).toEqual({
      table: t.id,
      column: col.key,
      order: cells,
      hiddenBeforeVisible: false,
    });
  }
}

// ──────────────────────────────── Casos ────────────────────────────────

describe('SEC-MKT-1 · b1-b3 y g1: umbral por componente (§MKT.H.14 R1)', () => {
  it('sonda literal de seguridad: 1 pedido de $12,345.67 + 4 solicitudes (2026-W41, instagram/paid/pieza-x) ⇒ las cuatro celdas ocultas y el monto en ningún sitio', async () => {
    const w = empty();
    const u = utm('instagram', 'paid', 'pieza-x');
    w.orders.push(order({ settledAt: at('2026-10-07'), totalCents: 1234567, ...u }));
    for (let i = 0; i < 4; i++) w.requests.push(request(at('2026-10-08'), 10000, u));
    const screen = service(w);
    const b = await screen('b', W41);
    const g = await screen('g', W41);

    const hidden = { pedidos: SMALL_CELL_SENTINEL, mxnPedidos: SMALL_CELL_HIDDEN, solicitudes: SMALL_CELL_SENTINEL, mxnOfertado: SMALL_CELL_HIDDEN };
    expect(rowOf(tableOf(b, 'b1'), 'origen', 'instagram / paid')).toEqual({ origen: 'instagram / paid', ...hidden });
    expect(rowOf(tableOf(b, 'b2'), 'puerta', 'Promoción')).toEqual({ puerta: 'Promoción', ...hidden });
    expect(rowOf(tableOf(b, 'b3'), 'pieza', 'pieza-x')).toEqual({ pieza: 'pieza-x', ...hidden });
    expect(tableOf(g, 'g1').rows).toEqual([{ concepto: expect.any(String), pedidos: SMALL_CELL_SENTINEL, mxn: SMALL_CELL_HIDDEN }]);

    // El monto exacto del pedido no viaja en NINGUNA celda de b1-b3 ni g1.
    const cells = [...['b1', 'b2', 'b3'].map((id) => tableOf(b, id)), tableOf(g, 'g1')].flatMap((t) => t.rows.flatMap((r) => Object.values(r)));
    expect(cells).not.toContain(12345.67);
    expectHiddenAfterVisible(b);
    expectHiddenAfterVisible(g);
  });

  it('1 pedido + 7 solicitudes por $700 ⇒ pedidos «< 5» sin su MX$; solicitudes 7 y $700 visibles (una parte no tapa la otra)', async () => {
    const w = empty();
    const u = utm('instagram', 'paid', 'pieza-x');
    w.orders.push(order({ settledAt: at('2026-10-07'), totalCents: 1234567, ...u }));
    for (let i = 0; i < 7; i++) w.requests.push(request(at('2026-10-08'), 10000, u));
    const b = await service(w)('b', W41);
    const expected = { pedidos: SMALL_CELL_SENTINEL, mxnPedidos: SMALL_CELL_HIDDEN, solicitudes: 7, mxnOfertado: 700 };
    expect(rowOf(tableOf(b, 'b1'), 'origen', 'instagram / paid')).toEqual({ origen: 'instagram / paid', ...expected });
    expect(rowOf(tableOf(b, 'b2'), 'puerta', 'Promoción')).toEqual({ puerta: 'Promoción', ...expected });
    expect(rowOf(tableOf(b, 'b3'), 'pieza', 'pieza-x')).toEqual({ pieza: 'pieza-x', ...expected });
    expect(tableOf(b, 'b1').notes).toContain('Pedidos y solicitudes se ocultan por separado: menos de 5 ⇒ «< 5» sin su MX$.');
    expectHiddenAfterVisible(b);
  });

  it('el dueño (exact) ve las cifras reales de la misma fila', async () => {
    const w = empty();
    const u = utm('instagram', 'paid', 'pieza-x');
    w.orders.push(order({ settledAt: at('2026-10-07'), totalCents: 1234567, ...u }));
    for (let i = 0; i < 7; i++) w.requests.push(request(at('2026-10-08'), 10000, u));
    const b = await service(w)('b', W41, 'exact' as CellPrivacy);
    expect(rowOf(tableOf(b, 'b1'), 'origen', 'instagram / paid')).toEqual({ origen: 'instagram / paid', pedidos: 1, mxnPedidos: 12345.67, solicitudes: 7, mxnOfertado: 700 });
  });

  it('g1 usa la base de b1-b3 (`firstUtmSource IS NOT NULL`): un pedido `paid` sin origen no entra, y g1 ≡ b2[Promoción]', async () => {
    const w = empty();
    for (let i = 0; i < 5; i++) w.orders.push(order({ settledAt: at('2026-10-06'), totalCents: 20000, ...utm('instagram', 'paid', 'pieza-y') }));
    w.orders.push(order({ settledAt: at('2026-10-06'), totalCents: 99900, firstUtmSource: null, firstUtmMedium: 'paid' }));
    const screen = service(w);
    const g1 = tableOf(await screen('g', W41), 'g1').rows[0];
    const promo = rowOf(tableOf(await screen('b', W41), 'b2'), 'puerta', 'Promoción');
    expect({ pedidos: g1.pedidos, mxn: g1.mxn }).toEqual({ pedidos: 5, mxn: 1000 });
    expect({ pedidos: g1.pedidos, mxn: g1.mxn }).toEqual({ pedidos: promo.pedidos, mxn: promo.mxnPedidos });
  });
});

describe('SEC-MKT-1 · d1/d3 cuentan sujetos distintos (§MKT.H.14 R1)', () => {
  it('d1: UN pedido de 5 piezas de la misma carta ⇒ «< 5» y MX$ «oculta» (pedidos, no piezas); 6 pedidos ⇒ 6 visibles', async () => {
    const w = empty();
    // X: 1 pedido × 5 piezas. Y: 2 pedidos × 1 pieza. Q: 1 pedido × 1 pieza. Z: 6 pedidos × 1 pieza. Y y Q ocultas con
    // cualquier regla ⇒ ninguna complementaria agrupa a X: la regla vieja (piezas) la publica con su MX$ y aquí se ve.
    w.orders.push(order({ settledAt: at('2026-10-07'), pieces: Array.from({ length: 5 }, () => ({ cardId: 'X', cents: 77700 })) }));
    for (let i = 0; i < 2; i++) w.orders.push(order({ settledAt: at('2026-10-07'), pieces: [{ cardId: 'Y', cents: 1000 }] }));
    w.orders.push(order({ settledAt: at('2026-10-07'), pieces: [{ cardId: 'Q', cents: 1000 }] }));
    for (let i = 0; i < 6; i++) w.orders.push(order({ settledAt: at('2026-10-07'), pieces: [{ cardId: 'Z', cents: 1000 }] }));
    const d = await service(w)('d', W41);
    const d1 = tableOf(d, 'd1');
    expect(rowOf(d1, 'carta', 'Carta X · Set MX 001')).toMatchObject({ unidadesVendidas: SMALL_CELL_SENTINEL, mxn: SMALL_CELL_HIDDEN, aLaVentaHoy: 0 });
    expect(rowOf(d1, 'carta', 'Carta Z · Set MX 001')).toMatchObject({ unidadesVendidas: 6, mxn: 60 });
    expect(d1.rows.flatMap((r) => Object.values(r))).not.toContain(3885);
    expectHiddenAfterVisible(d);
  });

  it('d3: 2 usuarios × 3 acabados (6 altas) ⇒ «< 5» (usuarios, no altas); 5 usuarios ⇒ sus altas visibles', async () => {
    const w = empty();
    const wish = (cardId: string, userId: string) => w.wishes.push({ cardId, userId, createdAt: at('2026-10-09') });
    for (const u of ['u1', 'u2']) for (let f = 0; f < 3; f++) wish('W', u); // 6 altas, 2 usuarios
    wish('V', 'u9'); // 1 alta, 1 usuario ⇒ segunda oculta ⇒ sin «Otros»
    for (const u of ['a', 'b', 'c', 'd', 'e']) wish('U', u); // 5 usuarios
    const d = await service(w)('d', W41);
    const d3 = tableOf(d, 'd3');
    expect(rowOf(d3, 'carta', 'Carta W · Set MX 001')).toMatchObject({ listaDeseos: SMALL_CELL_SENTINEL });
    expect(rowOf(d3, 'carta', 'Carta U · Set MX 001')).toMatchObject({ listaDeseos: 5 });
    expectHiddenAfterVisible(d);
  });
});

describe('R0 · el orden de filas usa solo valores publicados (§MKT.H.14)', () => {
  it('mes (febrero 2027): K [3,6,6,6] sale «oculta» y NO cae entre A (30) y L (7)', async () => {
    const w = empty();
    const weekDays = ['2027-02-03', '2027-02-10', '2027-02-17', '2027-02-24'];
    const put = (source: string, perWeek: number[]) =>
      perWeek.forEach((n, i) => {
        for (let k = 0; k < n; k++) w.orders.push(order({ settledAt: at(weekDays[i]), totalCents: 10000, ...utm(source, 'bio') }));
      });
    put('a', [8, 8, 7, 7]); // 30 ⇒ visible en el mes
    put('k', [3, 6, 6, 6]); // 21 ⇒ «< 5» en la semana 1 ⇒ «oculta» en el mes (MKT.G.10)
    put('l', [0, 7, 0, 0]); // 7 ⇒ visible
    put('j', [2, 0, 0, 0]); // 2 ⇒ «< 5» (segunda oculta ⇒ sin complementaria)
    const b = await service(w)('b', FEB27);
    const b1 = tableOf(b, 'b1');
    expect(b1.rows.map((r) => [r.origen, r.pedidos])).toEqual([
      ['a / bio', 30],
      ['l / bio', 7],
      ['j / bio', SMALL_CELL_SENTINEL],
      ['k / bio', SMALL_CELL_HIDDEN],
    ]);
    expect(rowOf(b1, 'origen', 'k / bio').mxnPedidos).toBe(SMALL_CELL_HIDDEN);
    expectHiddenAfterVisible(b);
  });
});
