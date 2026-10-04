/**
 * MOCK · SERVIDOR FALSO de la fase D de Skydropx (`docs/API_CONTRACT.md §M4-SHIP.19.19` v1.80.11 y
 * `§M4-SHIP.19.20` v1.80.12). // MOCK: pendiente de backend real (el cotizar/comprar no existe todavía).
 *
 * Replica la conducta OBSERVABLE del contrato —códigos de error, `details`, la puerta de compra, el CAS de
 * la dirección por `expectedAddressVersion`, la cotización que muere con la corrección— para que la
 * ventana «Capturar guía» se construya y se pruebe contra lo que el servidor va a responder. ⛔ La
 * pantalla NUNCA calcula un importe: aquí se calculan porque este módulo hace de servidor.
 *
 * Cifras: las MEDIDAS de `docs/specs/SKYDROPX_API_PROD_RESULTADOS.md` §4.4–§4.6 (14210→44100, paquete A,
 * seguro $2,500 ⇒ $25; Paquetexpress `total` 5125, `vat_fee` 690 ⇒ margen 10565 con MX$175 neto, el
 * ejemplo normativo de §19.19.11). 99minutos recomendada y más cara; J&T en `excluded.unavailable`; una de
 * sucursal (PuntoPost) plegada; un `planType` de promoción con `isPromo:true`.
 *
 * Dos licencias del servidor falso, dichas para que nadie las tome por conducta del real:
 *  - `SKYDROPX_ALLOW_SPEND` se da por **puesta** (aquí no hay dinero): la puerta queda en el dial y el rol.
 *  - La compra devuelve `labeled` al instante con un número inventado (`MOCK-…`). ⛔ Nada sale a la red.
 */
import type {
  AddressSnapshotDTO,
  AdminShipmentDTO,
  CancelShipmentLabelRes,
  CorrectShipmentAddressReq,
  CorrectShipmentAddressRes,
  DepartedResultDTO,
  DepartureBoardDTO,
  LabelAlertDTO,
  LabelOptionsDTO,
  LabelPendingDTO,
  PostalCodeDTO,
  ReleaseShipmentLabelRes,
  ShipmentAddressMissing,
  ShipmentLabelDTO,
  ShipmentLabelRequest,
  ShipmentLabelResponse,
  ShipmentQuoteDTO,
  ShipmentQuoteRequest,
  ShipmentRateDTO,
  ShipPreparationOrderDTO,
  ShippingBalanceDTO,
  ShippingCatalogsDTO,
  ShippingPackageDTO,
} from '@/types/contract';
import { ApiFixtureError, mockAdminShipments, mockSettings } from './fixtures';
import { mockCallerRole } from './m4-ship';

const SUPER = { userId: 'u-sa1', name: 'Dueño' };
const OPERATOR = { userId: 'u-op1', name: 'Operador Bóveda' };
const actor = () => (mockCallerRole() === 'super_admin' ? SUPER : OPERATOR);

// ────────────────────────────────────────────────────────────────────────────────────────────
// Catálogos fijos del servidor falso
// ────────────────────────────────────────────────────────────────────────────────────────────

/** `GET /geo/postal-codes/:cp` (§19.5): un catálogo local mínimo con los CP de los fixtures. */
const POSTAL_CODES: Record<string, Omit<PostalCodeDTO, 'postalCode' | 'source'>> = {
  '03100': { state: 'Ciudad de México', municipality: 'Benito Juárez', neighborhoods: ['Del Valle Centro', 'Del Valle', 'Del Valle Norte'] },
  '06600': { state: 'Ciudad de México', municipality: 'Cuauhtémoc', neighborhoods: ['Juárez'] },
  '14210': { state: 'Ciudad de México', municipality: 'Tlalpan', neighborhoods: ['Jardines de la Montaña', 'Parques del Pedregal'] },
  '37000': { state: 'Guanajuato', municipality: 'León', neighborhoods: ['León de los Aldama Centro'] },
  '44100': { state: 'Jalisco', municipality: 'Guadalajara', neighborhoods: ['Guadalajara Centro', 'Americana'] },
};

