import type { MoneyDeltaDTO } from '@/types/contract';
import type { FigureDeltas, PnlColumnDTO, PnlFigure } from '@/types/reports-pnl';

/**
 * §REPORTES-CEO F2b — qué renglones del P&L por línea se pintan y de dónde sale cada uno. SOLO selecciona campos del servidor:
 * ⛔ ninguna suma, resta, margen ni variación se calcula aquí (`marginBps`, `contributionCents` y los `Delta` vienen hechos).
 */
export type RowId = 'grossSales' | 'discounts' | 'refunds' | 'netSales' | 'cogs' | 'grossProfit' | 'margin' | 'paymentFee' | 'shippingResult' | 'contribution';
export type Sign = '' | '±' | '−' | '=';

export interface RowDef {
  id: RowId;
  /** operación que el renglón hace en la fórmula (solo etiqueta y lectores de pantalla) */
  sign: Sign;
  kind: 'money' | 'pct';
  strong?: boolean;
  fig?: PnlFigure;
  get: (c: PnlColumnDTO) => number | null;
}

export const ROWS: readonly RowDef[] = [
  { id: 'grossSales', sign: '', kind: 'money', fig: 'grossSalesCents', get: (c) => c.grossSalesCents },
  { id: 'discounts', sign: '−', kind: 'money', fig: 'discountsCents', get: (c) => c.discountsCents },
  { id: 'refunds', sign: '−', kind: 'money', fig: 'refundsCents', get: (c) => c.refundsCents },
  { id: 'netSales', sign: '=', kind: 'money', strong: true, fig: 'netSalesCents', get: (c) => c.netSalesCents },
  { id: 'cogs', sign: '−', kind: 'money', fig: 'cogsCents', get: (c) => c.cogsCents },
  { id: 'grossProfit', sign: '=', kind: 'money', strong: true, fig: 'grossProfitCents', get: (c) => c.grossProfitCents },
  { id: 'margin', sign: '', kind: 'pct', get: (c) => c.marginBps },
  { id: 'paymentFee', sign: '−', kind: 'money', fig: 'paymentFeeCents', get: (c) => c.sellingCosts.paymentFeeCents },
  { id: 'shippingResult', sign: '±', kind: 'money', fig: 'shippingResultCents', get: (c) => c.sellingCosts.shippingResultCents },
  { id: 'contribution', sign: '=', kind: 'money', strong: true, fig: 'contributionCents', get: (c) => c.contributionCents },
];

export const deltaOf = (d: FigureDeltas | undefined, fig: PnlFigure | undefined): MoneyDeltaDTO | undefined => (d && fig ? d[fig] : undefined);
