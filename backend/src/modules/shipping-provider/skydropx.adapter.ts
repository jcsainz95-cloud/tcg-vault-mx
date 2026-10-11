/**
 * skydropx.adapter.ts — 💰 `SkydropxAdapter`: el puerto sobre el cliente HTTP (API_CONTRACT §M4-SHIP.19.4 con los
 * deltas de §19.19.4 (cotizar), §19.19.8 (comprar), §19.19.10 (rastreo), §19.4 (5)(7) (redacción y log)).
 *
 * - `quote`: `POST /api/v1/quotations` ⇒ sondeo `GET /quotations/{id}` cada 1.5 s hasta `is_completed` o 20 s; eco
 *   del seguro (M-5); normalización exacta y filtro con contadores (`rate-normalization.ts`).
 * - `purchase`/`cancel`/`protect`: SOLO por `client.mutate()` (la puerta de compra, PS-99).
 * - Parsers TOLERANTES (la forma de comprar y de `GET /shipments/{id}` es NO MEDIDA, M-20): campo ausente ⇒ `null`,
 *   ⛔ nunca un `500`.
 * - Lo que devuelve como `raw` va YA redactado por lista blanca.
 */
import { Logger } from '@nestjs/common';
import { decimalToCents } from './decimal-cents';
import { ProviderLogger, SkydropxClient } from './http/skydropx-client';
import { Clock, systemClock } from './http/token-bucket';
import { insuranceEchoOf, normalizeRates } from './rate-normalization';
import { redactProviderPayload } from './redact';
import { ShippingProviderError, ShippingProviderPurchaseInFlightError } from './shipping-provider.errors';
import { folioTokenOf } from './folio-token';
import {
  AddressTemplateSummary,
  CancelResult,
  CARRIER_STATUSES,
  CatalogRow,
  ProviderCarrierStatus,
  ProviderEvent,
  ProviderExtraCharge,
  ProviderShipmentState,
  PurchaseInput,
  PurchaseResult,
  QuoteInput,
  QuoteResult,
  RecentProviderShipment,
  RecentShipmentsResult,
  ShippingProviderPort,
} from './shipping-provider.port';

export const QUOTE_POLL_INTERVAL_MS = 1_500;
/** 💰 §19.27.4: páginas máximas del listado de envíos por lectura (20 por página). */
export const RECENT_SHIPMENTS_MAX_PAGES = 3;
export const RECENT_SHIPMENTS_PER_PAGE = 20;
/**
 * 💰 §19.27.7: ¿el listado viene ordenado por `created_at` desc? NO MEDIDO (la cuenta nunca compró) ⇒ `false`: `coversFrom`
 * solo por `total_count`. Lo enciende una errata del arquitecto con la medición (`M-PRD-7`). Lo re-exporta
 * `shipments/label-verify.constants.ts` (un solo valor, dos lectores).
 */
export const RECENT_SHIPMENTS_ORDER_VERIFIED = false;
export const QUOTE_POLL_TIMEOUT_MS = 20_000;
const MAX_PAGES = 200;

export interface SkydropxAdapterOptions {
  client: SkydropxClient;
  clock?: Clock;
  logger?: ProviderLogger;
}

type Obj = Record<string, unknown>;

function asObj(v: unknown): Obj | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null;
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}
function idOf(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  const s = str(v);
  // 💰 §19.26.1: id LEGIBLE = no vacío tras `trim` (⛔ nunca se persiste `''` ni espacios).
  return s && s.trim() !== '' ? s.trim() : null;
}

function assertPositiveInt(name: string, v: number): void {
  if (!Number.isInteger(v) || v < 1) throw new Error(`${name} debe ser entero ≥ 1 (recibido ${v})`);
}