let packages: ShippingPackageDTO[] = [
  { code: 'envelope', label: 'Sobre', lengthCm: 25, widthCm: 18, heightCm: 3, weightKg: 1, providerPackageType: '5H4', active: true, sortOrder: 1 },
  { code: 'box', label: 'Caja', lengthCm: 49, widthCm: 23, heightCm: 21, weightKg: 5, providerPackageType: '4G', active: true, sortOrder: 2 },
  { code: 'tube', label: 'Tubo (retirado)', lengthCm: 40, widthCm: 8, heightCm: 8, weightKg: 1, providerPackageType: null, active: false, sortOrder: 3 },
];

const CHARGED = { grossCents: 20300, netCents: 17500 };
const INSURANCE = { insuredValueCents: 30000, coverageCents: 250000, costCents: 2500 };

/**
 * Una tarifa normalizada como la daría el servidor (§19.19.4): `priceCents = total + seguro`,
 * `netCost = price − iva`, `margin = cobrado neto − netCost`. `bump` simula otra dirección (la cotización
 * de la versión nueva cuesta distinto: así una cifra vieja en pantalla se delata).
 */
function rate(
  r: Omit<ShipmentRateDTO, 'priceCents' | 'netCostCents' | 'marginCents' | 'breakdown' | 'hidden' | 'ivaSource' | 'insuranceSource'> & {
    amount: number;
    extra: number;
    iva: number;
    fee: number;
  },
  bump: number,
): ShipmentRateDTO {
  const amount = r.amount + bump;
  const totalCents = amount + r.extra + r.iva + r.fee;
  const priceCents = totalCents + INSURANCE.costCents;
  const netCostCents = priceCents - r.iva;
  const { amount: _a, extra: _e, iva: _i, fee: _f, ...rest } = r;
  return {
    ...rest,
    priceCents,
    breakdown: { amountCents: amount, extraFeesCents: r.extra, ivaCents: r.iva, serviceFeeCents: r.fee, totalCents, insuranceCents: INSURANCE.costCents },
    ivaSource: 'provider',
    insuranceSource: 'quote',
    netCostCents,
    marginCents: CHARGED.netCents - netCostCents,
    hidden: r.deliveryKind === 'branch',
  };
}

