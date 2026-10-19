/**
 * 🔒 CANDADO — la pantalla del panel por SESIÓN (API_CONTRACT §MKT.G.2/.3/.4/.9; ARCHITECTURE §13.7).
 * Sin BD: el `MarketingAnalyticsService` es el REAL; Prisma y `sales-analytics` van mockeados con datos que
 * producen celdas pequeñas y supresión complementaria (si el panel tomara otro camino que `aggregates`, lo
 * que diverge se ve aquí).
 *
 * | §MKT.G.9 | Qué fija este fichero |
 * |---|---|
 * | 1 | Paridad A=B: `panel` y `aggregates` dan cuerpos iguales en profundidad, pantalla a pantalla |
 * | 6 | Catálogo: `tables[].id` de cada pantalla = MKT.G.4, en ese orden (oráculo literal, no importado de src) |
 * | 7 | Registro: cada `GET …/panel` deja UNA fila `MarketingAccessLog` con `actorUserId` y `filters.surface='panel'` |
 *
 * Y además: periodo por defecto = última semana cerrada; `from/to/day/preset`, semana abierta, dos formas o
 * `pantalla` fuera de lista ⇒ 400; `GET …/periods` solo ofrece periodos que `resolveMarketingPeriod` acepta y
 * no deja fila de registro; la línea de cobertura va en `notes` de TODA pantalla; d4b cuenta solicitudes por
 * carta con «< 5» y sin MX$.
 */
import { MarketingController } from '../src/modules/marketing/marketing.controller';
import { MarketingAnalyticsService } from '../src/modules/marketing/marketing-analytics.service';
import { MARKETING_SCREENS, resolveMarketingPeriod, type MarketingScreen } from '../src/modules/marketing/marketing-period';
import { SMALL_CELL_SENTINEL } from '../src/modules/marketing/small-cells';
import type { AggTable, ScreenPayload } from '../src/modules/marketing/marketing-aggregates.types';
import { BusinessException } from '../src/common/business.exception';
import { periodArgs, screenArgs } from './helpers/marketing-query';

// Miércoles 14-oct-2026 12:00 UTC (06:00 CDMX). Última semana cerrada = lun 5 – dom 11 oct (2026-W41).
const NOW = new Date('2026-10-14T12:00:00.000Z');

/** MKT.G.4 — CATÁLOGO NORMATIVO, copiado a mano del contrato (oráculo independiente del código). */
const CATALOGO: Record<MarketingScreen, string[]> = {
  a: ['a1', 'a2', 'a3', 'a4', 'a5'],
  b: ['b1', 'b2', 'b3', 'b4'],
  c: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'],
  d: ['d1', 'd2', 'd3', 'd4', 'd4b'],
  e: ['e1', 'e3'],
  f: ['f1', 'f3'],
  g: ['g1'],
  h: ['h1'],
};

// v1.105⟨mkt-fase2-cierre⟩ (§MKT.H.9): literal de cobertura con `MEASUREMENT_MODE=off`.
const COBERTURA = 'Cobertura: GA4 sin encender; el origen de los pedidos aún no se registra.';

const card = (name: string, number: string) => ({ name, number, set: { name: 'Set MX' } });

function salesReport() {
  const f = (orders: number, chargedCents: number) => ({
    orders,
    chargedCents,
    avgTicketCents: orders ? Math.round(chargedCents / orders) : null,
    piecesPerOrder: orders ? 2 : null,
  });
  return {
    totals: f(3, 123456),
    previousTotals: f(2, 5000),
    comparison: { orders: { diff: 1, pct: null }, chargedCents: { diff: 118456, pct: null } },
  };
}

interface Built {
  ctrl: MarketingController;
  accessLog: { record: jest.Mock };
  m: Record<string, jest.Mock>;
}