/** Cuerpo de `POST /api/v1/quotations` (§19.19.4). Seguro SIEMPRE explícito (§19.19.5, M-8). */
export function buildQuotationBody(input: QuoteInput): Record<string, unknown> {
  assertPositiveInt('coverageCents', input.parcel.coverageCents);
  assertPositiveInt('weightKg', input.parcel.weightKg);
  return {
    quotation: {
      address_from:
        'address' in input.from
          ? {
              country_code: 'MX',
              postal_code: input.from.address.postalCode,
              area_level1: input.from.address.state,
              area_level2: input.from.address.city,
              area_level3: input.from.address.neighborhood,
            }
          : { address_template_id: input.from.templateId },
      address_to: {
        country_code: 'MX',
        postal_code: input.to.postalCode,
        area_level1: input.to.state,
        area_level2: input.to.city,
        area_level3: input.to.neighborhood,
      },
      parcels: [
        {
          length: input.parcel.lengthCm,
          width: input.parcel.widthCm,
          height: input.parcel.heightCm,
          weight: input.parcel.weightKg,
          package_protected: true,
          declared_value: input.parcel.coverageCents / 100,
        },
      ],
    },
  };
}

/** Cuerpo de `POST /api/v2/shipments` (§19.19.8). PII saliente = exactamente la de T.11 + SEC-SDX-7. */
export function buildPurchaseBody(input: PurchaseInput): Record<string, unknown> {
  assertPositiveInt('coverageCents', input.package.coverageCents);
  let addressFrom: Obj;
  if ('address' in input.from) {
    // ⭐ rev BSD-1 (§BSD.3): el remitente EXPLÍCITO (el vendedor), sin plantilla. ⚠️ NM-2: NO MEDIDO contra Skydropx.
    const a = input.from.address;
    addressFrom = {
      street1: a.street1,
      name: a.name,
      company: a.company,
      phone: a.phone,
      email: a.email,
      postal_code: a.postalCode,
      area_level1: a.areaLevel1,
      area_level2: a.areaLevel2,
      area_level3: a.areaLevel3,
      country_code: 'MX',
    };
    if (a.furtherInformation) addressFrom.further_information = a.furtherInformation;
  } else {
    addressFrom = { address_template_id: input.from.templateId };
  }
  if (!('address' in input.from) && input.from.snapshot) {
    const s = input.from.snapshot;
    Object.assign(addressFrom, {
      street1: s.street1,
      name: s.name,
      company: s.company,
      phone: s.phone,
      email: s.email,
      reference: s.reference,
    });
  }
  const addressTo: Obj = {
    street1: input.to.street1,
    name: input.to.name,
    company: input.to.company,
    phone: input.to.phone,
    email: input.to.email,
    // 🔒💰 v1.80.12.8 (§19.28.1): NUESTRO folio por intento — «Pedido ENV-000045-01». ⛔ Nunca datos del cliente.
    reference: input.to.reference,
  };
  if (input.to.furtherInformation) addressTo.further_information = input.to.furtherInformation;
  // ⭐ rev BSD-1: el destino explícito (la tienda) de la guía de entrada; en salida estas claves no existen (sin cambio).
  if (input.to.postalCode !== undefined) {
    Object.assign(addressTo, {
      postal_code: input.to.postalCode,
      area_level1: input.to.areaLevel1 ?? '',
      area_level2: input.to.areaLevel2 ?? '',
      area_level3: input.to.areaLevel3 ?? '',
      country_code: 'MX',
    });
  }
  return {
    shipment: {
      rate_id: input.rateId,
      printing_format: input.printingFormat,
      address_from: addressFrom,
      address_to: addressTo,
      packages: [
        {
          package_number: '1',
          package_protected: true,
          declared_value: input.package.coverageCents / 100,
          consignment_note: input.package.consignmentNote,
          package_type: input.package.packageType,
        },
      ],
    },
  };
}

interface ParsedShipment {
  id: string | null;
  attrs: Obj;
  pkg: Obj;
  /** 🔒 §19.28.1: la dirección de DESTINO, por RELACIÓN (`relationships.address_to.data.id`), ⛔ nunca por posición. */
  addressTo: Obj | null;
}

