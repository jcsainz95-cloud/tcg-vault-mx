/**
 * fake-shipping-provider.ts — el DOBLE del puerto, con estado (API_CONTRACT §M4-SHIP.19.16 «Doble del puerto»,
 * §19.19.7 «El adaptador doble en E2E»). Lo usan las pruebas de `shipments` y la pila E2E de QA/CI
 * (`SHIPPING_PROVIDER_ADAPTER=fake`). ⛔ No toca la red; ⛔ no gasta.
 *
 * Realismo medido que reproduce (para que las pruebas muerdan lo que la API real hace):
 *  - Cotiza con la cotización MEDIDA (`fixtures/skydropx-quotation.fixture.ts`) y la normaliza con la MISMA función
 *    que el adaptador real (`normalizeRates`): el doble no puede divergir en filtro ni en redondeo.
 *  - ⚠️ REUTILIZA la cotización (M-5): misma ruta y medidas ⇒ mismo `providerQuotationId`, aunque cambie el seguro,
 *    y el eco de `packages[]` dice el seguro de la PRIMERA (⇒ `insuranceEcho.ok = false`). Apagable
 *    (`reuseQuotations = false`).
 *  - Seguro: $2,500 ⇒ $25 y $10,000 ⇒ $170 (PROD §4.4); otra cobertura ⇒ 1 % (NO MEDIDO: solo del doble).
 * Programable: resultados de compra en cola (número / `null` / `error_detail` / en vuelo / rechazo), barrera en la
 * compra, estado y eventos por envío, cancelación que acepta o rechaza con `refundedCents`, saldo, cargos extra.
 */
import { randomUUID } from 'crypto';
import { buildPurchaseBody } from './skydropx.adapter';
import { completedQuotationFixture } from './fixtures/skydropx-quotation.fixture';
import { insuranceEchoOf, normalizeRates } from './rate-normalization';
import { redactProviderPayload } from './redact';
import {
  PurchaseDeadlineError,
  ShippingProviderError,
  ShippingProviderPurchaseInFlightError,
  SkydropxMutationForbiddenError,
} from './shipping-provider.errors';
import { folioTokenOf } from './folio-token';
import {
  AddressTemplateSummary,
  CancelResult,
  CatalogRow,
  ProviderCarrierStatus,
  ProviderEvent,
  ProviderExtraCharge,
  ProviderRate,
  ProviderShipmentState,
  PurchaseInput,
  PurchaseResult,
  QuoteInput,
  QuoteResult,
  RecentProviderShipment,
  RecentShipmentsResult,
  ShippingProviderPort,
} from './shipping-provider.port';

export type FakePurchaseOutcome =
  | {
      kind: 'labeled';
      /** Id a devolver (p. ej. el de OTRO envío, PS-118 (b)); por defecto uno nuevo. */
      providerShipmentId?: string;
      trackingNumber?: string;
      carrierName?: string;
      labelUrl?: string | null;
      trackingUrl?: string | null;
      totalCents?: number | null;
      insuranceCents?: number | null;
    }
  | { kind: 'processing'; labelUrl?: string | null; providerShipmentId?: string }
  /** `2xx` con `error_detail`: con id (por defecto) ⇒ «rechazo con id» (§19.26.1); `withoutId` ⇒ rechazo sin id. */
  | { kind: 'error_detail'; code: string; message: string; withoutId?: boolean }
  | { kind: 'in_flight' }
  /** `400/422`; con `providerShipmentId` ⇒ el cuerpo trae id (⇒ «rechazo con id», §19.26.1). */
  | { kind: 'rejected'; providerCode?: string; providerMessage?: string; providerShipmentId?: string }
  /** Errores ANTES de que salga la compra (§19.20.5 fila 3): plazo, candado, borde, `429` agotado. */
  | { kind: 'deadline' }
  | { kind: 'forbidden' }
  | { kind: 'edge_blocked' }
  | { kind: 'busy' };

export type FakeCancelOutcome = CancelResult | { throws: ShippingProviderError };

export interface FakeCall {
  op: string;
  input: unknown;
}