/** Las tarifas MEDIDAS (PROD §4.5) con su seguro; el orden lo da el servidor (`priceCents` asc). */
export function buildMockRates(bump = 0): ShipmentRateDTO[] {
  const dropoff99 = mockSettings.shippingDropoffPoints?.ninetynineminutes ?? null;
  const rates = [
    rate({ rateId: 'rate-puntopost', carrierName: 'puntopost', carrierLabel: 'PuntoPost', serviceName: 'Sucursal a sucursal', amount: 80, extra: 0, iva: 13, fee: 26, days: 4, deliveryKind: 'branch', pickup: false, planType: null, isPromo: false, dropoff: null, recommended: false }, bump),
    rate({ rateId: 'rate-paquetexpress', carrierName: 'paquetexpress', carrierLabel: 'Paquetexpress', serviceName: 'Nacional', amount: 4250, extra: 62, iva: 690, fee: 123, days: 3, deliveryKind: 'home', pickup: true, planType: '50PESOS_30042026', isPromo: true, dropoff: null, recommended: false }, bump),
    rate({ rateId: 'rate-99min', carrierName: 'ninetynineminutes', carrierLabel: '99minutos', serviceName: 'Next Day Nacional', amount: 7200, extra: 0, iva: 1152, fee: 447, days: 2, deliveryKind: 'home', pickup: false, planType: 'ACQ_2026', isPromo: false, dropoff: dropoff99, recommended: true }, bump),
    rate({ rateId: 'rate-fedex', carrierName: 'fedex', carrierLabel: 'FedEx', serviceName: 'Express Saver', amount: 9000, extra: 73, iva: 1452, fee: 300, days: 2, deliveryKind: 'home', pickup: true, planType: null, isPromo: false, dropoff: null, recommended: false }, bump),
  ];
  return rates.sort((a, b) => a.priceCents - b.priceCents);
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// Estado vivo por envío
// ────────────────────────────────────────────────────────────────────────────────────────────

interface SdxShip {
  version: number;
  corrected: { at: string; by: { userId: string; name: string | null } } | null;
  /** Lo corregido (los campos de §19.20.1 + `city`/`state` canónicos). */
  override: Partial<AddressSnapshotDTO> & { references?: string | null };
  labelSource: 'skydropx' | 'manual' | null;
  label: ShipmentLabelDTO | null;
  labelPending: LabelPendingDTO | null;
  labelAlert: LabelAlertDTO | null;
}
const ships = new Map<string, SdxShip>();
const quotes = new Map<string, ShipmentQuoteDTO & { shipmentId: string; addressVersion: number }>();
let seq = 0;

function stateOf(id: string): SdxShip {
  let s = ships.get(id);
  if (!s) {
    s = { version: 0, corrected: null, override: {}, labelSource: null, label: null, labelPending: null, labelAlert: null };
    ships.set(id, s);
  }
  return s;
}

/** Reinicia el servidor falso (pruebas). */
export function resetMockSkydropx(): void {
  ships.clear();
  quotes.clear();
  seq = 0;
}

/** §19.19.7 — lo que la ventana puede ofrecer AL ACTOR. */
export function mockLabelOptions(): LabelOptionsDTO {
  const provider = mockSettings.shippingProvider ?? 'off';
  const purchase = mockSettings.shippingLabelPurchase ?? 'disabled';
  const role = mockCallerRole();
  const canPurchase =
    provider === 'skydropx' && (purchase === 'operators' || (purchase === 'super_admin_only' && role === 'super_admin'));
  return { provider, purchase, canPurchase };
}

function missingOf(snap: Partial<AddressSnapshotDTO>): ShipmentAddressMissing[] {
  const m: ShipmentAddressMissing[] = [];
  if (!(typeof snap.recipientName === 'string' && snap.recipientName.trim())) m.push('recipientName');
  if (!(typeof snap.line1 === 'string' && snap.line1.trim())) m.push('line1');
  if (!(typeof snap.neighborhood === 'string' && snap.neighborhood.trim())) m.push('neighborhood');
  if (!/^\d{5}$/.test(String(snap.postalCode ?? ''))) m.push('postalCode');
  if (!/^\d{10}$/.test(String(snap.phone ?? ''))) m.push('phone');
  return m;
}

/**
 * Decora la fila admin (`GET /admin/shipments/:id`) con lo de §19.19.7/§19.20: snapshot corregido,
 * `address`, `labelOptions`, `labelPending`, `labelAlert`, `labelSource`, `label`.
 */
export function mockDecorateAdminShipment(row: AdminShipmentDTO): AdminShipmentDTO {
  const s = ships.get(row.id);
  const snap = { ...(row.addressSnapshot ?? {}), ...(s?.override ?? {}) } as AddressSnapshotDTO;
  if (!('references' in snap)) (snap as Record<string, unknown>).references = null;
  const missing = missingOf(snap);
  return {
    ...row,
    addressSnapshot: snap,
    address: { complete: missing.length === 0, version: s?.version ?? 0, corrected: s?.corrected ?? null, ...(missing.length ? { missing } : {}) },
    labelOptions: mockLabelOptions(),
    labelSource: s?.labelSource ?? (row.trackingNumber ? 'manual' : null),
    label: s?.label ?? null,
    labelPending: s?.labelPending ?? null,
    labelAlert: s?.labelAlert ? { ...s.labelAlert, canRelease: s.labelAlert.kind === 'label_unknown' && mockCallerRole() === 'super_admin' } : null,
    carrierAlert: row.carrierAlert ?? null,
  };
}

/** Lo mismo para la tarjeta de «Preparar» (`ShipPreparationOrderDTO`). */
export function mockDecoratePrep(o: ShipPreparationOrderDTO): ShipPreparationOrderDTO {
  const s = ships.get(o.shipmentId);
  if (!s) return o;
  const { references: _r, ...over } = s.override;
  return {
    ...o,
    shipTo: { ...o.shipTo, ...(over as Partial<ShipPreparationOrderDTO['shipTo']>), addressCorrected: s.corrected !== null },
    labelPending: s.labelPending,
    labelAlert: s.labelAlert ? { ...s.labelAlert, canRelease: s.labelAlert.kind === 'label_unknown' && mockCallerRole() === 'super_admin' } : null,
  };
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// Verbos
// ────────────────────────────────────────────────────────────────────────────────────────────

export function mockPostalCode(cp: string): PostalCodeDTO {
  if (!/^\d{5}$/.test(cp)) throw new ApiFixtureError(400, 'VALIDATION_ERROR', 'postal code must be 5 digits', { field: 'cp' });
  const found = POSTAL_CODES[cp];
  if (!found) throw new ApiFixtureError(404, 'POSTAL_CODE_UNKNOWN', 'unknown postal code', { postalCode: cp });
  return { postalCode: cp, ...found, neighborhoods: [...found.neighborhoods], source: 'local' };
}

/** `PUT /admin/shipments/:id/address` — el algoritmo de §19.20.1 (guardas, CAS por versión, `unchanged`). */
export function mockCorrectAddress(row: AdminShipmentDTO, body: CorrectShipmentAddressReq): CorrectShipmentAddressRes {
  if (mockCallerRole() === 'customer') throw new ApiFixtureError(403, 'FORBIDDEN', 'forbidden');
  for (const [field, ok] of [
    ['recipientName', body.recipientName.trim().length >= 1 && body.recipientName.trim().length <= 120],
    ['line1', body.line1.trim().length >= 1 && body.line1.trim().length <= 200],
    ['postalCode', /^\d{5}$/.test(body.postalCode)],
    ['references', (body.references ?? '').length <= 70],
  ] as const) {
    if (!ok) throw new ApiFixtureError(400, 'VALIDATION_ERROR', `invalid ${field}`, { field });
  }
  const cp = POSTAL_CODES[body.postalCode];
  if (!cp) throw new ApiFixtureError(422, 'POSTAL_CODE_UNKNOWN', 'unknown postal code', { postalCode: body.postalCode });
  const canonical = cp.neighborhoods.find((n) => n.toLowerCase() === body.neighborhood.trim().toLowerCase());
  if (!canonical) {
    throw new ApiFixtureError(422, 'NEIGHBORHOOD_NOT_IN_POSTAL_CODE', 'neighborhood not in postal code', { postalCode: body.postalCode, allowed: cp.neighborhoods });
  }
  const s = stateOf(row.id);
  if (row.status !== 'picking') throw new ApiFixtureError(409, 'SHIPMENT_NOT_IN_PREPARATION', 'not in preparation', { status: row.status });
  if (s.labelSource) throw new ApiFixtureError(409, 'SHIPMENT_ALREADY_LABELED', 'already labeled', { labelSource: s.labelSource });
  if (s.labelPending) throw new ApiFixtureError(409, 'LABEL_IN_PROGRESS', 'label in progress');
  if (s.version !== body.expectedAddressVersion) {
    throw new ApiFixtureError(409, 'CONFLICT', 'address changed', { reason: 'address_changed', addressVersion: s.version });
  }
  const current = mockDecorateAdminShipment(row).addressSnapshot ?? ({} as AddressSnapshotDTO);
  const next = {
    recipientName: body.recipientName.trim(),
    line1: body.line1.trim(),
    line2: body.line2?.trim() || null,
    postalCode: body.postalCode,
    neighborhood: canonical,
    references: body.references?.trim() || null,
    city: cp.municipality,
    state: cp.state,
  };
  const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => (current[k] ?? null) !== next[k]);
  if (changed.length === 0) return { outcome: 'unchanged', shipment: mockDecorateAdminShipment(row) };
  s.override = { ...s.override, ...next };
  s.version += 1;
  s.corrected = { at: new Date().toISOString(), by: actor() };
  return { outcome: 'corrected', shipment: mockDecorateAdminShipment(row) };
}

function guardQuoteOrLabel(row: AdminShipmentDTO): void {
  if ((mockSettings.shippingProvider ?? 'off') !== 'skydropx') throw new ApiFixtureError(404, 'FEATURE_DISABLED', 'shipping provider off');
  const s = stateOf(row.id);
  if (row.status !== 'picking') throw new ApiFixtureError(409, 'SHIPMENT_NOT_IN_PREPARATION', 'not in preparation', { status: row.status });
  if (!row.preparedAt) throw new ApiFixtureError(409, 'SHIPMENT_NOT_PREPARED', 'not prepared');
  if (s.labelSource) throw new ApiFixtureError(409, 'SHIPMENT_ALREADY_LABELED', 'already labeled', { labelSource: s.labelSource });
}

/** `POST /admin/shipments/:id/quote` (§19.19.4): reusa una vigente de la misma versión y empaque. */
export function mockQuote(row: AdminShipmentDTO, body: ShipmentQuoteRequest): ShipmentQuoteDTO {
  guardQuoteOrLabel(row);
  const s = stateOf(row.id);
  if (s.labelPending) throw new ApiFixtureError(409, 'LABEL_IN_PROGRESS', 'label in progress');
  const missing = mockDecorateAdminShipment(row).address?.missing ?? [];
  if (missing.length) throw new ApiFixtureError(422, 'SHIPMENT_ADDRESS_INCOMPLETE', 'address incomplete', { missing });
  const pkgCode = body.packageCode ?? 'envelope';
  const pkg = packages.find((p) => p.code === pkgCode && p.active && p.providerPackageType);
  if (!pkg) throw new ApiFixtureError(409, 'SHIPPING_PROVIDER_NOT_CONFIGURED', 'packages', { missing: ['packages'] });
  if (!body.force) {
    for (const q of quotes.values()) {
      if (q.shipmentId === row.id && q.addressVersion === s.version && q.package.code === pkgCode && Date.parse(q.expiresAt) > Date.now()) {
        const { shipmentId: _s, addressVersion: _v, ...dto } = q;
        return { ...dto, reused: true };
      }
    }
  }
  seq += 1;
  const bump = s.version * 300 + (pkgCode === 'box' ? 1500 : 0);
  const rates = buildMockRates(bump);
  const now = new Date();
  const dto: ShipmentQuoteDTO = {
    quoteId: `q-${row.id}-${seq}`,
    providerQuotationId: `sdx-quo-${seq}`,
    requestedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 24 * 3600 * 1000).toISOString(),
    completed: true,
    reused: false,
    package: { code: pkg.code, label: pkg.label, lengthCm: pkg.lengthCm, widthCm: pkg.widthCm, heightCm: pkg.heightCm, weightKg: pkg.weightKg },
    insurance: { ...INSURANCE },
    charged: { ...CHARGED },
    recommendedRateId: rates.find((r) => r.recommended)?.rateId ?? null,
    rates,
    excluded: { unavailable: 1, noCoverage: 0, notApplicable: 0, multipackage: 0, breakdownMismatch: 0 },
  };
  quotes.set(dto.quoteId, { ...dto, shipmentId: row.id, addressVersion: s.version });
  return dto;
}