/**
 * UN recurso de envío (`data[i]`) con el `included` compartido (§19.28.1: «una entrada por recurso»). El paquete es el
 * primer `package(s)` relacionado (forma NO MEDIDA, tolerante); la dirección de destino se busca por la relación
 * `address_to` — la primera dirección de `included` puede ser la de ORIGEN (cuya `reference` es de nuestra plantilla).
 */
function parseShipmentResource(dataObj: Obj, included: readonly unknown[]): ParsedShipment {
  const attrs = asObj(dataObj.attributes) ?? dataObj;
  const inc = included.map(asObj).filter((i): i is Obj => i !== null);
  const rel = (name: string): Obj | null => asObj(asObj(asObj(dataObj.relationships)?.[name])?.data);
  const pkgRel = rel('packages') ?? rel('package');
  const pkgEntry =
    (pkgRel ? inc.find((i) => (i.type === 'package' || i.type === 'packages') && idOf(i.id) === idOf(pkgRel.id)) : undefined) ??
    inc.find((i) => i.type === 'package' || i.type === 'packages') ??
    null;
  const pkg = asObj(pkgEntry?.attributes) ?? pkgEntry ?? {};
  const toRel = rel('address_to');
  const toId = toRel ? idOf(toRel.id) : null;
  const toEntry = toId ? inc.find((i) => (i.type === 'address' || i.type === 'addresses') && idOf(i.id) === toId) ?? null : null;
  return { id: idOf(dataObj.id), attrs, pkg, addressTo: toEntry ? (asObj(toEntry.attributes) ?? toEntry) : null };
}

/** Objeto o arreglo (v2 «siempre arreglo», NO MEDIDO) ⇒ el primero; JSON:API `data.attributes` + `included`. EL parser. */
function parseShipmentEnvelope(json: unknown): ParsedShipment {
  let root: unknown = json;
  if (Array.isArray(root)) root = root[0];
  const rootObj = asObj(root) ?? {};
  let data: unknown = 'data' in rootObj ? rootObj.data : rootObj;
  if (Array.isArray(data)) data = data[0];
  const included = Array.isArray(rootObj.included) ? rootObj.included : [];
  return parseShipmentResource(asObj(data) ?? {}, included);
}

function firstStr(...vals: unknown[]): string | null {
  for (const v of vals) {
    const s = str(v);
    if (s) return s;
  }
  return null;
}

function purchaseFields(p: ParsedShipment): Omit<PurchaseResult, 'providerShipmentId' | 'raw'> {
  const { attrs, pkg } = p;
  const ed = asObj(attrs.error_detail);
  const errorCode = ed && ed.error_code !== null && ed.error_code !== undefined ? String(ed.error_code) : null;
  return {
    carrierName: firstStr(attrs.carrier_name, pkg.carrier_name),
    trackingNumber: firstStr(attrs.master_tracking_number, pkg.tracking_number),
    rawLabelUrl: firstStr(pkg.label_url, attrs.label_url),
    rawTrackingUrl: firstStr(pkg.tracking_url_provider, pkg.tracking_url, attrs.tracking_url_provider, attrs.tracking_url),
    totalCents: decimalToCents(attrs.total),
    insuranceCents: decimalToCents(attrs.protection_value_total ?? pkg.protection_value),
    error: errorCode
      ? {
          code: errorCode,
          message: str(ed?.error_message) ?? '',
          ...(str(ed?.error_message_detail) ? { detail: str(ed?.error_message_detail) as string } : {}),
        }
      : null,
  };
}

function asCarrierStatus(v: string): ProviderCarrierStatus | null {
  return (CARRIER_STATUSES as readonly string[]).includes(v) ? (v as ProviderCarrierStatus) : null;
}