const MEASURED_INSURANCE: Record<number, number> = { 250000: 2500, 1000000: 17000 };

export function fakeInsuranceCostCents(coverageCents: number): number {
  return MEASURED_INSURANCE[coverageCents] ?? Math.round(coverageCents / 100);
}

export class FakeShippingProvider implements ShippingProviderPort {
  readonly name = 'skydropx' as const;
  readonly calls: FakeCall[] = [];
  reuseQuotations = true;
  /** Sustituible para escenarios: devuelve la cotización CRUDA (forma de la API) a normalizar. */
  quotationFixture: () => Record<string, unknown> = () => completedQuotationFixture();
  quoteCompleted = true;
  readonly purchaseOutcomes: FakePurchaseOutcome[] = [];
  purchaseBarrier: (() => Promise<void>) | null = null;
  readonly cancelOutcomes: FakeCancelOutcome[] = [];
  balanceCents = 96516;
  /** Saldo por secuencia (§19.27.3, PS-123): se consume uno por llamada; un `Error` se lanza. Vacía ⇒ `balanceCents`. */
  readonly balanceSequence: (number | Error)[] = [];
  /** Gancho en `balance()` (PS-105b: inyecta una corrección entre el paso 2 y el 7). Se llama ANTES de responder. */
  onBalance: (() => Promise<void>) | null = null;
  /** Gancho en `purchase()` ANTES de responder (PS-134 (b): consulta la BD en el momento de la compra). */
  onPurchase: ((input: PurchaseInput) => Promise<void>) | null = null;
  /** Reloj del doble para `createdAt` del listado (las pruebas lo atan al reloj de la guía). */
  now: () => Date = () => new Date();
  /** Envíos que el listado muestra ADEMÁS de los creados por `purchase` (candidatos ajenos, PS-124/PS-129). */
  readonly recentExtra: RecentProviderShipment[] = [];
  /** Sustituye por completo la respuesta del listado (ilegible, sin cobertura…). */
  recentOverride: ((createdFrom: Date) => RecentShipmentsResult | Promise<RecentShipmentsResult>) | null = null;
  /** Lo que `purchase` creó, con lo que el listado real devolvería (folio de `address_to`, CP, total, fecha). */
  private readonly created: RecentProviderShipment[] = [];
  extraChargeList: ProviderExtraCharge[] = [];
  defaultLabelUrl: string | null = null;
  defaultTrackingUrl: string | null = null;

  private seq = 0;
  /** Ids únicos por instancia: una BD de pruebas reutilizada no ve el `fake-quotation-1` de una corrida anterior. */
  private readonly tag = randomUUID().slice(0, 8);
  private readonly quotations = new Map<string, { id: string; coverageCents: number }>();
  private readonly ratesById = new Map<string, ProviderRate>();
  private readonly postalByRate = new Map<string, string>();
  private readonly shipments = new Map<string, ProviderShipmentState>();

  /** Olvida las cotizaciones vistas (M-5): la siguiente de cada ruta+medidas nace con id nuevo y su propio seguro. */
  forgetQuotations(): void {
    this.quotations.clear();
  }

  callsOf(op: string): FakeCall[] {
    return this.calls.filter((c) => c.op === op);
  }

