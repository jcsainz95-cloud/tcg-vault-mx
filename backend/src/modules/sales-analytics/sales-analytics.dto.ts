/**
 * sales-analytics.dto.ts — los DTO de §AN (API_CONTRACT §15.4, §15.5). Dinero en centavos (el CSV, en pesos: §15.7).
 * ⛔ Claves de fases no construidas NO viajan (AN-1.1): faltan a propósito `shipping.buylistRevenueCents/CostCents`
 * (#78), `chargebacks`, `chargebacksUndatedCount` y `mix.byPaymentMethod` (fase C, `M-AN-1`).
 */
import type { Finish } from '@prisma/client';
import type { Delta, SalesFigures } from './sales-figures';
import type { SalesGroupBy, SalesPreset, SalesTopSort, Ymd } from './sales-period';

export interface TopCard {
  cardId: string;
  name: string;
  number: string;
  setName: string;
  finish: Finish;
  productType: 'raw' | 'graded';
  pieces: number;
  netCents: number;
}
export interface TopSet {
  setId: string;
  setName: string;
  pieces: number;
  netCents: number;
}
export interface TopSealed {
  sealedProductId: string | null;
  name: string;
  /**
   * AN-1.2 (§15.3): `string | null` en el contrato. ⚠️ Medido: hoy NUNCA es `null` — sin `SealedProduct` el set es el de la
   * `Card` de la pieza, y `InventoryItem.cardId` y `Card.setId` son obligatorios en el schema. ⛔ No se inventa texto.
   */
  setName: string | null;
  pieces: number;
  netCents: number;
}
export interface MixCell {
  orders: number;
  chargedCents: number;
}
export interface PieceCell {
  pieces: number;
  netCents: number;
}

export interface SalesReportDTO {
  period: { preset: SalesPreset; from: Ymd; to: Ymd; days: number; timezone: 'America/Mexico_City' };
  previousPeriod: { from: Ymd; to: Ymd };
  groupBy: SalesGroupBy;
  totals: SalesFigures;
  previousTotals: SalesFigures;
  comparison: {
    orders: Delta;
    chargedCents: Delta;
    netSalesCents: Delta;
    refundsAmountCents: Delta;
    netSalesAfterRefundsCents: Delta;
    avgTicketCents: Delta;
    piecesPerOrder: Delta;
  };
  rows: Array<{ from: Ymd; to: Ymd } & SalesFigures>;
  top: { sort: SalesTopSort; cards: TopCard[]; sets: TopSet[]; sealed: TopSealed[] };
  customers: { new: number; returning: number; distinct: number };
  bestDays: {
    byWeekday: Array<{ weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7; orders: number; chargedCents: number }>;
    byHour: Array<{ hour: number; orders: number; chargedCents: number }>;
  };
  mix: {
    byDestination: { vault: MixCell; direct_ship: MixCell };
    byBuyer: { account: MixCell; guest: MixCell };
    /** 💰 v1.86⟨accesorios⟩ (§AC.12): + `accessory` (unidades de renglones de accesorio + 1 por paquete). */
    byProductType: { raw: PieceCell; graded: PieceCell; sealed: PieceCell; accessory: PieceCell };
  };
}

export interface SalesTodayDTO {
  today: { day: Ymd; orders: number; chargedCents: number };
  sameWeekdayLastWeek: { day: Ymd; orders: number; chargedCents: number };
  comparison: { orders: Delta; chargedCents: Delta };
}
