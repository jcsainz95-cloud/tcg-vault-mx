/**
 * 🔒💰 CANDADO DE ENSAMBLAJE — `MarketingAnalyticsService` (Brief 2 §2/§3/§5; ARCHITECTURE §13.4.5/§13.5;
 * API_CONTRACT §MKT.E). Fija QUÉ ensambla el servicio del Panel, NO la paridad contra BD real (eso necesita
 * Postgres ⇒ deuda de cobertura, TECH_DEBT §MKT). Sin BD: `SalesAnalyticsService.report()`, las anotaciones y
 * las llamadas de Prisma (`aggregate`/`groupBy`/`findMany`) van mockeadas.
 *
 * Lo que fija, FAIL-FIRST (romper la delegación de a1 ⇒ el test cae):
 *  - a1/a2: delega en `sales-analytics` y PROPAGA pedidos pagados + MX$ con IVA (actual vs anterior), total SIN
 *    dimensión EXACTO (⛔ no pasa por celdas pequeñas).
 *  - a3/d1/d3/c7: aplica celdas pequeñas (N<5 ⇒ «< 5» sin MX$) donde HAY dimensión; c7 agrupa estados N<5 en
 *    «Otros estados» y «Recogida en persona» aparte, con mínimo 4 semanas.
 *  - columnas GA4/SC/atribución (a4/a5/b/e/g/f): salen «NO MEDIDO — …» con motivo, NUNCA «0».
 */
import { MarketingAnalyticsService } from '../src/modules/marketing/marketing-analytics.service';
import { SMALL_CELL_SENTINEL } from '../src/modules/marketing/small-cells';
import type { MarketingPeriod } from '../src/modules/marketing/marketing-period';
import type { AggTable } from '../src/modules/marketing/marketing-aggregates.types';
import type { SalesFigures, Delta } from '../src/modules/sales-analytics/sales-figures';
import type { SalesReportDTO } from '../src/modules/sales-analytics/sales-analytics.dto';

// ──────────────────────────────── Fixtures ────────────────────────────────

/** SalesFigures completo a partir de un parcial (solo importan los campos que el Panel lee). */
function figures(p: Partial<SalesFigures>): SalesFigures {
  return {
    orders: 0,
    chargedCents: 0,
    netSalesCents: 0,
    refunds: { count: 0, amountCents: 0, netCents: 0, byChannel: { card: { count: 0, amountCents: 0 }, spei: { count: 0, amountCents: 0 } } },
    netSalesAfterRefundsCents: 0,
    pieces: 0,
    avgTicketCents: null,
    piecesPerOrder: null,
    shipping: { chargedNetCents: 0, costNetCents: 0, costMissingCount: 0, adjustmentsCents: 0, resultNetCents: 0 },
    buylist: { paidCount: 0, paidNetCents: 0, paidWithoutPayoutCount: 0 },
    profitCents: 0,
    ...p,
  };
}

const delta = (diff: number | null, pct: number | null): Delta => ({ diff, pct });

/** Un `SalesReportDTO` controlado (solo totals/previousTotals/comparison los lee el Panel). */
function reportDto(p: { totals: SalesFigures; previousTotals: SalesFigures; comparison: Partial<SalesReportDTO['comparison']> }): SalesReportDTO {
  return {
    period: { preset: 'custom', from: '2026-10-05', to: '2026-10-11', days: 7, timezone: 'America/Mexico_City' },
    previousPeriod: { from: '2026-09-28', to: '2026-10-04' },
    groupBy: 'day',
    totals: p.totals,
    previousTotals: p.previousTotals,
    comparison: {
      orders: delta(null, null),
      chargedCents: delta(null, null),
      netSalesCents: delta(null, null),
      refundsAmountCents: delta(null, null),
      netSalesAfterRefundsCents: delta(null, null),
      avgTicketCents: delta(null, null),
      piecesPerOrder: delta(null, null),
      ...p.comparison,
    },
    rows: [],
    top: { sort: 'pieces', cards: [], sets: [], sealed: [] },
    customers: { new: 0, returning: 0, distinct: 0 },
    bestDays: { byWeekday: [], byHour: [] },
    mix: {
      byDestination: { vault: { orders: 0, chargedCents: 0 }, direct_ship: { orders: 0, chargedCents: 0 } },
      byBuyer: { account: { orders: 0, chargedCents: 0 }, guest: { orders: 0, chargedCents: 0 } },
      byProductType: {
        raw: { pieces: 0, netCents: 0 }, graded: { pieces: 0, netCents: 0 },
        sealed: { pieces: 0, netCents: 0 }, accessory: { pieces: 0, netCents: 0 },
      },
    },
  };
}

