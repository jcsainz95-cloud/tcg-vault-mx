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
import { buildPurchaseBody } from './skydropx.adapter';
import { completedQuotationFixture } from './fixtures/skydropx-quotation.fixture';
import { insuranceEchoOf, normalizeRates } from './rate-normalization';
import { ShippingProviderError, ShippingProviderPurchaseInFlightError } from './shipping-provider.errors';
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
  ShippingProviderPort,
} from './shipping-provider.port';

export type FakePurchaseOutcome =
  | {
      kind: 'labeled';
      trackingNumber?: string;
      carrierName?: string;
      labelUrl?: string | null;
      trackingUrl?: string | null;
      totalCents?: number | null;
      insuranceCents?: number | null;
    }
  | { kind: 'processing'; labelUrl?: string | null }
  | { kind: 'error_detail'; code: string; message: string }
  | { kind: 'in_flight' }
  | { kind: 'rejected'; providerCode?: string; providerMessage?: string };

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
  extraChargeList: ProviderExtraCharge[] = [];
  defaultLabelUrl: string | null = null;
  defaultTrackingUrl: string | null = null;

  private seq = 0;
  private readonly quotations = new Map<string, { id: string; coverageCents: number }>();
  private readonly ratesById = new Map<string, ProviderRate>();
  private readonly shipments = new Map<string, ProviderShipmentState>();

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
      entry = { id: `fake-quotation-${this.seq}`, coverageCents: p.coverageCents };
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
      raw.rates = (raw.rates as Record<string, unknown>[]).map((r) =>
        r.success === true ? { ...r, protection_value_total: protection } : r,
      );
    }
    const insuranceEcho = insuranceEchoOf(raw.packages, p.coverageCents);
    const { rates, excluded } = normalizeRates(this.quoteCompleted ? raw.rates : [], {
      insuranceEchoOk: insuranceEcho.ok,
    });
    for (const r of rates) this.ratesById.set(r.rateId, r);
    return {
      providerQuotationId: entry.id,
      completed: this.quoteCompleted,
      rates,
      excluded,
      insuranceEcho,
      raw: { id: entry.id, is_completed: this.quoteCompleted },
    };
  }

  async purchase(input: PurchaseInput): Promise<PurchaseResult> {
    // Se registra el CUERPO que el adaptador real mandaría (PS-85/PS-96/PS-97 lo inspeccionan).
    this.calls.push({ op: 'purchase', input: { input, body: buildPurchaseBody(input) } });
    if (this.purchaseBarrier) await this.purchaseBarrier();
    const outcome: FakePurchaseOutcome = this.purchaseOutcomes.shift() ?? { kind: 'labeled' };
    if (outcome.kind === 'in_flight') {
      throw new ShippingProviderPurchaseInFlightError(ShippingProviderError.busy('purchase'));
    }
    if (outcome.kind === 'rejected') {
      throw ShippingProviderError.rejected('purchase', outcome.providerCode ?? 'rejected', outcome.providerMessage ?? 'rechazada');
    }
    this.seq += 1;
    const providerShipmentId = `fake-shipment-${this.seq}`;
    const rate = this.ratesById.get(input.rateId) ?? null;
    if (outcome.kind === 'error_detail') {
      return {
        providerShipmentId,
        carrierName: rate?.carrierName ?? null,
        trackingNumber: null,
        rawLabelUrl: null,
        rawTrackingUrl: null,
        totalCents: null,
        insuranceCents: null,
        error: { code: outcome.code, message: outcome.message },
        raw: { id: providerShipmentId },
      };
    }
    const labeled = outcome.kind === 'labeled' ? outcome : null;
    const state: ProviderShipmentState = {
      providerShipmentId,
      carrierName: labeled?.carrierName ?? rate?.carrierName ?? null,
      trackingNumber: labeled ? (labeled.trackingNumber ?? `FAKE${String(this.seq).padStart(8, '0')}`) : null,
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
      raw: { id: providerShipmentId },
    };
    this.shipments.set(providerShipmentId, state);
    return {
      providerShipmentId,
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
    return { balanceCents: this.balanceCents, currency: 'MXN' };
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