  async quote(input: QuoteInput): Promise<QuoteResult> {
    this.calls.push({ op: 'quote', input });
    const p = input.parcel;
    const key = `${input.to.postalCode}|${p.lengthCm}x${p.widthCm}x${p.heightCm}|${p.weightKg}`;
    let entry = this.reuseQuotations ? this.quotations.get(key) : undefined;
    if (!entry) {
      this.seq += 1;
      entry = { id: `fake-quotation-${this.tag}-${this.seq}`, coverageCents: p.coverageCents };
      this.quotations.set(key, entry);
    }
    const raw = this.quotationFixture();
    raw.id = entry.id;
    raw.is_completed = this.quoteCompleted;
    const echoedCoverage = entry.coverageCents;
    raw.packages = [
      {
        package_number: 1,
        weight: `${p.weightKg}.0`,
        length: `${p.lengthCm}.0`,
        width: `${p.widthCm}.0`,
        height: `${p.heightCm}.0`,
        package_protected: true,
        declared_value: (echoedCoverage / 100).toFixed(1),
        protection_value: fakeInsuranceCostCents(echoedCoverage) / 100,
      },
    ];
    const protection = fakeInsuranceCostCents(echoedCoverage) / 100;
    if (Array.isArray(raw.rates)) {
      // Como la API real: la `rate_id` es de SU cotización (otra cotización ⇒ otras ids; la misma ⇒ las mismas). Sin esto,
      // dos envíos cotizados compartirían ids y la guarda `rate_already_purchased` (§19.26.3 (a)) mordería en falso.
      raw.rates = (raw.rates as Record<string, unknown>[]).map((r) => ({
        ...r,
        ...(typeof r.id === 'string' ? { id: `${r.id}@${entry.id}` } : {}),
        ...(r.success === true ? { protection_value_total: protection } : {}),
      }));
    }
    const insuranceEcho = insuranceEchoOf(raw.packages, p.coverageCents);
    const { rates, excluded } = normalizeRates(this.quoteCompleted ? raw.rates : [], {
      insuranceEchoOk: insuranceEcho.ok,
    });
    for (const r of rates) {
      this.ratesById.set(r.rateId, r);
      this.postalByRate.set(r.rateId, input.to.postalCode);
    }
    return {
      providerQuotationId: entry.id,
      completed: this.quoteCompleted,
      rates,
      excluded,
      insuranceEcho,
      // Como el adaptador real: la respuesta ENTERA ya redactada por lista blanca (D2b recalcula `excluded` de aquí).
      raw: redactProviderPayload(raw),
    };
  }

  async purchase(input: PurchaseInput): Promise<PurchaseResult> {
    // Se registra el CUERPO que el adaptador real mandaría (PS-85/PS-96/PS-97/PS-135 lo inspeccionan).
    this.calls.push({ op: 'purchase', input: { input, body: buildPurchaseBody(input) } });
    if (this.purchaseBarrier) await this.purchaseBarrier();
    if (this.onPurchase) await this.onPurchase(input);
    const outcome: FakePurchaseOutcome = this.purchaseOutcomes.shift() ?? { kind: 'labeled' };
    switch (outcome.kind) {
      case 'in_flight':
        throw new ShippingProviderPurchaseInFlightError(ShippingProviderError.busy('purchase'));
      case 'deadline':
        throw new PurchaseDeadlineError('purchase');
      case 'forbidden':
        throw new SkydropxMutationForbiddenError('test_runtime', 'purchase');
      case 'edge_blocked':
        throw ShippingProviderError.error('purchase', 403, 'edge_blocked');
      case 'busy':
        throw ShippingProviderError.busy('purchase');
      case 'rejected': {
        const e = ShippingProviderError.rejected('purchase', outcome.providerCode ?? 'rejected', outcome.providerMessage ?? 'rechazada');
        if (outcome.providerShipmentId) {
          this.remember(outcome.providerShipmentId, input, null, true);
          throw new ShippingProviderError(e.code, e.httpStatus, { ...e.details, providerShipmentId: outcome.providerShipmentId });
        }
        throw e;
      }
      default:
        break;
    }
    this.seq += 1;
    const ownId =
      (outcome.kind === 'labeled' || outcome.kind === 'processing') && outcome.providerShipmentId
        ? outcome.providerShipmentId
        : `fake-shipment-${this.tag}-${this.seq}`;
    const rate = this.ratesById.get(input.rateId) ?? null;
    if (outcome.kind === 'error_detail') {
      const id = outcome.withoutId ? null : ownId;
      if (id) this.remember(id, input, rate, true);
      return {
        providerShipmentId: id,
        carrierName: rate?.carrierName ?? null,
        trackingNumber: null,
        rawLabelUrl: null,
        rawTrackingUrl: null,
        totalCents: null,
        insuranceCents: null,
        error: { code: outcome.code, message: outcome.message },
        raw: { id },
      };
    }
    const labeled = outcome.kind === 'labeled' ? outcome : null;
    const state: ProviderShipmentState = {
      providerShipmentId: ownId,
      carrierName: labeled?.carrierName ?? rate?.carrierName ?? null,
      trackingNumber: labeled ? (labeled.trackingNumber ?? `FAKE${this.tag.toUpperCase()}${String(this.seq).padStart(6, '0')}`) : null,
      rawLabelUrl: outcome.labelUrl === undefined ? this.defaultLabelUrl : outcome.labelUrl,
      rawTrackingUrl: labeled && labeled.trackingUrl !== undefined ? labeled.trackingUrl : this.defaultTrackingUrl,
      totalCents: labeled && labeled.totalCents !== undefined ? labeled.totalCents : (rate?.totalCents ?? null),
      insuranceCents:
        labeled && labeled.insuranceCents !== undefined
          ? labeled.insuranceCents
          : fakeInsuranceCostCents(input.package.coverageCents),
      error: null,
      carrierStatus: labeled ? 'created' : null,
      unknownCarrierStatus: null,
      statusUpdatedAt: null,
      events: [],
      raw: { id: ownId },
    };
    if (!this.shipments.has(ownId)) this.shipments.set(ownId, state);
    this.remember(ownId, input, rate, false, state.totalCents);
    return {
      providerShipmentId: ownId,
      carrierName: state.carrierName,
      trackingNumber: state.trackingNumber,
      rawLabelUrl: state.rawLabelUrl,
      rawTrackingUrl: state.rawTrackingUrl,
      totalCents: state.totalCents,
      insuranceCents: state.insuranceCents,
      error: null,
      raw: state.raw,
    };
  }

