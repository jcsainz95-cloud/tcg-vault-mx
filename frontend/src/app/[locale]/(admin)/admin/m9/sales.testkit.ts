/**
 * Fixtures de los candados de la pestaña «Ventas» (`DESIGN_SYSTEM §AN-UX.15`). Solo para pruebas.
 * ⚠️ A PROPÓSITO, `totals` NO es la suma de `rows` (UX-AN-4/6): si la pantalla sumara filas, se notaría.
 */
import type { SalesFiguresDTO, SalesReportDTO, SalesRowDTO, SalesTodayDTO } from '@/types/contract';

export function figures(over: Partial<SalesFiguresDTO> = {}): SalesFiguresDTO {
  return {
    orders: 0,
    chargedCents: 0,
    netSalesCents: 0,
    refunds: { count: 0, amountCents: 0, netCents: 0, byChannel: { card: { count: 0, amountCents: 0 }, spei: { count: 0, amountCents: 0 } } },
    netSalesAfterRefundsCents: 0,
    pieces: 0,
    avgTicketCents: null,
    piecesPerOrder: null,
    ...over,
  };
}

export const P2_FIGS: Pick<SalesFiguresDTO, 'shipping' | 'buylist' | 'profitCents'> = {
  shipping: { chargedNetCents: 30000, costNetCents: 23600, costMissingCount: 0, adjustmentsCents: 0 },
  buylist: { paidCount: 0, paidNetCents: 0, paidWithoutPayoutCount: 0 },
  profitCents: 12345,
};

const DAYS = ['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06'];

/** 7 días con ventas en 2 (el 1 y el 3 de oct). */
export function rows7(p2 = false): SalesRowDTO[] {
  return DAYS.map((d) => {
    const sold = d === '2026-10-01' ? 2 : d === '2026-10-03' ? 1 : 0;
    const f = figures(
      sold === 0
        ? {}
        : { orders: sold, chargedCents: sold * 50000, netSalesCents: sold * 40000, netSalesAfterRefundsCents: sold * 40000, pieces: sold * 2, avgTicketCents: 50000, piecesPerOrder: 2 },
    );
    return { from: d, to: d, ...f, ...(p2 ? P2_FIGS : {}) };
  });
}

export function report(over: Partial<SalesReportDTO> = {}): SalesReportDTO {
  return {
    period: { preset: 'last7', from: '2026-09-30', to: '2026-10-06', days: 7, timezone: 'America/Mexico_City' },
    previousPeriod: { from: '2026-09-23', to: '2026-09-29' },
    groupBy: 'day',
    // ≠ Σ rows (Σ = 3 pedidos, MX$1,500.00): 7 pedidos, MX$9,876.54 — para que sumar filas se note.
    totals: figures({ orders: 3, chargedCents: 987654, netSalesCents: 800000, netSalesAfterRefundsCents: 800000, pieces: 6, avgTicketCents: 329218, piecesPerOrder: 2 }),
    previousTotals: figures({ orders: 1, chargedCents: 50000, netSalesCents: 40000, netSalesAfterRefundsCents: 40000, pieces: 2, avgTicketCents: 50000, piecesPerOrder: 2 }),
    comparison: {
      orders: { diff: 2, pct: 200 },
      chargedCents: { diff: 937654, pct: 1875 },
      netSalesCents: { diff: 760000, pct: 1900 },
      refundsAmountCents: { diff: 0, pct: null },
      netSalesAfterRefundsCents: { diff: 760000, pct: 1900 },
      avgTicketCents: { diff: 279218, pct: 558 },
      piecesPerOrder: { diff: 0, pct: 0 },
    },
    rows: rows7(),
    top: {
      sort: 'net',
      cards: [
        { cardId: 'c1', name: 'Charizard ex', number: '199/165', setName: '151', finish: 'reverse_holo', productType: 'raw', pieces: 1, netCents: 420000 },
        { cardId: 'c1', name: 'Charizard ex', number: '199/165', setName: '151', finish: 'holofoil', productType: 'raw', pieces: 3, netCents: 300000 },
        { cardId: 'c2', name: 'Pikachu', number: '025', setName: 'Base', finish: 'normal', productType: 'graded', pieces: 1, netCents: 210000 },
      ],
      sets: [{ setId: 's1', setName: '151', pieces: 4, netCents: 720000 }],
      sealed: [],
    },
    customers: { new: 2, returning: 1, distinct: 3 },
    ...over,
  };
}

/** El mismo informe con P2 de fase B completo (sin `buylist*` de #78). */
export function reportP2(over: Partial<SalesReportDTO> = {}): SalesReportDTO {
  const base = report();
  return {
    ...base,
    totals: { ...base.totals, ...P2_FIGS },
    previousTotals: { ...base.previousTotals, ...P2_FIGS },
    rows: rows7(true),
    bestDays: {
      byWeekday: ([1, 2, 3, 4, 5, 6, 7] as const).map((weekday) => ({ weekday, orders: weekday === 4 ? 2 : weekday === 6 ? 1 : 0, chargedCents: 0 })),
      byHour: Array.from({ length: 24 }, (_, hour) => ({ hour, orders: hour === 13 ? 3 : 0, chargedCents: 0 })),
    },
    mix: {
      byDestination: { vault: { orders: 1, chargedCents: 1 }, direct_ship: { orders: 2, chargedCents: 2 } },
      byBuyer: { account: { orders: 2, chargedCents: 2 }, guest: { orders: 1, chargedCents: 1 } },
    },
    ...over,
  };
}

export function today(over: Partial<SalesTodayDTO> = {}): SalesTodayDTO {
  return {
    today: { day: '2026-10-06', orders: 3, chargedCents: 125000 },
    sameWeekdayLastWeek: { day: '2026-09-29', orders: 1, chargedCents: 40000 },
    comparison: { orders: { diff: 2, pct: 200 }, chargedCents: { diff: 85000, pct: 213 } },
    ...over,
  };
}