/** Controller con el `MarketingAnalyticsService` REAL y Prisma mockeado con datos que fuerzan celdas pequeñas. */
function build(): Built {
  const m: Record<string, jest.Mock> = {
    report: jest.fn().mockResolvedValue(salesReport()),
    sellRequestAggregate: jest
      .fn()
      .mockImplementation(({ where }: { where: { status?: string } }) =>
        Promise.resolve(
          where.status === 'pagada'
            ? { _count: { _all: 3 }, _sum: { payoutNetCents: 456000 } } // N<5 ⇒ «< 5» sin MX$
            : { _count: { _all: 12 }, _sum: { quotedTotalCents: 789000 } },
        ),
      ),
    // d1: A=6 visible, B=3 SOLA oculta ⇒ supresión complementaria con la siguiente más chica.
    orderItemFindMany: jest.fn().mockResolvedValue([
      ...Array.from({ length: 6 }, () => ({ unitPriceCents: 10000, inventoryItem: { cardId: 'A', card: card('Carta A', '001') } })),
      ...Array.from({ length: 7 }, () => ({ unitPriceCents: 15000, inventoryItem: { cardId: 'C', card: card('Carta C', '003') } })),
      ...Array.from({ length: 3 }, () => ({ unitPriceCents: 20000, inventoryItem: { cardId: 'B', card: card('Carta B', '002') } })),
    ]),
    inventoryItemGroupBy: jest.fn().mockResolvedValue([{ cardId: 'A', _count: { _all: 2 } }]),
    wishlistItemGroupBy: jest.fn().mockResolvedValue([
      { cardId: 'B', _count: { _all: 2 } },
      { cardId: 'C', _count: { _all: 9 } },
    ]),
    cardFindMany: jest.fn().mockResolvedValue([
      { id: 'A', ...card('Carta A', '001') },
      { id: 'B', ...card('Carta B', '002') },
      { id: 'C', ...card('Carta C', '003') },
    ]),
    quoteGroupBy: jest.fn().mockResolvedValue([{ cardId: 'A', _sum: { count: 11 } }]),
    orderFindMany: jest.fn().mockResolvedValue([]),
    // d4b: carta A en 6 solicitudes distintas (visible), carta B en 1 (oculta) — la misma solicitud con 2 líneas de A cuenta 1.
    sellRequestItemFindMany: jest.fn().mockResolvedValue([
      ...Array.from({ length: 6 }, (_, i) => ({ cardId: 'A', sellRequestId: `sr${i}`, card: card('Carta A', '001') })),
      { cardId: 'A', sellRequestId: 'sr0', card: card('Carta A', '001') },
      { cardId: 'B', sellRequestId: 'sr9', card: card('Carta B', '002') },
    ]),
    forPeriod: jest.fn().mockResolvedValue([{ date: '2026-10-06', kind: 'promocion', label: 'Promo octubre', destino: 'instagram' }]),
  };
  const prisma = {
    sellRequest: { aggregate: m.sellRequestAggregate },
    sellRequestItem: { findMany: m.sellRequestItemFindMany },
    orderItem: { findMany: m.orderItemFindMany },
    inventoryItem: { groupBy: m.inventoryItemGroupBy },
    wishlistItem: { groupBy: m.wishlistItemGroupBy },
    card: { findMany: m.cardFindMany },
    buylistQuoteDailyCount: { groupBy: m.quoteGroupBy },
    // v1.105 (§MKT.H.9): «¿el periodo tiene datos de medición?» (pedidos con consentimiento / filas del contador) ⇒ 0.
    order: { findMany: m.orderFindMany, count: jest.fn().mockResolvedValue(0) },
    marketingBannerConsentCounter: { count: jest.fn().mockResolvedValue(0) },
  } as never;
  const analytics = new MarketingAnalyticsService(prisma, { report: m.report } as never, { forPeriod: m.forPeriod } as never);
  const accessLog = { record: jest.fn().mockResolvedValue(undefined) };
  const ctrl = new MarketingController(analytics, {} as never, accessLog as never);
  return { ctrl, accessLog, m };
}

