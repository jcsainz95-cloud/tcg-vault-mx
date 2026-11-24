import type { ComparisonBasis, MoneyDeltaDTO, PeriodKind } from '@/types/contract';

/**
 * §REPORTES-CEO F2b — formas EXACTAS de `GET /admin/reports/finance/pnl` y `…/pnl/series` (`API_CONTRACT_REPORTES.md` §3 y §3b).
 * Toda `*Cents` es un entero del servidor; la pantalla NO calcula dinero (ni suma líneas, ni margen, ni variaciones).
 */
export const PNL_LINES = ['sealed', 'raw', 'graded', 'accessory', 'unassigned'] as const;
export type PnlLineKey = (typeof PNL_LINES)[number];

/** `Renglón` de la comparación (§3): las nueve cifras que tienen `Delta`. */
export const PNL_FIGURES = [
  'grossSalesCents',
  'discountsCents',
  'refundsCents',
  'netSalesCents',
  'cogsCents',
  'grossProfitCents',
  'paymentFeeCents',
  'shippingResultCents',
  'contributionCents',
] as const;
export type PnlFigure = (typeof PNL_FIGURES)[number];

export interface PnlColumnDTO {
  grossSalesCents: number;
  discountsCents: number;
  refundsCents: number;
  netSalesCents: number;
  cogsCents: number;
  grossProfitCents: number;
  /** puntos base enteros; `null` si `netSalesCents ≤ 0` */
  marginBps: number | null;
  sellingCosts: { paymentFeeCents: number; shippingResultCents: number };
  contributionCents: number;
  /** SOLO en `total`, `own.total` y `previous.total` (no en líneas ni cubos); `null` hasta F3 («antes de gastos fijos») */
  fixedCostsCents?: number | null;
  resultCents?: number | null;
}

export type PnlLinesDTO = Record<PnlLineKey, PnlColumnDTO>;
export type FigureDeltas = Record<PnlFigure, MoneyDeltaDTO>;
export type LineDeltas = Record<PnlLineKey, FigureDeltas>;

export interface PnlReportDTO {
  period: { from: string; to: string; kind: PeriodKind; days: number; timezone: 'America/Mexico_City'; toDate?: boolean } | null;
  previousPeriod: { from: string; to: string; clamped: boolean } | null;
  firstDataDay: string | null;
  own: PnlLinesDTO & { total: PnlColumnDTO };
  marketplace: { available: boolean; gmvCents: number | null; commissionCents: number | null };
  total: PnlColumnDTO;
  memo: {
    iva: { collectedCents: number; refundedCents: number; netCents: number };
    inventoryPurchasesCents: number;
    chargebacks: { orders: number; cents: number };
    shrinkageCents: number;
    shipping: { insuranceCents: number; adjustmentsCents: number };
    buylist: { retainedFeeCents: number; guideCostCents: number };
  };
  previous: { own: PnlLinesDTO & { total: PnlColumnDTO }; total: PnlColumnDTO } | null;
  comparison: { basis: ComparisonBasis; dataSince: string | null; total: FigureDeltas; byLine: LineDeltas } | null;
  costMissingCount: number;
  stripeFeeEstimatedOrders: number;
  allocationMismatchOrders: number;
}

export type CalendarUnit = 'month' | 'quarter' | 'semester' | 'year';
export const CALENDAR_UNITS: readonly CalendarUnit[] = ['month', 'quarter', 'semester', 'year'];

export interface CalendarBucketDTO {
  from: string;
  to: string;
  kind: CalendarUnit;
  toDate: boolean;
  days: number;
  own: PnlLinesDTO & { total: PnlColumnDTO };
  total: PnlColumnDTO;
  comparison: {
    basis: ComparisonBasis;
    dataSince: string | null;
    previous: { from: string; to: string; clamped: boolean };
    total: FigureDeltas;
    byLine: LineDeltas;
  };
}

export interface PnlCalendarDTO {
  asOf: string;
  fiscalYearStartMonth: number;
  unit: CalendarUnit;
  /** del más antiguo al más reciente; el último es el periodo EN CURSO (`toDate: true`) */
  buckets: CalendarBucketDTO[];
}

/** `GET /admin/reports/finance/pnl/series?from&to&groupBy=day|week&line=…` (§3): cubos con `column` (sin `fixedCostsCents`/`resultCents`). */
export type PnlSeriesLine = PnlLineKey | 'all';
export interface PnlSeriesDTO {
  period: { from: string; to: string; kind: PeriodKind; days: number; timezone: 'America/Mexico_City'; toDate: boolean; groupBy: 'day' | 'week'; line: PnlSeriesLine };
  buckets: { from: string; to: string; column: PnlColumnDTO }[];
  /** con `line=all` lleva `fixedCostsCents`/`resultCents` `null`; con una línea, no */
  total: PnlColumnDTO;
}