  /** Lo que el listado de Skydropx mostraría de un envío creado (con el folio de `address_to.reference`). */
  private remember(id: string, input: PurchaseInput, rate: ProviderRate | null, hasError: boolean, totalCents: number | null = rate?.totalCents ?? null): void {
    if (this.created.some((c) => c.providerShipmentId === id)) return;
    if (!this.shipments.has(id)) {
      this.shipments.set(id, {
        providerShipmentId: id,
        carrierName: rate?.carrierName ?? null,
        trackingNumber: null,
        rawLabelUrl: null,
        rawTrackingUrl: null,
        totalCents,
        insuranceCents: null,
        error: hasError ? { code: 'X', message: 'error' } : null,
        carrierStatus: null,
        unknownCarrierStatus: null,
        statusUpdatedAt: null,
        events: [],
        raw: { id },
      });
    }
    this.created.push({
      providerShipmentId: id,
      createdAt: this.now().toISOString(),
      carrierName: rate?.carrierName ?? null,
      totalCents,
      postalCodeTo: this.postalCodeOf(input),
      source: 'api',
      hasError,
      providerReference: folioTokenOf(input.to.reference),
    });
  }

  /** El CP con el que se cotizó la tarifa (la compra real no lleva CP en `address_to`: lo pone la cotización). */
  private postalCodeOf(input: PurchaseInput): string | null {
    return this.postalByRate.get(input.rateId) ?? null;
  }

  /** Envía un envío creado FUERA de `purchase` al listado y al detalle (una guía comprada en el panel, una tardía…). */
  addListed(entry: RecentProviderShipment, state: Partial<ProviderShipmentState> = {}): void {
    this.recentExtra.push(entry);
    this.shipments.set(entry.providerShipmentId, {
      providerShipmentId: entry.providerShipmentId,
      carrierName: entry.carrierName,
      trackingNumber: null,
      rawLabelUrl: null,
      rawTrackingUrl: null,
      totalCents: entry.totalCents,
      insuranceCents: null,
      error: entry.hasError ? { code: 'X', message: 'error' } : null,
      carrierStatus: null,
      unknownCarrierStatus: null,
      statusUpdatedAt: null,
      events: [],
      raw: { id: entry.providerShipmentId },
      ...state,
    });
  }

  /** Lo creado por `purchase` (para que una prueba lo retire del listado o cambie su fecha). */
  get createdShipments(): RecentProviderShipment[] {
    return this.created;
  }