const SUPER = { id: 'u-owner', role: 'super_admin' } as const;
/** Sesión delegada: vault_operator con fila marketing_read (régimen small_cells, v1.103). */
const DELEGADA = { id: 'u-op', role: 'vault_operator' } as const;
const tokenReq = { marketingToken: { id: 'tok-1', label: 'marketing-reader' } } as never;

beforeAll(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
});
afterAll(() => {
  jest.useRealTimers();
});

describe('§MKT.G.9 (1) — paridad A=B (small_cells): panel de sesión delegada = aggregates, en profundidad', () => {
  it.each(MARKETING_SCREENS.map((s) => [s]))('pantalla %s, semana cerrada fija', async (s) => {
    const { ctrl } = build();
    const q = { pantalla: s, week: '2026-W41' };
    const viaToken = await ctrl.aggregates(tokenReq, ...screenArgs({ ...q }));
    const viaSesion = await ctrl.panel(DELEGADA, ...screenArgs({ ...q }));
    expect(viaSesion).toEqual(viaToken);
    expect(viaSesion.privacy).toBe('small_cells');
  });

  it('pantalla d, mes cerrado: también iguales (y trae celdas «< 5», la paridad no es trivial)', async () => {
    const { ctrl } = build();
    const q = { pantalla: 'd', month: '2026-09' };
    const viaToken = await ctrl.aggregates(tokenReq, ...screenArgs({ ...q }));
    const viaSesion = await ctrl.panel(DELEGADA, ...screenArgs({ ...q }));
    expect(viaSesion).toEqual(viaToken);
    expect(JSON.stringify(viaSesion)).toContain(SMALL_CELL_SENTINEL);
  });
});

