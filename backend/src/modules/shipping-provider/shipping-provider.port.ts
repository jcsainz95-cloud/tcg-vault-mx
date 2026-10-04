/**
 * shipping-provider.port.ts — el puerto del proveedor de guías (API_CONTRACT §M4-SHIP.19.4, tipos corregidos por
 * §19.19.4 y §19.19.8). ⛔ Sin tipos de Skydropx en la firma: el dominio (`shipments`) no conoce al proveedor.
 *
 * Token DI: `SHIPPING_PROVIDER_PORT`. Adaptadores: `SkydropxAdapter` (real), `NoopShippingProviderAdapter` (sin
 * configuración ⇒ `409 SHIPPING_PROVIDER_NOT_CONFIGURED`), `FakeShippingProvider` (pila E2E y pruebas).
 */
export const SHIPPING_PROVIDER_PORT = 'SHIPPING_PROVIDER_PORT';

/** Los 12 valores de la referencia §5 (NO MEDIDOS contra la API, §19.19.10). */
export const CARRIER_STATUSES = [
  'created',
  'picked_up',
  'in_transit',
  'last_mile',
  'delivery_attempt',
  'delivered_to_branch',
  'delivered',
  'exception',
  'in_return',
  'canceled',
  'destroyed',
  'retained',
] as const;
export type ProviderCarrierStatus = (typeof CARRIER_STATUSES)[number];

// ── Cotizar (§19.19.4) ────────────────────────────────────────────────────────────────────────────────────────

export interface QuoteInput {
  from: { templateId: string };
  to: { countryCode: 'MX'; postalCode: string; state: string; city: string; neighborhood: string };
  /** `weightKg` entero ≥ 1 (§19.19.6). `coverageCents` = el escalón de seguro (§19.19.5), nunca omitido. */
  parcel: { lengthCm: number; widthCm: number; heightCm: number; weightKg: number; coverageCents: number };
}

export interface ProviderRate {
  rateId: string;
  /** `provider_name`, p. ej. `'ninetynineminutes'`. */
  carrierName: string;
  /** `provider_display_name`. */
  carrierLabel: string;
  serviceName: string;
  serviceCode: string | null;
  amountCents: number;
  extraFeesCents: number;
  vatCents: number | null;
  serviceFeeCents: number;
  totalCents: number;
  /** `protection_value_total` — SOLO si el eco del seguro coincide (§19.19.4); si no, `null`. */
  insuranceCents: number | null;
  days: number | null;
  deliveryKind: 'home' | 'branch' | 'unknown';
  pickup: boolean | null;
  pickupViaSupport: boolean | null;
  creationType: 'single' | 'multipackage' | 'multishipment';
  planType: string | null;
}

export interface ExcludedRateCounts {
  unavailable: number;
  noCoverage: number;
  notApplicable: number;
  multipackage: number;
  breakdownMismatch: number;
}

export interface InsuranceEcho {
  /** `packages[0].package_protected === true ∧ declared_value == coverage` (M-5). */
  ok: boolean;
  echoedProtected: boolean | null;
  echoedDeclaredValueCents: number | null;
}

export interface QuoteResult {
  providerQuotationId: string;
  completed: boolean;
  /** Solo las ofrecibles (filtro de §19.19.4), en el orden de la API. */
  rates: ProviderRate[];
  excluded: ExcludedRateCounts;
  insuranceEcho: InsuranceEcho;
  /** Respuesta ya redactada por lista blanca (`redactProviderPayload`, SEC-SDX-6/7). */
  raw: unknown;
}

// ── Comprar (§19.19.8) ────────────────────────────────────────────────────────────────────────────────────────

export interface OriginSnapshot {
  street1: string;
  name: string;
  company: string;
  phone: string;
  email: string;
  reference: string;
}

export interface PurchaseInput {
  rateId: string;
  printingFormat: 'standard' | 'thermal';
  from: { templateId: string; snapshot: OriginSnapshot | null };
  /** T.11 + SEC-SDX-7: SOLO esto. `furtherInformation` = `Address.references` (≤ 70). ⛔ sin `reference`. */
  to: { street1: string; name: string; company: string; phone: string; email: string; furtherInformation?: string };
  package: { coverageCents: number; consignmentNote: string; packageType: string };
  /** `label:<shipmentId>:<rateId>` — que Skydropx lo respete es NO MEDIDO (§19.19.18). */
  idempotencyKey: string;
}

export interface ProviderError {
  code: string;
  message: string;
  detail?: string;
}

export interface PurchaseResult {
  providerShipmentId: string;
  carrierName: string | null;
  /** `null` ⇒ «guía en proceso» (R5). */
  trackingNumber: string | null;
  /** URLs CRUDAS de la respuesta: se validan con `providerUrlsFrom` ANTES de escribirse (SEC-SDX-5). */
  labelUrl: string | null;
  trackingUrl: string | null;
  totalCents: number | null;
  insuranceCents: number | null;
  /** `error_detail.error_code ≠ null` ⇒ rama de rechazo (§19.7 paso 9). */
  error: ProviderError | null;
  raw: unknown;
}

export interface ProviderEvent {
  /** `null` ⇔ el valor crudo no es uno de los 12 ⇒ evento NO aplicado + log `unknown_carrier_status` (§19.19.10). */
  status: ProviderCarrierStatus | null;
  occurredAt: string | null;
  rawStatus: string;
}

export interface ProviderShipmentState extends Omit<PurchaseResult, 'raw'> {
  carrierStatus: ProviderCarrierStatus | null;
  /** Valor de estado que llegó y NO es uno de los 12 (log `unknown_carrier_status`). */
  unknownCarrierStatus: string | null;
  /** `updated_at` del estado, si viene (llave del evento sintético sin `now`, SEC-SDX-2). */
  statusUpdatedAt: string | null;
  events: ProviderEvent[];
  raw: unknown;
}

export type CancelResult =
  | { ok: true; refundedCents: number | null }
  | { ok: false; code: string; message: string };

export interface ProviderExtraCharge {
  providerChargeId: string;
  providerShipmentId: string | null;
  trackingNumber: string | null;
  amountCents: number;
  chargeType: string | null;
  /** Fecha del cargo si viene (NO MEDIDO el campo); `null` ⇒ el job usa `observedAt`. */
  chargedAt: string | null;
  status: string | null;
}

export interface CatalogRow {
  code: string;
  name: string;
}

/** Plantillas de dirección SIN PII (§19.19.6): ⛔ nombre, teléfono, correo, RFC. */
export interface AddressTemplateSummary {
  id: string;
  alias: string | null;
  addressType: 'from' | 'to' | null;
  isDefault: boolean;
  postalCode: string | null;
}

export interface ShippingProviderPort {
  readonly name: 'skydropx';
  quote(input: QuoteInput): Promise<QuoteResult>;
  purchase(input: PurchaseInput): Promise<PurchaseResult>;
  getShipment(providerShipmentId: string): Promise<ProviderShipmentState>;
  cancel(providerShipmentId: string, reason: string): Promise<CancelResult>;
  protect?(providerShipmentId: string, coverageCents: number): Promise<void>;
  balance(): Promise<{ balanceCents: number; currency: 'MXN' }>;
  extraCharges(from: Date, to: Date): AsyncIterable<ProviderExtraCharge>;
  packagings?(): Promise<CatalogRow[]>;
  consignmentNote?(code: string): Promise<{ code: string; description: string } | null>;
  searchConsignmentNotes?(description: string): Promise<{ code: string; description: string }[]>;
  addressTemplates?(): Promise<AddressTemplateSummary[]>;
}