/** `POST /admin/shipments/:id/label` — §19.7 con la puerta de §19.19.7 y la versión de §19.20.1. */
export function mockPurchaseLabel(row: AdminShipmentDTO, body: ShipmentLabelRequest): ShipmentLabelResponse & { carrierName?: string } {
  guardQuoteOrLabel(row);
  const opts = mockLabelOptions();
  if (opts.purchase === 'disabled') throw new ApiFixtureError(404, 'FEATURE_DISABLED', 'label purchase disabled', { feature: 'label_purchase' });
  if (opts.purchase === 'super_admin_only' && mockCallerRole() !== 'super_admin') {
    throw new ApiFixtureError(403, 'FORBIDDEN', 'super admin only', { reason: 'label_purchase_super_admin_only' });
  }
  const s = stateOf(row.id);
  if (s.labelPending) return { outcome: 'in_progress', shipment: mockDecorateAdminShipment(row) };
  const q = quotes.get(body.quoteId);
  if (!q || q.shipmentId !== row.id) throw new ApiFixtureError(404, 'NOT_FOUND', 'quote not found');
  const r = q.rates.find((x) => x.rateId === body.rateId);
  if (!r) throw new ApiFixtureError(422, 'RATE_NOT_IN_QUOTE', 'rate not in quote');
  if (q.addressVersion !== s.version || Date.parse(q.expiresAt) <= Date.now()) {
    const fresh = mockQuote(row, { packageCode: q.package.code });
    throw new ApiFixtureError(409, 'QUOTE_EXPIRED', 'quote expired', {
      quote: fresh,
      reason: q.addressVersion !== s.version ? 'address_changed' : 'expired',
    });
  }
  if (r.priceCents !== body.expectedPriceCents || r.marginCents !== body.expectedMarginCents) {
    throw new ApiFixtureError(409, 'LABEL_PREVIEW_STALE', 'preview stale', { priceCents: r.priceCents, marginCents: r.marginCents });
  }
  const required: string[] = [];
  if (r.marginCents < 0 && !body.confirmNegativeMargin) required.push('negative_margin');
  if (r.deliveryKind === 'branch' && !body.confirmBranchDelivery) required.push('branch_delivery');
  if (required.length) throw new ApiFixtureError(422, 'LABEL_CONFIRMATION_REQUIRED', 'confirmation required', { required, marginCents: r.marginCents });
  seq += 1;
  const now = new Date().toISOString();
  const recommended = q.rates.find((x) => x.recommended) ?? null;
  const label: ShipmentLabelDTO = {
    source: 'skydropx',
    providerShipmentId: `sdx-shp-${seq}`,
    carrierName: r.carrierName,
    serviceName: r.serviceName,
    trackingNumber: `MOCK${String(100000 + seq)}`,
    trackingUrl: null,
    labelAvailable: true,
    purchasedAt: now,
    chosenBy: actor(),
    chosenAt: now,
    chosen: r,
    recommended,
    wasRecommended: r.recommended,
    cost: { grossCents: r.priceCents, ivaCents: r.breakdown.ivaCents, ivaSource: r.ivaSource, insuranceCents: r.breakdown.insuranceCents, netCents: r.netCostCents, marginCents: r.marginCents },
    carrierStatus: 'created',
    carrierStatusAt: now,
    processing: false,
    canceledAt: null,
    cancelReason: null,
  };
  s.labelSource = 'skydropx';
  s.label = label;
  const idx = mockAdminShipments.findIndex((x) => x.id === row.id);
  if (idx >= 0) mockAdminShipments[idx] = { ...mockAdminShipments[idx], carrier: r.carrierLabel, trackingNumber: label.trackingNumber, status: 'guia' };
  return { outcome: 'labeled', shipment: mockDecorateAdminShipment({ ...row, status: 'guia', carrier: r.carrierLabel, trackingNumber: label.trackingNumber }), label, carrierName: r.carrierName };
}