const weekPeriod: MarketingPeriod = {
  kind: 'week',
  from: '2026-10-05',
  to: '2026-10-11',
  prev: { from: '2026-09-28', to: '2026-10-04' },
  label: '2026-W41',
};

/** Mes cerrado de 30 días (≥ 4 semanas) para c7. */
const monthPeriod: MarketingPeriod = {
  kind: 'month',
  from: '2026-09-01',
  to: '2026-09-30',
  prev: { from: '2026-08-01', to: '2026-08-31' },
  label: '2026-09',
};

const NOW = new Date('2026-10-14T12:00:00.000Z');

interface Mocks {
  report: jest.Mock;
  sellRequestAggregate: jest.Mock;
  orderItemFindMany: jest.Mock;
  inventoryItemGroupBy: jest.Mock;
  wishlistItemGroupBy: jest.Mock;
  cardFindMany: jest.Mock;
  quoteGroupBy: jest.Mock;
  orderFindMany: jest.Mock;
  forPeriod: jest.Mock;
}

function build(): { svc: MarketingAnalyticsService; m: Mocks } {
  const m: Mocks = {
    report: jest.fn(),
    sellRequestAggregate: jest.fn().mockResolvedValue({ _count: { _all: 0 }, _sum: { quotedTotalCents: 0, payoutNetCents: 0 } }),
    orderItemFindMany: jest.fn().mockResolvedValue([]),
    inventoryItemGroupBy: jest.fn().mockResolvedValue([]),
    wishlistItemGroupBy: jest.fn().mockResolvedValue([]),
    cardFindMany: jest.fn().mockResolvedValue([]),
    quoteGroupBy: jest.fn().mockResolvedValue([]),
    orderFindMany: jest.fn().mockResolvedValue([]),
    forPeriod: jest.fn().mockResolvedValue([]),
  };
  const prisma = {
    sellRequest: { aggregate: m.sellRequestAggregate },
    // d4b (§MKT.G.4): solicitudes enviadas por carta; sin filas en estos casos.
    sellRequestItem: { findMany: jest.fn().mockResolvedValue([]) },
    orderItem: { findMany: m.orderItemFindMany },
    inventoryItem: { groupBy: m.inventoryItemGroupBy },
    wishlistItem: { groupBy: m.wishlistItemGroupBy },
    card: { findMany: m.cardFindMany },
    buylistQuoteDailyCount: { groupBy: m.quoteGroupBy },
    order: { findMany: m.orderFindMany },
  } as never;
  const sales = { report: m.report } as never;
  const annotations = { forPeriod: m.forPeriod } as never;
  const svc = new MarketingAnalyticsService(prisma, sales, annotations);
  return { svc, m };
}

const tableById = (tables: AggTable[], id: string): AggTable => {
  const t = tables.find((x) => x.id === id);
  if (!t) throw new Error(`tabla ${id} ausente`);
  return t;
};

// ──────────────────────────────── a1/a2: delegación + propagación ────────────────────────────────

