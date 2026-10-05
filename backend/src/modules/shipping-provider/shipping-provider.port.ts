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
  /**
   * T.11 + SEC-SDX-7: SOLO esto. `furtherInformation` = `Address.references` (≤ 70). 🔒💰 v1.80.12.8 (§19.28.11): gana
   * `reference` = «Pedido <folio>-<NN>» — NUESTRO folio, ⛔ nunca datos del cliente (lo arma el servicio).
   */
  to: { street1: string; name: string; company: string; phone: string; email: string; reference: string; furtherInformation?: string };
  package: { coverageCents: number; consignmentNote: string; packageType: string };
  /** `label:<shipmentId>:<rateId>` — que Skydropx lo respete es NO MEDIDO (§19.19.18). */
  idempotencyKey: string;
  /** 💰 v1.80.12.8 (§19.28.2): epoch ms; pasado el plazo ningún intento sale (`PurchaseDeadlineError`). */
  notAfter?: number;
}

export interface ProviderError {
  code: string;
  message: string;
  detail?: string;
}

export interface PurchaseResult {
  /**
   * 💰 v1.80.12.6 (§19.26.1, SDX-D-1): `null` ⇔ la respuesta no trae id LEGIBLE (ausente o vacío tras `trim`). ⛔ Nunca
   * `''`. Con id **y** `error` ⇒ «rechazo con id» (el servicio conserva el reclamo y persiste el id).
   */
  providerShipmentId: string | null;
  carrierName: string | null;
  /** `null` ⇒ «guía en proceso» (R5). */
  trackingNumber: string | null;
  /**
   * URLs CRUDAS de la respuesta, SIN validar. ⭐ v1.80.12.1 (§M4-SHIP.19.21.2, `C-SDX-7` (2)): se llaman `raw*` para que
   * nadie fuera de `shipping-provider/` pueda escribirlas por descuido — la ÚNICA lectora es `providerUrlsFrom`, que
   * devuelve `{ labelUrl, trackingUrl }` ya validadas (SEC-SDX-5). `labelUrl: result.labelUrl` deja de compilar.
   */
  rawLabelUrl: string | null;
  rawTrackingUrl: string | null;
  totalCents: number | null;
  insuranceCents: number | null;
  /** `error_detail.error_code ≠ null`: sin id ⇒ rechazo (se deshace el reclamo); CON id ⇒ «rechazo con id» (§19.26.1). */
  error: ProviderError | null;
  raw: unknown;
}

/**
 * 💰 v1.80.12.6 (§19.26.1) — el `PurchaseResult` de un `422` CON id (el id viaja en `details.providerShipmentId` del error):
 * sin URLs ni cifras. Vive aquí para que los campos `raw*` sigan sin escribirse fuera de `shipping-provider/` (`C-SDX-7` (2)).
 */
export function rejectedWithIdResult(providerShipmentId: string, error: ProviderError): PurchaseResult {
  return {
    providerShipmentId,
    carrierName: null,
    trackingNumber: null,
    rawLabelUrl: null,
    rawTrackingUrl: null,
    totalCents: null,
    insuranceCents: null,
    error,
    raw: null,
  };
}

export interface ProviderEvent {
  /** `null` ⇔ el valor crudo no es uno de los 12 ⇒ evento NO aplicado + log `unknown_carrier_status` (§19.19.10). */
  status: ProviderCarrierStatus | null;
  occurredAt: string | null;
  rawStatus: string;
  /**
   * ⭐ D2d (§19.3 `event.detail` / `branchName`; forma NO MEDIDA hasta `PG-1`, §19.19.10): texto del transportista y
   * sucursal, si vienen. ⛔ `detail` nunca va al cliente tal cual (lo lee solo la tarjeta del operador).
   */
  detail?: string | null;
  branchName?: string | null;
  /** Id propio del evento en Skydropx, si viene: la llave del evento lo usa antes que `estado:fecha` (§19.3 paso 3). */
  providerEventId?: string | null;
}

export interface ProviderShipmentState extends Omit<PurchaseResult, 'raw' | 'providerShipmentId'> {
  providerShipmentId: string;
  carrierStatus: ProviderCarrierStatus | null;
  /** Valor de estado que llegó y NO es uno de los 12 (log `unknown_carrier_status`). */
  unknownCarrierStatus: string | null;
  /** `updated_at` del estado, si viene (llave del evento sintético sin `now`, SEC-SDX-2). */
  statusUpdatedAt: string | null;
  /**
   * 🔒💰 v1.80.12.8 (§19.28.4): `folioTokenOf(address_to.reference)` del DETALLE — el token (`ENV-000045-01`), nunca el
   * texto crudo; `null` si no se lee. Lo usa la adopción cuando el listado no trajo el folio (PS-129, control positivo).
   */
  providerReference?: string | null;
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

/**
 * 💰 v1.80.12.7 (§19.27.4) + 🔒 v1.80.12.8 (§19.28.4): un envío del listado de Skydropx, para verificar una compra en
 * vuelo por SOLO LECTURA. `postalCodeTo` ⛔ solo para cuadrar en memoria (nunca al log, a BD ni a un DTO).
 */
export interface RecentProviderShipment {
  providerShipmentId: string;
  createdAt: string | null;
  carrierName: string | null;
  totalCents: number | null;
  postalCodeTo: string | null;
  /** `'api'` según la referencia §3.4; NO MEDIDO en el listado. */
  source: string | null;
  /** `error_detail.error_code ≠ null`. */
  hasError: boolean;
  /** `folioTokenOf(address_to.reference)` — el TOKEN (`ENV-000045-01`), nunca el texto crudo; `null` si no se lee. */
  providerReference: string | null;
}

export interface RecentShipmentsResult {
  /** Sobre reconocible en TODAS las páginas leídas. */
  readable: boolean;
  /** La lectura llegó, demostrablemente, hasta `createdFrom`. */
  coversFrom: boolean;
  shipments: RecentProviderShipment[];
}

export interface ShippingProviderPort {
  readonly name: 'skydropx';
  quote(input: QuoteInput): Promise<QuoteResult>;
  purchase(input: PurchaseInput): Promise<PurchaseResult>;
  getShipment(providerShipmentId: string): Promise<ProviderShipmentState>;
  cancel(providerShipmentId: string, reason: string): Promise<CancelResult>;
  protect?(providerShipmentId: string, coverageCents: number): Promise<void>;
  balance(): Promise<{ balanceCents: number; currency: 'MXN' }>;
  /** 💰 §19.27.4: `GET /api/v1/shipments` (⛔ siempre v1), ≤ `RECENT_SHIPMENTS_MAX_PAGES` páginas, sin `raw`. */
  recentShipments(createdFrom: Date): Promise<RecentShipmentsResult>;
  extraCharges(from: Date, to: Date): AsyncIterable<ProviderExtraCharge>;
  packagings?(): Promise<CatalogRow[]>;
  consignmentNote?(code: string): Promise<{ code: string; description: string } | null>;
  searchConsignmentNotes?(description: string): Promise<{ code: string; description: string }[]>;
  addressTemplates?(): Promise<AddressTemplateSummary[]>;
}