/** `POST /admin/shipments/:id/label/cancel` (§19.8). */
export function mockCancelLabel(row: AdminShipmentDTO): CancelShipmentLabelRes {
  const s = stateOf(row.id);
  if (s.labelSource !== 'skydropx' || !s.label) throw new ApiFixtureError(409, 'LABEL_NOT_CANCELLABLE', 'not provider', { reason: 'not_provider' });
  if (s.label.carrierStatus && s.label.carrierStatus !== 'created') {
    throw new ApiFixtureError(409, 'LABEL_NOT_CANCELLABLE', 'already picked up', { reason: 'already_picked_up', carrierStatus: s.label.carrierStatus });
  }
  s.labelSource = null;
  s.label = null;
  s.labelAlert = null;
  const idx = mockAdminShipments.findIndex((x) => x.id === row.id);
  if (idx >= 0) mockAdminShipments[idx] = { ...mockAdminShipments[idx], carrier: null, trackingNumber: null, status: 'picking' };
  return { outcome: 'cancelled', shipment: mockDecorateAdminShipment({ ...row, status: 'picking', carrier: null, trackingNumber: null }) };
}

/** `POST /admin/shipments/:id/label/release` (§19.18.4, súper-admin). */
export function mockReleaseLabel(row: AdminShipmentDTO): ReleaseShipmentLabelRes {
  if (mockCallerRole() !== 'super_admin') throw new ApiFixtureError(403, 'MONEY_OUT_FORBIDDEN', 'super admin only');
  const s = stateOf(row.id);
  if (!s.labelPending) throw new ApiFixtureError(409, 'LABEL_NOT_RELEASABLE', 'not in progress', { reason: 'not_in_progress' });
  s.labelPending = null;
  s.labelAlert = null;
  return { outcome: 'released', shipment: mockDecorateAdminShipment(row) };
}