function eventsFrom(...candidates: unknown[]): ProviderEvent[] {
  for (const c of candidates) {
    if (!Array.isArray(c)) continue;
    const out: ProviderEvent[] = [];
    for (const raw of c) {
      const e = asObj(raw);
      if (!e) continue;
      const rawStatus = firstStr(e.status, e.tracking_status, e.code);
      if (!rawStatus) continue;
      // ⭐ D2d (§19.3): tolerante — forma NO MEDIDA hasta PG-1 (§19.19.10); ausente ⇒ la llave no se pone, ⛔ nunca un `500`.
      const detail = firstStr(e.description, e.detail, e.details, e.message);
      const branchName = firstStr(e.branch_name, e.office_name, e.location);
      const providerEventId = idOf(e.id);
      out.push({
        status: asCarrierStatus(rawStatus),
        rawStatus,
        occurredAt: firstStr(e.occurred_at, e.date, e.created_at, e.updated_at),
        ...(detail ? { detail } : {}),
        ...(branchName ? { branchName } : {}),
        ...(providerEventId ? { providerEventId } : {}),
      });
    }
    return out;
  }
  return [];
}

/**
 * ⭐ v1.80.12.1 (API_CONTRACT §M4-SHIP.19.21.6): el campo del reembolso de la cancelación (`refunded_amount` /
 * `refund_amount`) es NO MEDIDO hasta `PG-3`. Mientras esto sea `false`, todo `refundedCents ≠ null` deja un log
 * `warn cancel_refund_unverified`. `PG-3` lo confirma ⇒ se pasa a `true` (con la cita de la medición) y el log calla.
 */
export const CANCEL_REFUND_FIELD_VERIFIED = false;