describe('MarketingAnalyticsService — a1/a2 delega en sales-analytics y propaga MX$ exacto', () => {
  it('a1/a2: delega con {preset:custom, groupBy:day, from, to} y propaga pedidos + MX$ (actual vs anterior) SIN redondeo', async () => {
    const { svc, m } = build();
    m.report.mockResolvedValue(
      reportDto({
        totals: figures({ orders: 42, chargedCents: 123456, avgTicketCents: 2939, piecesPerOrder: 3.5 }),
        previousTotals: figures({ orders: 30, chargedCents: 90000, avgTicketCents: 3000, piecesPerOrder: 3.0 }),
        comparison: { orders: delta(12, 40), chargedCents: delta(33456, 37) },
      }),
    );

    const payload = await svc.screen('a', weekPeriod, NOW, 'small_cells');

    // a1 — delega exactamente con el periodo del Panel.
    expect(m.report).toHaveBeenCalledTimes(1);
    expect(m.report).toHaveBeenCalledWith({ preset: 'custom', from: '2026-10-05', to: '2026-10-11', groupBy: 'day' }, NOW);

    const a1 = tableById(payload.tables, 'a1');
    // Total SIN dimensión ⇒ EXACTO (⛔ no pasa por celdas pequeñas aunque orders<5 no aplica aquí).
    expect(a1.measured).toBe(true);
    expect(a1.rows[0]).toMatchObject({ periodo: 'Periodo actual', pedidos: 42, mxn: 1234.56 });
    expect(a1.rows[1]).toMatchObject({ periodo: 'Periodo anterior', pedidos: 30, mxn: 900.0 });

    const a2 = tableById(payload.tables, 'a2');
    expect(a2.rows[0]).toMatchObject({ periodo: 'Periodo actual', ticket: 29.39, piezasPorPedido: 3.5 });
    expect(a2.rows[1]).toMatchObject({ periodo: 'Periodo anterior', ticket: 30.0, piezasPorPedido: 3.0 });

    // previousPeriod se propaga del periodo del Panel (pantalla a tiene comparación).
    expect(payload.previousPeriod).toEqual({ from: '2026-09-28', to: '2026-10-04' });
  });

  it('a1: un total con pocos pedidos (N<5) sigue siendo EXACTO, no «< 5» (total sin dimensión no se suprime)', async () => {
    const { svc, m } = build();
    m.report.mockResolvedValue(
      reportDto({
        totals: figures({ orders: 3, chargedCents: 50000 }),
        previousTotals: figures({ orders: 1, chargedCents: 10000 }),
        comparison: { orders: delta(2, 200), chargedCents: delta(40000, 400) },
      }),
    );
    const payload = await svc.screen('a', weekPeriod, NOW, 'small_cells');
    const a1 = tableById(payload.tables, 'a1');
    expect(a1.rows[0]).toMatchObject({ pedidos: 3, mxn: 500.0 }); // ⛔ NO «< 5», NO null
    expect(a1.rows[1]).toMatchObject({ pedidos: 1, mxn: 100.0 });
  });
});

// ──────────────────────────────── a3: celdas pequeñas sobre lo pagado ────────────────────────────────

describe('MarketingAnalyticsService — a3 buylist: enviado exacto, pagado con celda pequeña', () => {
  beforeEach(() => {
    // report() se necesita para armar la pantalla (a); no es el foco de estos casos.
  });

  it('a3: solicitudes enviadas EXACTAS; ofertas pagadas con N<5 ⇒ «< 5» y MX$ pagado null', async () => {
    const { svc, m } = build();
    m.report.mockResolvedValue(reportDto({ totals: figures({}), previousTotals: figures({}), comparison: {} }));
    m.sellRequestAggregate
      // 1ª llamada: enviadas (sin filtro de status).
      .mockResolvedValueOnce({ _count: { _all: 12 }, _sum: { quotedTotalCents: 789000 } })
      // 2ª llamada: pagadas (status pagada) — N<5 ⇒ sensible.
      .mockResolvedValueOnce({ _count: { _all: 3 }, _sum: { payoutNetCents: 456000 } });

    const payload = await svc.screen('a', weekPeriod, NOW, 'small_cells');
    const a3 = tableById(payload.tables, 'a3');

    // Enviadas: conteo y MX$ ofertado EXACTOS (no es cifra de persona única).
    expect(a3.rows[0]).toMatchObject({ concepto: expect.stringContaining('Solicitudes enviadas'), n: 12, mxn: 7890.0 });
    // Pagadas: N<5 ⇒ «< 5» y MX$ pagado NO viaja.
    expect(a3.rows[1]).toMatchObject({ concepto: expect.stringContaining('Ofertas aceptadas'), n: SMALL_CELL_SENTINEL, mxn: null });
  });

  it('a3: ofertas pagadas con N≥5 ⇒ conteo y MX$ pagado exactos', async () => {
    const { svc, m } = build();
    m.report.mockResolvedValue(reportDto({ totals: figures({}), previousTotals: figures({}), comparison: {} }));
    m.sellRequestAggregate
      .mockResolvedValueOnce({ _count: { _all: 20 }, _sum: { quotedTotalCents: 1000000 } })
      .mockResolvedValueOnce({ _count: { _all: 7 }, _sum: { payoutNetCents: 350000 } });
    const payload = await svc.screen('a', weekPeriod, NOW, 'small_cells');
    const a3 = tableById(payload.tables, 'a3');
    expect(a3.rows[1]).toMatchObject({ n: 7, mxn: 3500.0 });
  });
});