/** Siembra un estado de guía (demo y pruebas): compra en vuelo, en proceso o una alerta. */
export function mockSeedLabelState(shipmentId: string, patch: Partial<Pick<SdxShip, 'labelPending' | 'labelAlert' | 'labelSource' | 'label'>>): void {
  Object.assign(stateOf(shipmentId), patch);
}

export function mockShippingPackages(): ShippingPackageDTO[] {
  return packages.map((p) => ({ ...p })).sort((a, b) => a.sortOrder - b.sortOrder);
}
export function mockPutShippingPackages(next: ShippingPackageDTO[]): ShippingPackageDTO[] {
  if (mockCallerRole() !== 'super_admin') throw new ApiFixtureError(403, 'FORBIDDEN', 'super admin only');
  if (next.some((p) => !Number.isInteger(p.weightKg) || p.weightKg < 1)) throw new ApiFixtureError(400, 'VALIDATION_ERROR', 'weightKg', { field: 'weightKg' });
  if (!next.some((p) => p.active && p.providerPackageType)) throw new ApiFixtureError(422, 'VALIDATION_ERROR', 'no active package', { field: 'packages' });
  packages = next.map((p) => ({ ...p }));
  return mockShippingPackages();
}

export function mockShippingCatalogs(): ShippingCatalogsDTO {
  const code = mockSettings.shippingConsignmentNote ?? '49101600';
  return {
    packagings: [
      { code: '4G', name: 'Caja de cartón' },
      { code: '5H4', name: 'Saco (bolsa) de película de plástico' },
    ],
    consignmentNote: code === '49101600' ? { code, description: 'Coleccionables' } : null,
    addressTemplates: [{ id: 'tpl-verapaz', alias: 'Verapaz', addressType: 'from', isDefault: true, postalCode: '14210' }],
  };
}
export function mockSearchConsignmentNotes(description: string): { code: string; description: string }[] {
  const all = [
    { code: '49101600', description: 'Coleccionables' },
    { code: '55101500', description: 'Publicaciones impresas' },
  ];
  const q = description.trim().toLowerCase();
  return all.filter((c) => c.description.toLowerCase().includes(q));
}
export function mockShippingBalance(): ShippingBalanceDTO {
  const thresholdCents = mockSettings.skydropxLowBalanceCents ?? 50000;
  const balanceCents = 96516; // PROD §5.4: $965.16
  return { balanceCents, currency: 'MXN', lowBalance: balanceCents < thresholdCents, thresholdCents, fetchedAt: new Date().toISOString() };
}

