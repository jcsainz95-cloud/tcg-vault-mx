import type { ComparisonBasis, PeriodKind } from '@/types/contract';
import type {
  CalendarBucketDTO,
  CalendarUnit,
  FigureDeltas,
  LineDeltas,
  PnlCalendarDTO,
  PnlColumnDTO,
  PnlLineKey,
  PnlLinesDTO,
  PnlReportDTO,
} from '@/types/reports-pnl';
import { PNL_FIGURES, PNL_LINES } from '@/types/reports-pnl';
import { mockBasis, mockDelta, mockFirstDataDay, mockPreviousRange, mockToDate } from './period-compare';
import { mockPnl } from './fixtures';

/**
 * SERVIDOR FALSO de §REPORTES-CEO F2b (espejo de `GET /admin/reports/finance/pnl` y `…/pnl/series`, `API_CONTRACT_REPORTES.md`
 * §3/§3b): formas EXACTAS del contrato y la misma álgebra (bruto − descuentos − reembolsos = neto; − costo = ganancia bruta;
 * `marginBps` mitad hacia afuera de cero o `null`; contribución = ganancia bruta − comisión + resultado del envío; Σ de las 5
 * columnas = `total` al centavo). Las cifras base cuadran con `mockPnl` (`total.contributionCents == mockPnl.profitCents`).
 * Solo vive en modo demo/pruebas (`lib/mock/*` es un módulo vacío en un build sin mocks); el navegador real NUNCA calcula esto.
 * `sessionStorage['tcg.mock.allocationMismatch']='N'` enciende el contador de reparto dudoso (capturas/e2e).
 */
type Inputs = { gross: number; disc: number; refunds: number; cogs: number; fee: number; ship: number };

/** Una línea del mes demo, en centavos. Σ de las cinco = `mockPnl` (ver prueba `pnl-lines.test.ts`). */
const BASE: Record<PnlLineKey, Inputs> = {
  sealed: { gross: 520_000, disc: 15_000, refunds: 12_000, cogs: 270_000, fee: 19_800, ship: 6_200 },
  raw: { gross: 410_000, disc: 12_000, refunds: 20_000, cogs: 190_000, fee: 15_300, ship: 5_000 },
  graded: { gross: 255_000, disc: 7_000, refunds: 0, cogs: 140_000, fee: 9_000, ship: 3_000 },
  accessory: { gross: 103_000, disc: 4_000, refunds: 12_400, cogs: 40_000, fee: 4_200, ship: 2_500 },
  // Sin pedido: buylist (+ tarifa retenida − guía de entrada = 18 000 − 21 552) ⇒ solo `shippingResultCents`.
  unassigned: { gross: 0, disc: 0, refunds: 0, cogs: 0, fee: 0, ship: -3_552 },
};
const ZERO: Inputs = { gross: 0, disc: 0, refunds: 0, cogs: 0, fee: 0, ship: 0 };
const KEYS: (keyof Inputs)[] = ['gross', 'disc', 'refunds', 'cogs', 'fee', 'ship'];

const halfAway = (x: number) => Math.sign(x) * Math.round(Math.abs(x));

function column(i: Inputs, withFixed = false): PnlColumnDTO {
  const net = i.gross - i.disc - i.refunds;
  const gp = net - i.cogs;
  const c: PnlColumnDTO = {
    grossSalesCents: i.gross,
    discountsCents: i.disc,
    refundsCents: i.refunds,
    netSalesCents: net,
    cogsCents: i.cogs,
    grossProfitCents: gp,
    marginBps: net > 0 ? halfAway((gp * 10_000) / net) : null,
    sellingCosts: { paymentFeeCents: i.fee, shippingResultCents: i.ship },
    contributionCents: gp - i.fee + i.ship,
  };
  if (withFixed) {
    c.fixedCostsCents = null;
    c.resultCents = null;
  }
  return c;
}

