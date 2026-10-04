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
  ShippingProviderPort,
} from './shipping-provider.port';

export const QUOTE_POLL_INTERVAL_MS = 1_500;
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
  return str(v);
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
      address_from: { address_template_id: input.from.templateId },
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
  const addressFrom: Obj = { address_template_id: input.from.templateId };
  if (input.from.snapshot) {
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
  };
  if (input.to.furtherInformation) addressTo.further_information = input.to.furtherInformation;
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
}

/** Objeto o arreglo (v2 «siempre arreglo», NO MEDIDO) ⇒ el primero; JSON:API `data.attributes` + `included`. */
function parseShipmentEnvelope(json: unknown): ParsedShipment {
  let root: unknown = json;
  if (Array.isArray(root)) root = root[0];
  const rootObj = asObj(root) ?? {};
  let data: unknown = 'data' in rootObj ? rootObj.data : rootObj;
  if (Array.isArray(data)) data = data[0];
  const dataObj = asObj(data) ?? {};
  const attrs = asObj(dataObj.attributes) ?? dataObj;
  const included = Array.isArray(rootObj.included) ? rootObj.included : [];
  const pkgEntry = included.map(asObj).find((i) => i && (i.type === 'package' || i.type === 'packages')) ?? null;
  const pkg = asObj(pkgEntry?.attributes) ?? pkgEntry ?? {};
  return { id: idOf(dataObj.id), attrs, pkg };
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
      out.push({
        status: asCarrierStatus(rawStatus),
        rawStatus,
        occurredAt: firstStr(e.occurred_at, e.date, e.created_at, e.updated_at),
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
    const res = await this.client.mutate({
      op: 'purchase',
      body: buildPurchaseBody(input),
      idempotencyKey: input.idempotencyKey,
    });
    const parsed = parseShipmentEnvelope(res.json);
    const fields = purchaseFields(parsed);
    if (!parsed.id && !fields.error) {
      // 2xx sin id y sin error: no sabemos si se creó ⇒ «compra en vuelo» (⛔ no se reintenta).
      throw new ShippingProviderPurchaseInFlightError(ShippingProviderError.error('purchase', res.status, 'no_id'));
    }
    return { providerShipmentId: parsed.id ?? '', ...fields, raw: redactProviderPayload(res.json) };
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

  async searchConsignmentNotes(description: string): Promise<{ code: string; description: string }[]> {
    const res = await this.client.get(
      'consignment_notes',
      `/shipments/consignment_notes?description=${encodeURIComponent(description)}`,
    );
    const data = asObj(res.json)?.data;
    const out: { code: string; description: string }[] = [];
    for (const raw of Array.isArray(data) ? data : []) {
      const r = asObj(raw);
      const code = r ? str(r.consignment_note) : null;
      if (r && code) out.push({ code, description: str(r.description) ?? '' });
    }
    return out;
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
