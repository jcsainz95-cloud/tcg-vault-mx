/**
 * label-dto.ts — los DTO de cotizar y comprar la guía de Skydropx (API_CONTRACT §M4-SHIP.19.19.4 — que sustituye los de
 * §19.6 —, §19.20.4 `isPromo`). ⛔ Ningún campo crudo del proveedor (criterio 246): la lista blanca son estos tipos.
 */
export type DeliveryKind = 'home' | 'branch' | 'unknown';

export interface ShipmentRateDTO {
  rateId: string;
  carrierName: string;
  carrierLabel: string;
  serviceName: string;
  /** total (IVA incluido) + seguro (criterio 236). */
  priceCents: number;
  breakdown: {
    amountCents: number;
    extraFeesCents: number;
    ivaCents: number;
    serviceFeeCents: number;
    totalCents: number;
    insuranceCents: number;
  };
  ivaSource: 'provider' | 'computed';
  insuranceSource: 'quote' | 'tier_table';
  netCostCents: number;
  marginCents: number;
  days: number | null;
  deliveryKind: DeliveryKind;
  pickup: boolean | null;
  planType: string | null;
  /** ⭐ v1.80.12 (§19.20.4): `isPromoPlan(planType)`. */
  isPromo: boolean;
  dropoff: { name: string; address: string } | null;
  recommended: boolean;
  /** ⇔ `deliveryKind === 'branch'` (T.3.5). */
  hidden: boolean;
}

export interface ExcludedRatesDTO {
  unavailable: number;
  noCoverage: number;
  notApplicable: number;
  multipackage: number;
  breakdownMismatch: number;
}

export interface ShipmentQuoteDTO {
  quoteId: string;
  providerQuotationId: string;
  requestedAt: string;
  expiresAt: string;
  completed: boolean;
  reused: boolean;
  package: { code: string; label: string; lengthCm: number; widthCm: number; heightCm: number; weightKg: number };
  insurance: { insuredValueCents: number; coverageCents: number; costCents: number };
  charged: { grossCents: number; netCents: number };
  recommendedRateId: string | null;
  /** Ordenadas por `priceCents` asc; las `hidden` VAN (la pantalla las pliega). */
  rates: ShipmentRateDTO[];
  excluded: ExcludedRatesDTO;
}