function scaled(base: Inputs, k: number, f: Partial<Record<keyof Inputs, number>> = {}): Inputs {
  const o = { ...ZERO };
  for (const key of KEYS) o[key] = Math.round(base[key] * k * (f[key] ?? 1));
  return o;
}

function sum(rows: Inputs[]): Inputs {
  const o = { ...ZERO };
  for (const r of rows) for (const key of KEYS) o[key] += r[key];
  return o;
}

type Own = PnlLinesDTO & { total: PnlColumnDTO };
function ownOf(inputs: Record<PnlLineKey, Inputs>): { own: Own; total: PnlColumnDTO } {
  const lines = Object.fromEntries(PNL_LINES.map((l) => [l, column(inputs[l])])) as PnlLinesDTO;
  const total = column(sum(PNL_LINES.map((l) => inputs[l])), true);
  return { own: { ...lines, total: { ...total } }, total };
}

const lineInputs = (k: number, f: Partial<Record<keyof Inputs, number>> = {}): Record<PnlLineKey, Inputs> =>
  Object.fromEntries(PNL_LINES.map((l) => [l, scaled(BASE[l], k, f)])) as Record<PnlLineKey, Inputs>;

/** El periodo anterior de la tienda demo: cifras distintas a propósito (la columna «Antes» debe decir algo). */
const PREV_F = { gross: 0.82, disc: 1.1, refunds: 1.35, cogs: 0.8, fee: 0.9, ship: 0.7 };

function deltas(cur: PnlColumnDTO, prev: PnlColumnDTO): FigureDeltas {
  const v = (c: PnlColumnDTO): Record<(typeof PNL_FIGURES)[number], number> => ({
    grossSalesCents: c.grossSalesCents,
    discountsCents: c.discountsCents,
    refundsCents: c.refundsCents,
    netSalesCents: c.netSalesCents,
    cogsCents: c.cogsCents,
    grossProfitCents: c.grossProfitCents,
    paymentFeeCents: c.sellingCosts.paymentFeeCents,
    shippingResultCents: c.sellingCosts.shippingResultCents,
    contributionCents: c.contributionCents,
  });
  const a = v(cur);
  const b = v(prev);
  return Object.fromEntries(PNL_FIGURES.map((f) => [f, mockDelta(a[f], b[f])])) as FigureDeltas;
}
function lineDeltas(cur: Own, prev: Own): LineDeltas {
  return Object.fromEntries(PNL_LINES.map((l) => [l, deltas(cur[l], prev[l])])) as LineDeltas;
}

function mismatch(): number {
  try {
    const v = typeof window !== 'undefined' ? Number(window.sessionStorage.getItem('tcg.mock.allocationMismatch')) : 0;
    return Number.isInteger(v) && v > 0 ? v : 0;
  } catch {
    return 0;
  }
}

const span = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1;

