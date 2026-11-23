import type { ComparisonBasis, MoneyDeltaDTO, PeriodKind, PnlComparisonDTO, PnlDTO, PnlStatementDTO } from '@/types/contract';

/**
 * SERVIDOR FALSO de §REPORTES-CEO F2a (espejo de `backend/src/modules/sales-analytics/sales-period.ts` y de
 * `admin.service.ts#pnlComparison`): el MISMO tramo del periodo anterior, `basis`/`dataSince`, `Delta` en centavos.
 * Solo vive en modo demo/pruebas; el navegador real NUNCA calcula esto (lo manda el servidor).
 */
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const MS = 86_400_000;
export const mockAddDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * MS).toISOString().slice(0, 10);
const span = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / MS) + 1;
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

const MONTHS: Record<'month' | 'quarter' | 'semester' | 'year', number> = { month: 1, quarter: 3, semester: 6, year: 12 };

/** Primer día de datos de la tienda demo. `sessionStorage['tcg.mock.firstDataDay']` lo cambia (capturas/e2e); `none` ⇒ sin pedidos. */
export function mockFirstDataDay(): string | null {
  try {
    const v = typeof window !== 'undefined' ? window.sessionStorage.getItem('tcg.mock.firstDataDay') : null;
    if (v === 'none') return null;
    if (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  } catch {
    /* sin sessionStorage (SSR/pruebas) ⇒ el defecto */
  }
  return '2024-03-01';
}

/** El demo por defecto NO trae `statement` (el P&L plano de siempre); `sessionStorage['tcg.mock.pnlStatement']='1'` lo enciende (e2e/capturas). */
function mockWantsStatement(): boolean {
  try {
    return typeof window !== 'undefined' && window.sessionStorage.getItem('tcg.mock.pnlStatement') === '1';
  } catch {
    return false;
  }
}

export interface MockPrev {
  from: string;
  to: string;
  clamped: boolean;
  kind: PeriodKind;
}

function unitOf(kind: keyof typeof MONTHS, day: string): { from: string; to: string } {
  const [y, m] = day.split('-').map(Number);
  const n = MONTHS[kind];
  const sm = Math.floor((m - 1) / n) * n + 1;
  const em = sm + n - 1;
  return { from: ymd(y, sm, 1), to: ymd(y, em, lastDay(y, em)) };
}

export function mockPreviousRange(kind: PeriodKind | undefined, from: string, to: string): MockPrev {
  const days = span(from, to);
  const asSpan = (): MockPrev => ({ from: mockAddDays(from, -days), to: mockAddDays(from, -1), clamped: false, kind: 'span' });
  if (!kind || kind === 'span') return asSpan();
  if (kind === 'day') return { from: mockAddDays(from, -7), to: mockAddDays(to, -7), clamped: false, kind };
  if (kind === 'rolling') return { from: mockAddDays(from, -days), to: mockAddDays(from, -1), clamped: false, kind };
  const unit = unitOf(kind, from);
  if (unit.from !== from || to > unit.to) return asSpan();
  const prev = unitOf(kind, mockAddDays(unit.from, -1));
  if (to === unit.to) return { ...prev, clamped: false, kind };
  const end = mockAddDays(prev.from, days - 1);
  return end > prev.to ? { ...prev, clamped: true, kind } : { from: prev.from, to: end, clamped: false, kind };
}

export function mockBasis(first: string | null, prev: { from: string; to: string }): { basis: ComparisonBasis; dataSince: string | null } {
  if (first === null || first > prev.to) return { basis: 'none', dataSince: null };
  if (first <= prev.from) return { basis: 'complete', dataSince: null };
  return { basis: 'partial', dataSince: first };
}

/** `Delta` del servidor: `deltaBps` entero (mitad hacia afuera de cero) sobre |anterior|; anterior 0 ⇒ `null`. */
export function mockDelta(cents: number, previousCents: number): MoneyDeltaDTO {
  const deltaCents = cents - previousCents;
  if (previousCents === 0) return { cents, previousCents, deltaCents, deltaBps: null };
  const raw = (deltaCents * 10_000) / Math.abs(previousCents);
  return { cents, previousCents, deltaCents, deltaBps: Math.sign(raw) * Math.round(Math.abs(raw)) };
}

/** Estado de resultados de la tienda demo a partir de los campos planos (misma álgebra que el servidor). */
export function mockStatementOf(p: PnlDTO): PnlStatementDTO {
  const returns = p.refundsCents + p.refundedFeesCents + p.compensationsCents;
  const sales = p.incomeCents + p.shippingRevenueCents;
  const net = sales - returns;
  const cost = p.cogsCents + p.stripeFeesCents + p.shippingCostCents + p.buylistGuideCostCents - p.buylistShippingFeeRetainedCents;
  const margin = net - cost;
  return {
    salesCents: sales,
    returnsAndRefunds: { refundsCents: p.refundsCents, refundedFeesCents: p.refundedFeesCents, compensationsCents: p.compensationsCents, totalCents: returns },
    netRevenueCents: net,
    costOfSales: {
      cogsCents: p.cogsCents,
      stripeFeesCents: p.stripeFeesCents,
      shippingCostCents: p.shippingCostCents,
      buylistGuideCostCents: p.buylistGuideCostCents,
      buylistShippingFeeRetainedCents: p.buylistShippingFeeRetainedCents,
      totalCents: cost,
    },
    grossMarginCents: margin,
    ebitdaCents: margin,
    iva: { ivaCollectedCents: 200_000, ivaRefundedCents: 5_600, ivaNetCents: 194_400 },
    netResultCents: margin,
  };
}

/** Factores del periodo anterior de la tienda demo (cifras distintas a propósito, para que la columna diga algo). */
const PREV_FACTOR = { sales: 0.82, returns: 1.35, cogs: 0.8, stripe: 0.9, shipping: 1.1 };

export function mockPnlWithComparison(base: PnlDTO, range: { from?: string; to?: string; kind?: PeriodKind }): PnlDTO {
  if (!range.from || !range.to) return { ...base, period: null, previousPeriod: null, comparison: null };
  const statement = base.statement ?? mockStatementOf(base);
  const withStatement = base.statement ? {} : mockWantsStatement() ? { statement } : {};
  const pr = mockPreviousRange(range.kind, range.from, range.to);
  const b = mockBasis(mockFirstDataDay(), pr);
  const f = PREV_FACTOR;
  const scale = (n: number, k: number) => Math.round(n * k);
  const prevFlat: PnlDTO = {
    ...base,
    incomeCents: scale(base.incomeCents, f.sales),
    shippingRevenueCents: scale(base.shippingRevenueCents, f.sales),
    cogsCents: scale(base.cogsCents, f.cogs),
    stripeFeesCents: scale(base.stripeFeesCents, f.stripe),
    shippingCostCents: scale(base.shippingCostCents, f.shipping),
    refundsCents: scale(base.refundsCents, f.returns),
    refundedFeesCents: scale(base.refundedFeesCents, f.returns),
    compensationsCents: scale(base.compensationsCents, f.returns),
  };
  const ps = mockStatementOf(prevFlat);
  prevFlat.profitCents = ps.netResultCents;
  const d = mockDelta;
  const comparison: PnlComparisonDTO = {
    basis: b.basis,
    dataSince: b.dataSince,
    figures: {
      salesCents: d(statement.salesCents, ps.salesCents),
      returnsAndRefundsCents: d(statement.returnsAndRefunds.totalCents, ps.returnsAndRefunds.totalCents),
      netRevenueCents: d(statement.netRevenueCents, ps.netRevenueCents),
      cogsCents: d(statement.costOfSales.cogsCents, ps.costOfSales.cogsCents),
      stripeFeesCents: d(statement.costOfSales.stripeFeesCents, ps.costOfSales.stripeFeesCents),
      shippingCostCents: d(statement.costOfSales.shippingCostCents, ps.costOfSales.shippingCostCents),
      grossMarginCents: d(statement.grossMarginCents, ps.grossMarginCents),
      netResultCents: d(statement.netResultCents, ps.netResultCents),
    },
  };
  return {
    ...base,
    ...withStatement,
    period: { from: range.from, to: range.to, kind: pr.kind, days: span(range.from, range.to), timezone: 'America/Mexico_City' },
    previousPeriod: { from: pr.from, to: pr.to, clamped: pr.clamped },
    comparison,
  };
}

// TL-DYN3R-2 · centinela PROPIO de este módulo: un literal, no un import. Ver sentinel.ts.
(globalThis as { __thMockBundle?: string }).__thMockBundle = 'th-mock-bundle-sentinel-5c1e';