// ──────────────────────────────── d1/d3: celdas pequeñas por carta ────────────────────────────────

describe('MarketingAnalyticsService — d1/d3 aplican celdas pequeñas por dimensión', () => {
  const card = (name: string, number: string) => ({ name, number, set: { name: 'Set MX' } });

  it('d1: cartas con <5 unidades ⇒ «< 5» y MX$ null; vistas siempre GA4 «NO MEDIDO»', async () => {
    const { svc, m } = build();
    // A=6 (visible), B=3 y C=2 (ocultas): DOS ocultas ⇒ sin supresión complementaria (el total no despeja
    // una sola celda) ⇒ B y C quedan «< 5» en su sitio, A visible con MX$.
    const items = [
      ...Array.from({ length: 6 }, () => ({ unitPriceCents: 10000, inventoryItem: { cardId: 'A', card: card('Carta A', '001') } })),
      ...Array.from({ length: 3 }, () => ({ unitPriceCents: 20000, inventoryItem: { cardId: 'B', card: card('Carta B', '002') } })),
      ...Array.from({ length: 2 }, () => ({ unitPriceCents: 30000, inventoryItem: { cardId: 'C', card: card('Carta C', '003') } })),
    ];
    m.orderItemFindMany.mockResolvedValue(items);
    m.inventoryItemGroupBy.mockResolvedValue([{ cardId: 'A', _count: { _all: 2 } }]);

    const payload = await svc.screen('d', weekPeriod, NOW, 'small_cells');
    const d1 = tableById(payload.tables, 'd1');

    const rowA = d1.rows.find((r) => String(r.carta).includes('Carta A'));
    const rowB = d1.rows.find((r) => String(r.carta).includes('Carta B'));
    const rowC = d1.rows.find((r) => String(r.carta).includes('Carta C'));
    expect(rowA).toMatchObject({ unidadesVendidas: 6, mxn: 600.0, aLaVentaHoy: 2, vistas: expect.stringContaining('NO MEDIDO') });
    expect(rowB).toMatchObject({ unidadesVendidas: SMALL_CELL_SENTINEL, mxn: null });
    expect(rowC).toMatchObject({ unidadesVendidas: SMALL_CELL_SENTINEL, mxn: null });
  });

  it('d3: altas de lista de deseos con N<5 sobre carta con stock 0 ⇒ «< 5»', async () => {
    const { svc, m } = build();
    // A=3 y C=2 ocultas (DOS), B=8 visible ⇒ sin supresión complementaria.
    m.wishlistItemGroupBy.mockResolvedValue([
      { cardId: 'A', _count: { _all: 3 } },
      { cardId: 'B', _count: { _all: 8 } },
      { cardId: 'C', _count: { _all: 2 } },
    ]);
    m.cardFindMany.mockResolvedValue([
      { id: 'A', name: 'Carta A', number: '001', set: { name: 'Set MX' } },
      { id: 'B', name: 'Carta B', number: '002', set: { name: 'Set MX' } },
      { id: 'C', name: 'Carta C', number: '003', set: { name: 'Set MX' } },
    ]);
    // Ninguna a la venta hoy (stock 0) ⇒ todas «agotado con demanda».
    m.inventoryItemGroupBy.mockResolvedValue([]);

    const payload = await svc.screen('d', weekPeriod, NOW, 'small_cells');
    const d3 = tableById(payload.tables, 'd3');
    const rowA = d3.rows.find((r) => String(r.carta).includes('Carta A'));
    const rowB = d3.rows.find((r) => String(r.carta).includes('Carta B'));
    const rowC = d3.rows.find((r) => String(r.carta).includes('Carta C'));
    expect(rowA).toMatchObject({ listaDeseos: SMALL_CELL_SENTINEL });
    expect(rowB).toMatchObject({ listaDeseos: 8 });
    expect(rowC).toMatchObject({ listaDeseos: SMALL_CELL_SENTINEL });
  });
});