describe('§MKT.G.9 (6) — catálogo de tablas de cada pantalla (MKT.G.4), en orden', () => {
  it.each(MARKETING_SCREENS.map((s) => [s]))('pantalla %s', async (s) => {
    const { ctrl } = build();
    const p = (await ctrl.panel(SUPER, ...screenArgs({ pantalla: s, week: '2026-W41' }))) as ScreenPayload;
    expect(p.tables.map((t) => t.id)).toEqual(CATALOGO[s as MarketingScreen]);
  });

  it('toda tabla NO medida trae motivo que empieza por «NO MEDIDO — », sin filas, y sin códigos internos', async () => {
    const { ctrl } = build();
    for (const s of MARKETING_SCREENS) {
      const p = (await ctrl.panel(SUPER, ...screenArgs({ pantalla: s, week: '2026-W41' }))) as ScreenPayload;
      for (const t of p.tables.filter((x: AggTable) => !x.measured)) {
        expect(t.notMeasuredReason).toMatch(/^NO MEDIDO — /);
        expect(t.rows).toEqual([]);
        // DESIGN_SYSTEM §MKT-UX P66-3 / petición 3a: ningún código interno visible en el motivo.
        expect(t.notMeasuredReason).not.toMatch(/\b(PM|PV|MKT|D-MKT)-[A-Z0-9]+\b|Fase \d/);
      }
    }
  });

  it('la línea de cobertura va en `notes` de TODA pantalla (MKT.G.4)', async () => {
    const { ctrl } = build();
    for (const s of MARKETING_SCREENS) {
      const p = (await ctrl.panel(SUPER, ...screenArgs({ pantalla: s, week: '2026-W41' }))) as ScreenPayload;
      expect(p.notes).toContain(COBERTURA);
    }
  });

  it('d4b: solicitudes enviadas por carta (distintas), N<5 ⇒ «< 5» con supresión complementaria, sin MX$', async () => {
    const { ctrl, m } = build();
    const p = (await ctrl.panel(DELEGADA, ...screenArgs({ pantalla: 'd', week: '2026-W41' }))) as ScreenPayload;
    const d4b = p.tables.find((t) => t.id === 'd4b')!;
    expect(d4b.measured).toBe(true);
    expect(d4b.source).toBe('BD');
    // Mismo criterio de «enviada» que a3: solicitud creada en el periodo.
    expect(m.sellRequestItemFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sellRequest: { createdAt: expect.objectContaining({ gte: expect.any(Date) }) } } }),
    );
    // ⛔ sin columnas de dinero.
    expect(d4b.columns.some((c) => c.kind === 'money')).toBe(false);
    const counts = d4b.rows.map((r) => r.solicitudes);
    // A=6 visible, B=1 sola oculta ⇒ supresión complementaria: ninguna celda exacta deja despejar a B.
    expect(counts).not.toContain(1);
    // (la cuenta de solicitudes DISTINTAS la fija la prueba siguiente: aquí A cae en «Otros» y no se ve)
    expect(counts.every((c) => c === SMALL_CELL_SENTINEL)).toBe(true);
  });

  it('d4b: cuenta solicitudes DISTINTAS, no líneas (la carta A va 2 veces en sr0 y cuenta 6, no 7)', async () => {
    const { ctrl, m } = build();
    m.sellRequestItemFindMany.mockResolvedValue([
      ...Array.from({ length: 6 }, (_, i) => ({ cardId: 'A', sellRequestId: `sr${i}`, card: card('Carta A', '001') })),
      { cardId: 'A', sellRequestId: 'sr0', card: card('Carta A', '001') },
      ...Array.from({ length: 8 }, (_, i) => ({ cardId: 'C', sellRequestId: `sc${i}`, card: card('Carta C', '003') })),
    ]);
    const p = (await ctrl.panel(DELEGADA, ...screenArgs({ pantalla: 'd', week: '2026-W41' }))) as ScreenPayload;
    const d4b = p.tables.find((t) => t.id === 'd4b')!;
    // Sin celdas ocultas ⇒ ambas visibles, ordenadas de más a menos solicitudes.
    expect(d4b.rows).toEqual([
      { carta: 'Carta C · Set MX 003', solicitudes: 8 },
      { carta: 'Carta A · Set MX 001', solicitudes: 6 },
    ]);
  });

  it('d4b: una sola solicitud con 1 carta ⇒ «< 5» sin MX$ (ARCHITECTURE §9 D-MKT-1)', async () => {
    const { ctrl, m } = build();
    m.sellRequestItemFindMany.mockResolvedValue([{ cardId: 'B', sellRequestId: 'sr1', card: card('Carta B', '002') }]);
    const p = (await ctrl.panel(DELEGADA, ...screenArgs({ pantalla: 'd', week: '2026-W41' }))) as ScreenPayload;
    const d4b = p.tables.find((t) => t.id === 'd4b')!;
    expect(d4b.rows).toHaveLength(1);
    expect(d4b.rows[0].solicitudes).toBe(SMALL_CELL_SENTINEL);
  });
});

describe('§MKT.G.9 (7) — registro de accesos del panel', () => {
  it.each([
    ['super_admin', SUPER, 'exact'],
    ['delegada', DELEGADA, 'small_cells'],
  ] as const)('sesión %s: UNA fila con actorUserId, tokenId null, format json, surface=panel y privacy=%s', async (_n, user, privacy) => {
    const { ctrl, accessLog } = build();
    const p = (await ctrl.panel(user, ...screenArgs({ pantalla: 'a', week: '2026-W41' }))) as ScreenPayload;
    expect(accessLog.record).toHaveBeenCalledTimes(1);
    expect(accessLog.record).toHaveBeenCalledWith({
      actorUserId: user.id,
      tokenId: null,
      screen: 'a',
      format: 'json',
      filters: { period: '2026-W41', kind: 'week', surface: 'panel', privacy },
      rowCount: p.tables.reduce((n, t) => n + t.rows.length, 0),
    });
  });
});