function refundedCentsOf(json: unknown): number | null {
  const p = parseShipmentEnvelope(json);
  const root = asObj(Array.isArray(json) ? json[0] : json) ?? {};
  for (const v of [p.attrs.refunded_amount, p.attrs.refund_amount, root.refunded_amount, root.refund_amount]) {
    if (v === null || v === undefined) continue;
    const c = decimalToCents(v);
    if (c !== null) return c;
  }
  return null;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export class SkydropxAdapter implements ShippingProviderPort {
  readonly name = 'skydropx' as const;
  private readonly client: SkydropxClient;
  private readonly clock: Clock;
  private readonly logger: ProviderLogger;

  constructor(options: SkydropxAdapterOptions) {
    this.client = options.client;
    this.clock = options.clock ?? systemClock;
    this.logger = options.logger ?? new Logger('SkydropxAdapter');
  }

  async quote(input: QuoteInput): Promise<QuoteResult> {
    const created = await this.client.createQuotation(buildQuotationBody(input));
    let q = asObj(created.json);
    const id = q ? idOf(q.id) : null;
    if (!q || !id) throw ShippingProviderError.error('quote', created.status, 'no_id');
    const started = this.clock.now();
    while (q.is_completed !== true && this.clock.now() + QUOTE_POLL_INTERVAL_MS - started <= QUOTE_POLL_TIMEOUT_MS) {
      await this.clock.sleep(QUOTE_POLL_INTERVAL_MS);
      const polled = await this.client.get('quote_poll', `/quotations/${encodeURIComponent(id)}`, { quotationId: id });
      q = asObj(polled.json) ?? q;
    }
    const echo = insuranceEchoOf(q.packages, input.parcel.coverageCents);
    if (!echo.ok) {
      this.logger.warn(
        `skydropx quote_insurance_echo_mismatch quotationId=${id} coverage=${input.parcel.coverageCents} ` +
          `echoedProtected=${echo.echoedProtected} echoed=${echo.echoedDeclaredValueCents}`,
      );
    }
    const { rates, excluded } = normalizeRates(q.rates, {
      insuranceEchoOk: echo.ok,
      onBreakdownMismatch: (rateId) =>
        this.logger.warn(`skydropx rate_breakdown_mismatch quotationId=${id} rateId=${rateId}`),
    });
    return {
      providerQuotationId: id,
      completed: q.is_completed === true,
      rates,
      excluded,
      insuranceEcho: echo,
      raw: redactProviderPayload(q),
    };
  }

  async purchase(input: PurchaseInput): Promise<PurchaseResult> {
    let res;
    try {
      res = await this.client.mutate({
        op: 'purchase',
        body: buildPurchaseBody(input),
        idempotencyKey: input.idempotencyKey,
        ...(input.notAfter !== undefined ? { notAfter: input.notAfter } : {}),
      });
    } catch (err) {
      // 💰 §19.26.1: un `400/422` de la compra que trae id LEGIBLE no se descarta — el id llega al servicio en
      // `details.providerShipmentId` (EL mismo parser de sobre) y va a «rechazo con id».
      if (err instanceof ShippingProviderError && err.code === 'SHIPPING_PROVIDER_REJECTED' && err.providerBody !== undefined) {
        const id = parseShipmentEnvelope(err.providerBody).id;
        if (id) {
          const withId = new ShippingProviderError(err.code, err.httpStatus, { ...err.details, providerShipmentId: id }, err.message);
          throw withId;
        }
      }
      throw err;
    }
    const parsed = parseShipmentEnvelope(res.json);
    const fields = purchaseFields(parsed);
    if (!parsed.id && !fields.error) {
      // 2xx sin id y sin error: no sabemos si se creó ⇒ «compra en vuelo» (⛔ no se reintenta).
      throw new ShippingProviderPurchaseInFlightError(ShippingProviderError.error('purchase', res.status, 'no_id'));
    }
    // ⛔ Nunca `''`: sin id legible ⇒ `null` (con `error` ⇒ rechazo sin id; el servicio deshace el reclamo).
    return { providerShipmentId: parsed.id, ...fields, raw: redactProviderPayload(res.json) };
  }

  async getShipment(providerShipmentId: string): Promise<ProviderShipmentState> {
    const res = await this.client.get('shipment', `/shipments/${encodeURIComponent(providerShipmentId)}`, {
      providerShipmentId,
    });
    const parsed = parseShipmentEnvelope(res.json);
    const fields = purchaseFields(parsed);
    const { attrs, pkg } = parsed;
    const rawStatus = firstStr(pkg.tracking_status, pkg.status, attrs.tracking_status, attrs.shipment_status, attrs.status);
    const carrierStatus = rawStatus ? asCarrierStatus(rawStatus) : null;
    const unknownCarrierStatus = rawStatus && !carrierStatus ? rawStatus : null;
    if (unknownCarrierStatus) {
      this.logger.warn(`skydropx unknown_carrier_status providerShipmentId=${providerShipmentId} value=${unknownCarrierStatus}`);
    }
    return {
      providerShipmentId: parsed.id ?? providerShipmentId,
      ...fields,
      carrierStatus,
      unknownCarrierStatus,
      statusUpdatedAt: firstStr(pkg.updated_at, attrs.updated_at),
      events: eventsFrom(pkg.tracking_events, pkg.events, attrs.tracking_events, attrs.events),
      providerReference: parsed.addressTo ? folioTokenOf(firstStr(parsed.addressTo.reference)) : null,
      raw: redactProviderPayload(res.json),
    };
  }

  async cancel(providerShipmentId: string, reason: string): Promise<CancelResult> {
    try {
      const res = await this.client.mutate({ op: 'cancel', providerShipmentId, body: { reason } });
      const refundedCents = refundedCentsOf(res.json);
      if (refundedCents !== null && !CANCEL_REFUND_FIELD_VERIFIED) {
        this.logger.warn(`skydropx cancel_refund_unverified providerShipmentId=${providerShipmentId} refundedCents=${refundedCents}`);
      }
      return { ok: true, refundedCents };
    } catch (err) {
      if (err instanceof ShippingProviderError && err.code === 'SHIPPING_PROVIDER_REJECTED') {
        return {
          ok: false,
          code: (err.details.providerCode as string | null) ?? 'rejected',
          message: (err.details.providerMessage as string | null) ?? '',
        };
      }
      throw err;
    }
  }

  async protect(providerShipmentId: string, coverageCents: number): Promise<void> {
    assertPositiveInt('coverageCents', coverageCents);
    await this.client.mutate({
      op: 'protect',
      providerShipmentId,
      body: { package_protected: true, declared_value: coverageCents / 100 },
    });
  }

  async balance(): Promise<{ balanceCents: number; currency: 'MXN' }> {
    const res = await this.client.get('balance', '/finance/credits');
    const data = asObj(asObj(res.json)?.data);
    const balanceCents = data ? decimalToCents(data.balance) : null;
    if (balanceCents === null || data?.currency !== 'MXN') {
      throw ShippingProviderError.error('balance', res.status, 'unexpected_shape');
    }
    return { balanceCents, currency: 'MXN' };
  }

  /**
   * 💰 §19.27.4 + §19.28.1/.4 — los envíos RECIENTES, para verificar una compra en vuelo por SOLO LECTURA. ⛔ Siempre la
   * ruta **v1** (`/api/v2/shipments` es la de compra y solo debe aparecer en `mutate`, PS-99 (d)). Cada elemento por EL
   * parser de sobre (por recurso, con el `included` compartido); el folio de la dirección de destino por relación. ⛔ Sin
   * `raw`: el listado trae direcciones (PII) y no se guarda ni se loguea.
   */
  async recentShipments(createdFrom: Date): Promise<RecentShipmentsResult> {
    const shipments: RecentProviderShipment[] = [];
    let readable = true;
    let coversFrom = false;
    let read = 0;
    for (let page = 1; page <= RECENT_SHIPMENTS_MAX_PAGES; page += 1) {
      const res = await this.client.get('recent_shipments', `/shipments?page=${page}&per_page=${RECENT_SHIPMENTS_PER_PAGE}`);
      const root = asObj(res.json);
      if (!root || !Array.isArray(root.data)) {
        readable = false;
        break;
      }
      const included = Array.isArray(root.included) ? root.included : [];
      for (const item of root.data) {
        const obj = asObj(item);
        if (!obj) continue;
        const p = parseShipmentResource(obj, included);
        if (!p.id) continue;
        const ed = asObj(p.attrs.error_detail);
        shipments.push({
          providerShipmentId: p.id,
          createdAt: firstStr(p.attrs.created_at),
          carrierName: firstStr(p.attrs.carrier_name, p.pkg.carrier_name),
          totalCents: decimalToCents(p.attrs.total),
          postalCodeTo: p.addressTo ? firstStr(p.addressTo.postal_code, p.addressTo.zip, p.addressTo.zip_code) : null,
          source: firstStr(p.attrs.source),
          hasError: !!ed && ed.error_code !== null && ed.error_code !== undefined,
          providerReference: p.addressTo ? folioTokenOf(firstStr(p.addressTo.reference)) : null,
        });
      }
      read += root.data.length;
      const meta = asObj(root.meta);
      const totalCount = meta && typeof meta.total_count === 'number' ? meta.total_count : null;
      if (totalCount !== null && totalCount <= read) {
        coversFrom = true;
        break;
      }
      const last = shipments[shipments.length - 1];
      if (RECENT_SHIPMENTS_ORDER_VERIFIED && last?.createdAt && Date.parse(last.createdAt) < createdFrom.getTime()) {
        coversFrom = true;
        break;
      }
      if (root.data.length === 0) break;
    }
    return { readable, coversFrom: readable && coversFrom, shipments };
  }

  async *extraCharges(from: Date, to: Date): AsyncIterable<ProviderExtraCharge> {
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const qs = new URLSearchParams({
        page: String(page),
        per_page: '50',
        start_date: ymd(from),
        end_date: ymd(to),
      }).toString();
      const res = await this.client.get('extra_charges', `/finance/extra-charges?${qs}`);
      const root = asObj(res.json) ?? {};
      const data = Array.isArray(root.data) ? root.data : Array.isArray(res.json) ? (res.json as unknown[]) : [];
      for (const raw of data) {
        const item = asObj(raw);
        if (!item) continue;
        const attrs = asObj(item.attributes) ?? item;
        const providerChargeId = idOf(item.id) ?? idOf(attrs.id);
        const amountCents = decimalToCents(attrs.amount);
        if (!providerChargeId || amountCents === null) {
          this.logger.warn('skydropx extra_charge_unreadable (sin id o sin importe): se omite');
          continue;
        }
        yield {
          providerChargeId,
          providerShipmentId: idOf(attrs.shipment_id),
          trackingNumber: str(attrs.tracking_number),
          amountCents,
          chargeType: str(attrs.charge_type),
          chargedAt: firstStr(attrs.charged_at, attrs.created_at, attrs.date),
          status: str(attrs.status),
        };
      }
      const meta = asObj(root.meta);
      const next = meta && typeof meta.next_page === 'number' ? meta.next_page : null;
      if (data.length === 0 || next === null || next <= page) return;
    }
  }

  async packagings(): Promise<CatalogRow[]> {
    const out: CatalogRow[] = [];
    for (let page = 1; page <= 20; page += 1) {
      const res = await this.client.get('packagings', `/shipments/packagings?page=${page}`);
      const root = asObj(res.json) ?? {};
      const data = Array.isArray(root.data) ? root.data : [];
      for (const raw of data) {
        const r = asObj(raw);
        const code = r ? str(r.code) : null;
        if (r && code) out.push({ code, name: str(r.name) ?? code });
      }
      const next = asObj(root.meta)?.next_page;
      if (data.length === 0 || typeof next !== 'number' || next <= page) break;
    }
    return out;
  }

  async consignmentNote(code: string): Promise<{ code: string; description: string } | null> {
    const res = await this.client.get(
      'consignment_notes',
      `/shipments/consignment_notes?consignment_note=${encodeURIComponent(code)}`,
    );
    const data = asObj(res.json)?.data;
    const rows = Array.isArray(data) ? data.map(asObj) : [];
    const hit = rows.find((r) => r && str(r.consignment_note) === code);
    return hit ? { code, description: str(hit.description) ?? '' } : null;
  }

  /** §19.22.3: solo la PRIMERA página; `hasMore` ⇔ `meta.next_page ≠ null` (meta ilegible ⇒ `false`); filas sin código fuera. */
  async searchConsignmentNotes(description: string): Promise<{ consignmentNotes: { code: string; description: string }[]; hasMore: boolean }> {
    const res = await this.client.get(
      'consignment_notes',
      `/shipments/consignment_notes?description=${encodeURIComponent(description)}`,
    );
    const root = asObj(res.json);
    const data = root?.data;
    const out: { code: string; description: string }[] = [];
    for (const raw of Array.isArray(data) ? data : []) {
      const r = asObj(raw);
      const code = r ? str(r.consignment_note) : null;
      if (r && code) out.push({ code, description: str(r.description) ?? '' });
    }
    const meta = asObj(root?.meta);
    const next = meta ? meta.next_page : null;
    return { consignmentNotes: out, hasMore: next !== null && next !== undefined };
  }

  async addressTemplates(): Promise<AddressTemplateSummary[]> {
    const out: AddressTemplateSummary[] = [];
    for (let page = 1; page <= 10; page += 1) {
      const res = await this.client.get('address_templates', `/address_templates?page=${page}&per_page=20`);
      const root = asObj(res.json) ?? {};
      const data = Array.isArray(root.data) ? root.data : [];
      for (const raw of data) {
        const item = asObj(raw);
        if (!item) continue;
        const attrs = asObj(item.attributes) ?? item;
        const id = idOf(item.id) ?? idOf(attrs.id);
        if (!id) continue;
        const type = attrs.address_type;
        // ⛔ Sin nombre, teléfono, correo ni RFC (§19.19.6): solo lo que identifica la plantilla.
        out.push({
          id,
          alias: str(attrs.alias),
          addressType: type === 'from' || type === 'to' ? type : null,
          isDefault: attrs.default === true,
          postalCode: str(asObj(attrs.address)?.postal_code) ?? str(attrs.postal_code),
        });
      }
      const next = asObj(root.meta)?.next_page;
      if (data.length === 0 || typeof next !== 'number' || next <= page) break;
    }
    return out;
  }
}