/** `GET /admin/shipments/departure` (§19.9): guía Skydropx y sin salir, agrupadas por paquetería. */
export function mockDepartureBoard(liveStatus: (id: string) => string | null): DepartureBoardDTO {
  const preferred = mockSettings.shippingPreferredCarriers?.[0] ?? null;
  const groups = new Map<string, DepartureBoardDTO['groups'][number]>();
  for (const [id, s] of ships) {
    if (s.labelSource !== 'skydropx' || !s.label?.trackingNumber) continue;
    const row = mockAdminShipments.find((x) => x.id === id);
    if (!row || (liveStatus(id) ?? row.status) !== 'guia') continue;
    const name = s.label.carrierName;
    if (!groups.has(name)) {
      groups.set(name, {
        carrierName: name,
        carrierLabel: s.label.chosen.carrierLabel,
        dropoff: mockSettings.shippingDropoffPoints?.[name] ?? null,
        isPreferred: name === preferred,
        shipments: [],
      });
    }
    const snap = mockDecorateAdminShipment(row).addressSnapshot;
    groups.get(name)!.shipments.push({
      shipmentId: id,
      orderNumber: row.orderNumber ?? null,
      kind: row.kind ?? (row.orderId ? 'guest_direct_ship' : 'vault_withdrawal'),
      recipientName: String(snap?.recipientName ?? ''),
      city: String(snap?.city ?? ''),
      trackingNumber: s.label.trackingNumber,
      labelAvailable: s.label.labelAvailable,
      labelPurchasedAt: s.label.purchasedAt,
    });
  }
  const sorted = [...groups.values()].sort((a, b) => Number(b.isPreferred) - Number(a.isPreferred) || a.carrierName.localeCompare(b.carrierName));
  const manualPending = mockAdminShipments.filter((x) => (liveStatus(x.id) ?? x.status) === 'guia' && ships.get(x.id)?.labelSource !== 'skydropx').length;
  return { date: new Date().toISOString().slice(0, 10), groups: sorted, manualPending };
}

export function mockDeparted(ids: string[], ship: (id: string) => void): DepartedResultDTO {
  return {
    results: ids.map((id) => {
      const row = mockAdminShipments.find((x) => x.id === id);
      if (!row) return { shipmentId: id, outcome: 'rejected' as const, code: 'NOT_FOUND' };
      if (row.status === 'enviado' || row.status === 'entregado') return { shipmentId: id, outcome: 'already_shipped' as const };
      ship(id);
      return { shipmentId: id, outcome: 'shipped' as const };
    }),
  };
}