// ──────────────────────────────── c7: estados N<5 en «Otros estados», recogida aparte, 4 semanas ───────────

describe('MarketingAnalyticsService — c7 por estado de envío', () => {
  it('c7: una semana (<4 semanas) ⇒ NO MEDIDO con motivo, sin filas', async () => {
    const { svc, m } = build();
    const payload = await svc.screen('c', weekPeriod, NOW, 'small_cells');
    const c7 = tableById(payload.tables, 'c7');
    expect(c7.measured).toBe(false);
    expect(c7.notMeasuredReason).toContain('4 semanas');
    expect(c7.rows).toEqual([]);
    expect(m.orderFindMany).not.toHaveBeenCalled(); // no consulta si no llega al mínimo
  });

  it('c7 (mes, ≥4 semanas): estados N<5 ⇒ «Otros estados»; bóveda ⇒ «Recogida en persona» aparte', async () => {
    const { svc, m } = build();
    const shipTo = (state: string) => ({ fulfillmentMode: 'direct_ship', shippingAddressSnapshot: { state } });
    const orders = [
      ...Array.from({ length: 10 }, () => shipTo('Jalisco')), // visible
      ...Array.from({ length: 2 }, () => shipTo('Colima')), // <5 ⇒ Otros
      ...Array.from({ length: 1 }, () => shipTo('Nayarit')), // <5 ⇒ Otros
      ...Array.from({ length: 6 }, () => ({ fulfillmentMode: 'vault', shippingAddressSnapshot: null })), // recogida
    ];
    m.orderFindMany.mockResolvedValue(orders);

    const payload = await svc.screen('c', monthPeriod, NOW, 'small_cells');
    const c7 = tableById(payload.tables, 'c7');
    expect(c7.measured).toBe(true);

    const jalisco = c7.rows.find((r) => r.estado === 'Jalisco');
    const otros = c7.rows.find((r) => r.estado === 'Otros estados');
    const recogida = c7.rows.find((r) => r.estado === 'Recogida en persona');
    expect(jalisco).toMatchObject({ pedidos: 10 });
    // Colima(2) + Nayarit(1) = 3 (<5) ⇒ se agrupan y el conteo del grupo también se oculta.
    expect(otros).toMatchObject({ pedidos: SMALL_CELL_SENTINEL });
    expect(recogida).toMatchObject({ pedidos: 6 });
    // ⛔ Ni Colima ni Nayarit aparecen como fila propia.
    expect(c7.rows.some((r) => r.estado === 'Colima' || r.estado === 'Nayarit')).toBe(false);
  });
});

// ──────────────────────────────── Columnas GA4/SC/atribución: NO MEDIDO, nunca 0 ────────────────────────────

describe('MarketingAnalyticsService — columnas sin fuente salen «NO MEDIDO», NUNCA 0', () => {
  it('a4/a5 (GA4): measured=false con motivo «NO MEDIDO», sin filas 0', async () => {
    const { svc, m } = build();
    m.report.mockResolvedValue(reportDto({ totals: figures({}), previousTotals: figures({}), comparison: {} }));
    const payload = await svc.screen('a', weekPeriod, NOW, 'small_cells');
    for (const id of ['a4', 'a5']) {
      const t = tableById(payload.tables, id);
      expect(t.measured).toBe(false);
      expect(t.notMeasuredReason).toMatch(/^NO MEDIDO/);
      expect(t.rows).toEqual([]);
    }
  });

  it.each([
    ['b', 'b1'],
    ['e', 'e1'],
    ['g', 'g1'],
    ['f', 'f1'],
  ])('pantalla %s ⇒ %s measured=false y motivo «NO MEDIDO», nunca «0»', async (screen, id) => {
    const { svc } = build();
    const payload = await svc.screen(screen as 'b' | 'e' | 'g' | 'f', weekPeriod, NOW, 'small_cells');
    const t = tableById(payload.tables, id);
    expect(t.measured).toBe(false);
    expect(t.notMeasuredReason).toMatch(/^NO MEDIDO/);
    // El motivo explica POR QUÉ no se mide; jamás es el string «0».
    expect(t.notMeasuredReason).not.toBe('0');
    expect(t.rows).toEqual([]);
  });
});