  async recentShipments(createdFrom: Date): Promise<RecentShipmentsResult> {
    this.calls.push({ op: 'recentShipments', input: createdFrom });
    if (this.recentOverride) return this.recentOverride(createdFrom);
    return { readable: true, coversFrom: true, shipments: [...this.created, ...this.recentExtra] };
  }

  async getShipment(providerShipmentId: string): Promise<ProviderShipmentState> {
    this.calls.push({ op: 'getShipment', input: providerShipmentId });
    const s = this.shipments.get(providerShipmentId);
    if (!s) throw ShippingProviderError.error('shipment', 404);
    return { ...s, events: [...s.events] };
  }

  /** Programa el estado que verá el siguiente `getShipment` (número tardío, URLs, estado del transportista…). */
  setShipment(providerShipmentId: string, patch: Partial<ProviderShipmentState>): void {
    const base = this.shipments.get(providerShipmentId);
    if (!base) throw new Error(`FakeShippingProvider: envío desconocido ${providerShipmentId}`);
    this.shipments.set(providerShipmentId, { ...base, ...patch });
  }

  pushEvent(providerShipmentId: string, status: ProviderCarrierStatus, occurredAt: string): void {
    const base = this.shipments.get(providerShipmentId);
    if (!base) throw new Error(`FakeShippingProvider: envío desconocido ${providerShipmentId}`);
    const ev: ProviderEvent = { status, rawStatus: status, occurredAt };
    this.shipments.set(providerShipmentId, { ...base, carrierStatus: status, events: [...base.events, ev] });
  }

  async cancel(providerShipmentId: string, reason: string): Promise<CancelResult> {
    this.calls.push({ op: 'cancel', input: { providerShipmentId, reason } });
    const outcome = this.cancelOutcomes.shift() ?? { ok: true as const, refundedCents: null };
    if ('throws' in outcome) throw outcome.throws;
    if (outcome.ok) {
      const s = this.shipments.get(providerShipmentId);
      if (s) this.shipments.set(providerShipmentId, { ...s, carrierStatus: 'canceled' });
    }
    return outcome;
  }

  async protect(providerShipmentId: string, coverageCents: number): Promise<void> {
    this.calls.push({ op: 'protect', input: { providerShipmentId, coverageCents } });
  }

  async balance(): Promise<{ balanceCents: number; currency: 'MXN' }> {
    this.calls.push({ op: 'balance', input: null });
    if (this.onBalance) await this.onBalance();
    const next = this.balanceSequence.length > 0 ? this.balanceSequence.shift()! : this.balanceCents;
    if (next instanceof Error) throw next;
    return { balanceCents: next, currency: 'MXN' };
  }

  async *extraCharges(from: Date, to: Date): AsyncIterable<ProviderExtraCharge> {
    this.calls.push({ op: 'extraCharges', input: { from, to } });
    for (const c of this.extraChargeList) yield c;
  }

  async packagings(): Promise<CatalogRow[]> {
    return [
      { code: '4G', name: 'Caja de cartón' },
      { code: '5H4', name: 'Saco (bolsa) de película de plástico' },
    ];
  }

  async consignmentNote(code: string): Promise<{ code: string; description: string } | null> {
    const known: Record<string, string> = {
      '49101600': 'Coleccionables',
      '60141103': 'Naipes',
      '60141100': 'Juegos',
    };
    return known[code] ? { code, description: known[code] } : null;
  }

  async searchConsignmentNotes(description: string): Promise<{ code: string; description: string }[]> {
    const all = [
      { code: '49101600', description: 'Coleccionables' },
      { code: '60141103', description: 'Naipes' },
    ];
    const q = description.toLowerCase();
    return all.filter((r) => r.description.toLowerCase().includes(q));
  }

  async addressTemplates(): Promise<AddressTemplateSummary[]> {
    return [{ id: 'fake-template-verapaz', alias: 'Verapaz', addressType: 'from', isDefault: false, postalCode: '14210' }];
  }
}