/** `GET /admin/reports/finance/pnl` de la tienda demo (el mes demo escala con los días del rango). */
export function mockPnlReport(range: { from?: string; to?: string; kind?: PeriodKind }): PnlReportDTO {
  const hasRange = !!(range.from && range.to);
  const days = hasRange ? span(range.from!, range.to!) : 365;
  const k = days / 30;
  const cur = ownOf(lineInputs(k));
  const base = {
    firstDataDay: mockFirstDataDay(),
    own: cur.own,
    marketplace: { available: false, gmvCents: null, commissionCents: null },
    total: cur.total,
    memo: {
      iva: { collectedCents: Math.round(200_000 * k), refundedCents: Math.round(5_600 * k), netCents: Math.round(200_000 * k) - Math.round(5_600 * k) },
      inventoryPurchasesCents: Math.round(310_000 * k),
      chargebacks: { orders: 1, cents: 84_000 },
      shrinkageCents: Math.round(15_500 * k),
      shipping: { insuranceCents: 2_500, adjustmentsCents: 4_200 },
      buylist: { retainedFeeCents: 18_000, guideCostCents: 21_552 },
    },
    costMissingCount: mockPnl.shippingCostMissingCount,
    stripeFeeEstimatedOrders: 1,
    allocationMismatchOrders: mismatch(),
  };
  if (!hasRange) return { period: null, previousPeriod: null, previous: null, comparison: null, ...base };
  const pr = mockPreviousRange(range.kind, range.from!, range.to!);
  const b = mockBasis(mockFirstDataDay(), pr);
  const prev = ownOf(lineInputs(k, PREV_F));
  return {
    period: { from: range.from!, to: range.to!, kind: pr.kind, days, timezone: 'America/Mexico_City', toDate: mockToDate(pr.kind, range.from!, range.to!) },
    previousPeriod: { from: pr.from, to: pr.to, clamped: pr.clamped },
    previous: { own: prev.own, total: prev.total },
    comparison: { basis: b.basis, dataSince: b.dataSince, total: deltas(cur.total, prev.total), byLine: lineDeltas(cur.own, prev.own) },
    ...base,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Consolidados (§3b): periodos COMPLETOS del calendario + el en curso (`toDate`), del más antiguo al más reciente.
const UNIT_MONTHS: Record<CalendarUnit, number> = { month: 1, quarter: 3, semester: 6, year: 12 };
const pad = (n: number) => String(n).padStart(2, '0');
const lastDayOf = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Día de México de hoy sin depender de `lib/reports/period` (este módulo es autónomo). */
function todayYmd(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(now);
}

export function mockPnlCalendar(p: { unit: CalendarUnit; count?: number; asOf?: string }): PnlCalendarDTO {
  const count = Math.min(12, Math.max(1, p.count ?? 4));
  const asOf = p.asOf ?? todayYmd();
  const n = UNIT_MONTHS[p.unit];
  const [y, m] = asOf.split('-').map(Number);
  const startIdx = y * 12 + (Math.floor((m - 1) / n) * n); // índice de mes (0-based) del inicio del periodo en curso
  const first = mockFirstDataDay();
  const buckets: CalendarBucketDTO[] = [];
  for (let i = -count; i <= 0; i++) {
    const idx = startIdx + i * n;
    const by = Math.floor(idx / 12);
    const bm = (idx % 12) + 1;
    const em = bm + n - 1;
    const from = `${by}-${pad(bm)}-01`;
    const unitTo = `${by + Math.floor((em - 1) / 12)}-${pad(((em - 1) % 12) + 1)}-${pad(lastDayOf(by + Math.floor((em - 1) / 12), ((em - 1) % 12) + 1))}`;
    const current = i === 0;
    const to = current ? asOf : unitTo;
    const days = span(from, to);
    // Un vaivén determinista por periodo (sin azar): las columnas no son idénticas.
    const wobble = 0.9 + ((((by * 12 + bm) * 7919) % 23) / 100);
    const empty = first === null || to < first;
    const k = empty ? 0 : (days / 30) * wobble;
    const cur = ownOf(lineInputs(k));
    const pr = mockPreviousRange(p.unit as PeriodKind, from, to);
    const b = mockBasis(first, pr);
    const prev = ownOf(lineInputs(empty ? 0 : (span(pr.from, pr.to) / 30) * wobble * 0.88, PREV_F));
    buckets.push({
      from,
      to,
      kind: p.unit,
      toDate: current && to < unitTo,
      days,
      own: cur.own,
      total: cur.total,
      comparison: {
        basis: b.basis as ComparisonBasis,
        dataSince: b.dataSince,
        previous: { from: pr.from, to: pr.to, clamped: pr.clamped },
        total: deltas(cur.total, prev.total),
        byLine: lineDeltas(cur.own, prev.own),
      },
    });
  }
  return { asOf, fiscalYearStartMonth: 1, unit: p.unit, buckets };
}

// TL-DYN3R-2 · centinela PROPIO de este módulo: un literal, no un import. Ver sentinel.ts.
(globalThis as { __thMockBundle?: string }).__thMockBundle = 'th-mock-bundle-sentinel-5c1e';