describe('§MKT.G.2 — periodo del panel', () => {
  it('sin periodo ⇒ la última semana cerrada (lun 5 – dom 11 oct 2026)', async () => {
    const { ctrl } = build();
    const p = (await ctrl.panel(SUPER, ...screenArgs({ pantalla: 'h' }))) as ScreenPayload;
    expect(p.period).toMatchObject({ kind: 'week', from: '2026-10-05', to: '2026-10-11' });
  });

  it.each([
    ['rango libre sin periodo', { from: '2026-10-01', to: '2026-10-07' }],
    ['día suelto sin periodo', { day: '2026-10-05' }],
    ['preset sin periodo', { preset: 'last7' }],
    ['rango libre junto a una semana', { week: '2026-W41', from: '2026-10-01' }],
    ['semana abierta', { week: '2026-W42' }],
    ['mes abierto', { month: '2026-10' }],
    ['dos formas a la vez', { week: '2026-W41', month: '2026-09' }],
  ])('%s ⇒ 400 VALIDATION_ERROR', async (_n, extra) => {
    const { ctrl, accessLog } = build();
    await expect(ctrl.panel(SUPER, ...screenArgs({ pantalla: 'a', ...extra }))).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    expect(accessLog.record).not.toHaveBeenCalled();
  });

  it('pantalla fuera de lista ⇒ 400', async () => {
    const { ctrl } = build();
    await expect(ctrl.panel(SUPER, ...screenArgs({ pantalla: 'z', week: '2026-W41' }))).rejects.toBeInstanceOf(BusinessException);
  });
});

describe('§MKT.E — weekly-excel: los parámetros prohibidos NO se ignoran en silencio (techlead D2, 2026-10-18)', () => {
  // Antes, `weeklyExcel` solo miraba week/weekStart/month: con `from=` sin semana caía a la última semana cerrada y
  // devolvía 200 con OTRO periodo del que se pidió. Ahora comparte `resolvePanelPeriod` con el panel.
  it.each([
    ['rango libre sin periodo', { from: '2026-10-01', to: '2026-10-07' }],
    ['solo from', { from: '2026-10-01' }],
    ['día suelto sin periodo', { day: '2026-10-05' }],
    ['preset sin periodo', { preset: 'last7' }],
    ['rango libre junto a una semana', { week: '2026-W41', from: '2026-10-01' }],
  ])('weekly-excel con %s ⇒ 400 VALIDATION_ERROR y sin fila de registro', async (_n, q) => {
    const { ctrl, accessLog } = build();
    const res = { setHeader: jest.fn(), send: jest.fn() };
    await expect(ctrl.weeklyExcel(SUPER, res as never, ...periodArgs(q))).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    expect(res.send).not.toHaveBeenCalled();
    expect(accessLog.record).not.toHaveBeenCalled();
  });
});

describe('§MKT.G.3 — GET …/periods', () => {
  it('26 semanas y 12 meses cerrados, desc; cada opción la acepta resolveMarketingPeriod; zona de México', () => {
    const { ctrl, accessLog } = build();
    const r = ctrl.periods();
    expect(r.timezone).toBe('America/Mexico_City');
    expect(r.closedWeeks).toHaveLength(26);
    expect(r.closedMonths).toHaveLength(12);
    expect(r.lastClosedWeek).toEqual(r.closedWeeks[0]);
    expect(r.lastClosedWeek).toEqual({ weekStart: '2026-10-05', from: '2026-10-05', to: '2026-10-11' });
    expect(r.closedMonths[0]).toEqual({ month: '2026-09', from: '2026-09-01', to: '2026-09-30' });
    for (let i = 1; i < r.closedWeeks.length; i++) expect(r.closedWeeks[i].weekStart < r.closedWeeks[i - 1].weekStart).toBe(true);
    for (const w of r.closedWeeks) {
      const p = resolveMarketingPeriod({ weekStart: w.weekStart }, NOW);
      expect({ from: p.from, to: p.to }).toEqual({ from: w.from, to: w.to });
    }
    for (const mo of r.closedMonths) {
      const p = resolveMarketingPeriod({ month: mo.month }, NOW);
      expect({ from: p.from, to: p.to }).toEqual({ from: mo.from, to: mo.to });
    }
    // Sin datos de negocio ⇒ sin fila de registro.
    expect(accessLog.record).not.toHaveBeenCalled();
  });
});
