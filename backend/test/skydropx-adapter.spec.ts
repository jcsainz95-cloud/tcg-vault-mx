/**
 * PS-94 · PS-95 (lado adaptador) · PS-70 (fixture medido) · PS-85 (PII saliente y log) — `SkydropxAdapter`,
 * normalización y `FakeShippingProvider` (API_CONTRACT §M4-SHIP.19.19.4, §19.19.8, §19.19.16).
 *
 * Mutaciones que estas pruebas ponen rojas (las del contrato y las propias):
 *  - PS-94: `parseFloat(x) * 100`; redondear cada `extra_fee`; admitir `success:false`.
 *  - PS-95: `expiresAt`/persistencia son de D2b; aquí: el sondeo (3 `GET` ⇒ completa; 20 s ⇒ `completed:false`) y el
 *    doble que REUTILIZA el `providerQuotationId` para dos envíos (M-5).
 *  - PS-96 (lado cuerpo): omitir `package_protected`/`declared_value` en la cotización o en la compra.
 */
import { decimalToCents, sumDecimalsToCents } from '../src/modules/shipping-provider/decimal-cents';
import { FakeShippingProvider } from '../src/modules/shipping-provider/fake-shipping-provider';
import {
  completedQuotationFixture,
  FIXTURE_EXPECTED,
  pendingQuotationFixture,
} from '../src/modules/shipping-provider/fixtures/skydropx-quotation.fixture';
import { SkydropxClient } from '../src/modules/shipping-provider/http/skydropx-client';
import { normalizeRates, pickRecommendedRateId } from '../src/modules/shipping-provider/rate-normalization';
import { redactProviderPayload, REDACTED } from '../src/modules/shipping-provider/redact';
import {
  buildPurchaseBody,
  buildQuotationBody,
  QUOTE_POLL_TIMEOUT_MS,
  SkydropxAdapter,
} from '../src/modules/shipping-provider/skydropx.adapter';
import {
  ShippingProviderError,
  ShippingProviderPurchaseInFlightError,
} from '../src/modules/shipping-provider/shipping-provider.errors';
import { ProviderRate, PurchaseInput, QuoteInput } from '../src/modules/shipping-provider/shipping-provider.port';
import {
  CapturedLogger,
  FAKE_CLIENT_ID,
  FAKE_SECRET,
  FakeClock,
  jsonResponse,
  RECORDER_ORIGIN,
  RecorderTransport,
  withSpendGateOpen,
} from './helpers/skydropx-recorder';

function setup() {
  const clock = new FakeClock();
  const rec = new RecorderTransport(clock);
  const logger = new CapturedLogger();
  const client = new SkydropxClient({
    baseUrl: `${RECORDER_ORIGIN}/api/v1`,
    clientId: FAKE_CLIENT_ID,
    clientSecret: FAKE_SECRET,
    transport: rec.transport,
    clock,
    logger,
    random: () => 0,
  });
  return { clock, rec, logger, adapter: new SkydropxAdapter({ client, clock, logger }) };
}

const QUOTE_INPUT: QuoteInput = {
  from: { templateId: 'tpl-verapaz' },
  to: { countryCode: 'MX', postalCode: '06600', state: 'Ciudad de México', city: 'Cuauhtémoc', neighborhood: 'Juárez' },
  parcel: { lengthCm: 25, widthCm: 18, heightCm: 3, weightKg: 1, coverageCents: 250000 },
};

const PURCHASE_INPUT: PurchaseInput = {
  rateId: 'fixture-rate-05',
  printingFormat: 'standard',
  from: {
    templateId: 'tpl-verapaz',
    snapshot: { street1: 'Origen 1', name: 'Tienda', company: 'TCG HUNT', phone: '5500000000', email: 'envios@example.com', reference: 'Portón negro' },
  },
  to: {
    street1: 'Calle Falsa 123',
    name: 'Ana Pérez',
    company: 'Ana Pérez',
    phone: '5512345678',
    email: 'ana@example.com',
    furtherInformation: 'Casa azul',
  },
  package: { coverageCents: 250000, consignmentNote: '49101600', packageType: '5H4' },
  idempotencyKey: 'label:s1:fixture-rate-05',
};

function fixtureRates(): Record<string, unknown>[] {
  return completedQuotationFixture().rates as Record<string, unknown>[];
}

describe('decimal ⇒ centavos EXACTOS (PS-94)', () => {
  it.each([
    ['52.11', 5211],
    ['51.25', 5125],
    ['0.29', 29], // parseFloat('0.29') * 100 = 28.999999999999996
    ['1.19', 119],
    ['4.35', 435], // 4.35 * 100 = 434.99999999999994
    ['1.0', 100],
    ['10000.0', 1000000],
    [0.7315, 73],
    ['0.005', 1], // half-up
    ['-1.255', -126],
  ])('%p ⇒ %p', (input, cents) => {
    expect(decimalToCents(input)).toBe(cents);
  });

  it('ilegible ⇒ null (tolerante, nunca NaN ni 500)', () => {
    for (const v of [null, undefined, '', 'abc', '1,25', NaN, Infinity, {}, '1e3']) expect(decimalToCents(v)).toBeNull();
  });

  it('extra_fees se suman en decimal y se redondea UNA vez (0.004 + 0.004 ⇒ 1, no 0)', () => {
    expect(sumDecimalsToCents([0.004, 0.004])).toBe(1);
    expect(sumDecimalsToCents([0.7315])).toBe(73);
    expect(sumDecimalsToCents([0.335, 0.335])).toBe(67); // por separado: 34 + 34 = 68
    expect(sumDecimalsToCents([])).toBe(0);
  });
});

describe('PS-94 💰 — normalización con el fixture MEDIDO (PROD §4.6 ampliado)', () => {
  it('el fixture tiene la forma medida: 33 tarifas, J&T success:false, no_coverage, not_applicable', () => {
    const rates = fixtureRates();
    expect(rates).toHaveLength(FIXTURE_EXPECTED.total);
    expect(rates.filter((r) => r.provider_name === 'jtexpress' && r.success === false && r.status === 'price_found_internal')).toHaveLength(2);
    expect(rates.some((r) => r.status === 'no_coverage')).toBe(true);
    expect(rates.some((r) => r.status === 'not_applicable')).toBe(true);
  });

  it('solo se ofrecen las success con precio; excluded con los conteos exactos', () => {
    const { rates, excluded } = normalizeRates(fixtureRates(), { insuranceEchoOk: true });
    expect(rates).toHaveLength(FIXTURE_EXPECTED.offered);
    expect(excluded).toEqual(FIXTURE_EXPECTED.excluded);
    expect(rates.some((r) => r.carrierName === 'jtexpress')).toBe(false);
  });

  it('FedEx medida: "52.11" ⇒ 5211 exacto; combustible 0.7315 ⇒ 73; IVA = vat_fee del proveedor', () => {
    const { rates } = normalizeRates(fixtureRates(), { insuranceEchoOk: true });
    const fedex = rates.find((r) => r.rateId === 'fixture-rate-fedex-measured')!;
    expect(fedex).toMatchObject({
      carrierName: 'fedex',
      carrierLabel: 'FedEx',
      serviceName: 'Express Saver',
      amountCents: 4310,
      extraFeesCents: 73,
      vatCents: 701,
      serviceFeeCents: 127,
      totalCents: 5211,
      insuranceCents: 2500,
      days: 2,
      deliveryKind: 'home',
      pickup: true,
      pickupViaSupport: false,
      creationType: 'single',
      planType: '50PESOS_30042026',
    });
  });

  it('cada tarifa ofrecida cuadra: amount + extra + vat + service = total (± 1 centavo)', () => {
    const { rates } = normalizeRates(fixtureRates(), { insuranceEchoOk: true });
    for (const r of rates) {
      expect(Math.abs(r.amountCents + r.extraFeesCents + (r.vatCents ?? 0) + r.serviceFeeCents - r.totalCents)).toBeLessThanOrEqual(1);
      expect(Number.isInteger(r.totalCents)).toBe(true);
    }
  });

  it('deliveryKind desde office_delivery_only (PuntoPost ⇒ branch), days entero', () => {
    const { rates } = normalizeRates(fixtureRates(), { insuranceEchoOk: true });
    const pp = rates.find((r) => r.carrierName === 'punto_post')!;
    expect(pp.deliveryKind).toBe('branch');
    expect(pp.totalCents).toBe(119);
    for (const r of rates) expect(r.days === null || Number.isInteger(r.days)).toBe(true);
    const unknown = normalizeRates([{ ...fixtureRates()[1], office_delivery_only: undefined }], { insuranceEchoOk: true });
    expect(unknown.rates[0].deliveryKind).toBe('unknown');
  });

  it('eco del seguro que NO coincide ⇒ insuranceCents null en todas (el dominio usa la tabla)', () => {
    const { rates } = normalizeRates(fixtureRates(), { insuranceEchoOk: false });
    for (const r of rates) expect(r.insuranceCents).toBeNull();
  });

  it('tarifa cuyo desglose no cuadra ⇒ fuera (breakdownMismatch) + aviso', () => {
    const bad = { ...fixtureRates()[3], id: 'bad', total: '60.00' };
    const seen: string[] = [];
    const { rates, excluded } = normalizeRates([bad], { insuranceEchoOk: true, onBreakdownMismatch: (id) => seen.push(id) });
    expect(rates).toHaveLength(0);
    expect(excluded.breakdownMismatch).toBe(1);
    expect(seen).toEqual(['bad']);
  });

  it('total null en una success ⇒ breakdownMismatch; multipackage ⇒ fuera', () => {
    const base = fixtureRates()[3];
    const { excluded } = normalizeRates(
      [
        { ...base, id: 'a', total: null },
        { ...base, id: 'b', shipment_creation_type: 'multipackage' },
        { ...base, id: 'c', shipment_creation_type: 'multishipment' },
      ],
      { insuranceEchoOk: true },
    );
    expect(excluded).toMatchObject({ breakdownMismatch: 1, multipackage: 2 });
  });

  it('PS-70 (corregida): tarifa con vat_fee null ⇒ se ofrece con vatCents null (el dominio calcula 16/116)', () => {
    const base = fixtureRates()[3];
    const { rates } = normalizeRates([{ ...base, id: 'novat', vat_fee: null }], { insuranceEchoOk: true });
    expect(rates).toHaveLength(1);
    expect(rates[0].vatCents).toBeNull();
    expect(rates[0].totalCents).toBe(5211);
  });

  it('ninetynineminutes es la recomendada AUNQUE cueste más; sin preferidas ⇒ la más barata no-sucursal; solo sucursal ⇒ null', () => {
    const { rates } = normalizeRates(fixtureRates(), { insuranceEchoOk: true });
    const priced = rates.map((r: ProviderRate) => ({ ...r, priceCents: r.totalCents + (r.insuranceCents ?? 0) }));
    const nn = priced.find((r) => r.carrierName === 'ninetynineminutes')!;
    const cheapestHome = priced.filter((r) => r.deliveryKind !== 'branch').sort((a, b) => a.priceCents - b.priceCents)[0];
    expect(nn.priceCents).toBeGreaterThan(cheapestHome.priceCents);
    expect(pickRecommendedRateId(priced, ['ninetynineminutes'])).toBe(nn.rateId);
    expect(pickRecommendedRateId(priced, [])).toBe(cheapestHome.rateId);
    expect(pickRecommendedRateId(priced.filter((r) => r.deliveryKind === 'branch'), ['punto_post'])).toBeNull();
    // Preferida sin tarifa ofrecida ⇒ cae a la más barata no-sucursal.
    expect(pickRecommendedRateId(priced, ['no_existe'])).toBe(cheapestHome.rateId);
  });
});

describe('Cotizar con el adaptador real (cuerpo, sondeo, eco) — PS-95 / PS-96 (lado adaptador)', () => {
  it('cuerpo: parcels (no packages), seguro SIEMPRE explícito, sin requested_carriers ni order_id', () => {
    const body = buildQuotationBody(QUOTE_INPUT) as { quotation: Record<string, unknown> };
    expect(body).toEqual({
      quotation: {
        address_from: { address_template_id: 'tpl-verapaz' },
        address_to: {
          country_code: 'MX',
          postal_code: '06600',
          area_level1: 'Ciudad de México',
          area_level2: 'Cuauhtémoc',
          area_level3: 'Juárez',
        },
        parcels: [{ length: 25, width: 18, height: 3, weight: 1, package_protected: true, declared_value: 2500 }],
      },
    });
    expect(() => buildQuotationBody({ ...QUOTE_INPUT, parcel: { ...QUOTE_INPUT.parcel, coverageCents: 0 } })).toThrow();
    expect(() => buildQuotationBody({ ...QUOTE_INPUT, parcel: { ...QUOTE_INPUT.parcel, weightKg: 1.5 } })).toThrow();
  });

  it('201 incompleta ⇒ 3 GET ⇒ completa; resultado normalizado y raw redactado', async () => {
    const { rec, adapter } = setup();
    rec.on('POST', '/api/v1/quotations', () => jsonResponse(201, pendingQuotationFixture()));
    rec.on('GET', /^\/api\/v1\/quotations\//, (_c, n) =>
      jsonResponse(200, n < 3 ? pendingQuotationFixture() : completedQuotationFixture()),
    );
    const q = await adapter.quote(QUOTE_INPUT);
    expect(rec.callsTo('GET', /^\/api\/v1\/quotations\//)).toHaveLength(3);
    expect(q.completed).toBe(true);
    expect(q.rates).toHaveLength(FIXTURE_EXPECTED.offered);
    expect(q.excluded).toEqual(FIXTURE_EXPECTED.excluded);
    expect(q.insuranceEcho).toEqual({ ok: true, echoedProtected: true, echoedDeclaredValueCents: 250000 });
    const sent = JSON.parse(rec.callsTo('POST', '/api/v1/quotations')[0].body!);
    expect(sent.quotation.parcels[0]).toMatchObject({ package_protected: true, declared_value: 2500 });
  });

  it('20 s sin completar ⇒ completed:false con lo que haya, sin pasar de 20 s', async () => {
    const { rec, adapter, clock } = setup();
    const t0 = clock.now();
    rec.on('POST', '/api/v1/quotations', () => jsonResponse(201, pendingQuotationFixture()));
    rec.on('GET', /^\/api\/v1\/quotations\//, () => jsonResponse(200, pendingQuotationFixture()));
    const q = await adapter.quote(QUOTE_INPUT);
    expect(q.completed).toBe(false);
    expect(q.rates).toHaveLength(0);
    expect(rec.callsTo('GET', /^\/api\/v1\/quotations\//)).toHaveLength(13);
    expect(clock.now() - t0).toBeLessThanOrEqual(QUOTE_POLL_TIMEOUT_MS + 1000);
  });

  it('eco que NO coincide (cotización reutilizada, M-5) ⇒ insuranceEcho.ok false, insuranceCents null y warn', async () => {
    const { rec, adapter, logger } = setup();
    rec.on('POST', '/api/v1/quotations', () => jsonResponse(201, completedQuotationFixture({ declaredValue: '2500.0' })));
    const q = await adapter.quote({ ...QUOTE_INPUT, parcel: { ...QUOTE_INPUT.parcel, coverageCents: 1000000 } });
    expect(q.insuranceEcho.ok).toBe(false);
    expect(q.insuranceEcho.echoedDeclaredValueCents).toBe(250000);
    for (const r of q.rates) expect(r.insuranceCents).toBeNull();
    expect(logger.text()).toMatch(/quote_insurance_echo_mismatch/);
    expect(rec.callsTo('GET', /^\/api\/v1\/quotations\//)).toHaveLength(0);
  });

  it('eco no protegido (package_protected:false) ⇒ no coincide', async () => {
    const { rec, adapter } = setup();
    rec.on('POST', '/api/v1/quotations', () => jsonResponse(201, completedQuotationFixture({ packageProtected: false })));
    const q = await adapter.quote(QUOTE_INPUT);
    expect(q.insuranceEcho.ok).toBe(false);
  });

  it('201 sin id ⇒ 502 (no se inventa una cotización)', async () => {
    const { rec, adapter } = setup();
    rec.on('POST', '/api/v1/quotations', () => jsonResponse(201, { is_completed: false }));
    await expect(adapter.quote(QUOTE_INPUT)).rejects.toMatchObject({ httpStatus: 502, details: { op: 'quote' } });
  });

  it('raw redactado: ni teléfono ni nombres de la respuesta; ids, estados e importes sí', () => {
    const raw = redactProviderPayload({
      id: 'q1',
      address_to: { name: 'Ana', phone: '5512345678', street1: 'Calle' },
      rates: [{ id: 'r1', total: '52.11', provider_name: 'fedex', error_messages: [{ error_type: 'X', error_message: 'Ana 5512345678' }] }],
      company: 'ACME',
      further_information: 'Casa azul',
    });
    const s = JSON.stringify(raw);
    expect(s).not.toMatch(/5512345678|Ana|Calle|ACME|Casa azul/);
    expect(s).toContain('52.11');
    expect(s).toContain('"r1"');
    expect((raw as Record<string, unknown>).address_to).toBe(REDACTED);
  });
});

describe('Comprar — cuerpo (§19.19.8, PS-85 / PS-96 / PS-97 lado cuerpo) y parser tolerante', () => {
  it('cuerpo exacto: address_to SOLO {street1,name,company,phone,email,further_information}; seguro y Carta Porte', () => {
    const body = buildPurchaseBody(PURCHASE_INPUT) as { shipment: Record<string, unknown> };
    const s = body.shipment;
    expect(Object.keys(s.address_to as object).sort()).toEqual(
      ['company', 'email', 'further_information', 'name', 'phone', 'street1'].sort(),
    );
    expect(s.address_to).not.toHaveProperty('reference');
    expect(s.address_from).toEqual({
      address_template_id: 'tpl-verapaz',
      street1: 'Origen 1',
      name: 'Tienda',
      company: 'TCG HUNT',
      phone: '5500000000',
      email: 'envios@example.com',
      reference: 'Portón negro',
    });
    expect(s.packages).toEqual([
      { package_number: '1', package_protected: true, declared_value: 2500, consignment_note: '49101600', package_type: '5H4' },
    ]);
    expect(s.rate_id).toBe('fixture-rate-05');
    expect(s.printing_format).toBe('standard');
    const noSnap = buildPurchaseBody({ ...PURCHASE_INPUT, from: { templateId: 't', snapshot: null }, to: { ...PURCHASE_INPUT.to, furtherInformation: undefined } }) as { shipment: Record<string, unknown> };
    expect(noSnap.shipment.address_from).toEqual({ address_template_id: 't' });
    expect(noSnap.shipment.address_to).not.toHaveProperty('further_information');
  });

  async function purchaseWith(json: unknown) {
    const { rec, adapter, logger } = setup();
    rec.on('POST', '/api/v2/shipments', () => jsonResponse(201, json));
    const result = await withSpendGateOpen(rec, () => adapter.purchase(PURCHASE_INPUT));
    return { result, rec, logger };
  }

  it('respuesta en ARREGLO (v2) con JSON:API e included ⇒ el primero; número, URLs crudas, total', async () => {
    const { result, logger } = await purchaseWith([
      {
        data: {
          id: 'sh-1',
          type: 'shipment',
          attributes: { carrier_name: 'ninetynineminutes', master_tracking_number: 'NN123', total: '70.15', error_detail: { error_code: null } },
        },
        included: [{ id: 'p1', type: 'package', attributes: { tracking_number: 'NN123', label_url: 'https://labels.example/x.pdf', tracking_url_provider: 'https://track.example/NN123' } }],
      },
    ]);
    expect(result).toMatchObject({
      providerShipmentId: 'sh-1',
      carrierName: 'ninetynineminutes',
      trackingNumber: 'NN123',
      labelUrl: 'https://labels.example/x.pdf',
      trackingUrl: 'https://track.example/NN123',
      totalCents: 7015,
      error: null,
    });
    // PS-85: el log del adaptador no trae teléfono, calle, compañía ni further_information.
    const text = logger.text();
    for (const pii of ['5512345678', 'Calle Falsa', 'Ana Pérez', 'Casa azul', 'ana@example.com']) expect(text).not.toContain(pii);
  });

  it('respuesta OBJETO con master_tracking_number null ⇒ guía en proceso (trackingNumber null)', async () => {
    const { result } = await purchaseWith({ data: { id: 'sh-2', attributes: { master_tracking_number: null } } });
    expect(result.providerShipmentId).toBe('sh-2');
    expect(result.trackingNumber).toBeNull();
    expect(result.labelUrl).toBeNull();
    expect(result.totalCents).toBeNull();
  });

  it('error_detail.error_code ≠ null ⇒ rama de rechazo (error poblado)', async () => {
    const { result } = await purchaseWith({
      data: { id: 'sh-3', attributes: { error_detail: { error_code: 'E42', error_message: 'Saldo', error_message_detail: 'x' } } },
    });
    expect(result.error).toEqual({ code: 'E42', message: 'Saldo', detail: 'x' });
  });

  it('2xx sin id ni error ⇒ «compra en vuelo» (no se reintenta)', async () => {
    const { rec, adapter } = setup();
    rec.on('POST', '/api/v2/shipments', () => jsonResponse(201, { data: {} }));
    const err = await withSpendGateOpen(rec, () => adapter.purchase(PURCHASE_INPUT).catch((e) => e));
    expect(err).toBeInstanceOf(ShippingProviderPurchaseInFlightError);
    expect(rec.callsTo('POST', '/api/v2/shipments')).toHaveLength(1);
  });
});

describe('getShipment / cancel / balance / cargos / catálogos — parsers tolerantes', () => {
  it('getShipment: estado conocido, eventos, updated_at; estado desconocido ⇒ unknownCarrierStatus + warn', async () => {
    const { rec, adapter, logger } = setup();
    rec.on('GET', '/api/v1/shipments/sh-1', () =>
      jsonResponse(200, {
        data: { id: 'sh-1', attributes: { status: 'in_transit', updated_at: '2026-10-05T10:00:00Z', tracking_events: [
          { status: 'created', date: '2026-10-04T10:00:00Z' },
          { status: 'teleported', date: '2026-10-05T09:00:00Z' },
        ] } },
      }),
    );
    rec.on('GET', '/api/v1/shipments/sh-2', () => jsonResponse(200, { data: { id: 'sh-2', attributes: { status: 'lost_in_space' } } }));
    const s1 = await adapter.getShipment('sh-1');
    expect(s1.carrierStatus).toBe('in_transit');
    expect(s1.statusUpdatedAt).toBe('2026-10-05T10:00:00Z');
    expect(s1.events).toEqual([
      { status: 'created', rawStatus: 'created', occurredAt: '2026-10-04T10:00:00Z' },
      { status: null, rawStatus: 'teleported', occurredAt: '2026-10-05T09:00:00Z' },
    ]);
    const s2 = await adapter.getShipment('sh-2');
    expect(s2.carrierStatus).toBeNull();
    expect(s2.unknownCarrierStatus).toBe('lost_in_space');
    expect(logger.text()).toMatch(/unknown_carrier_status/);
  });

  it('getShipment con cuerpo vacío ⇒ todo null, nunca lanza', async () => {
    const { rec, adapter } = setup();
    rec.on('GET', '/api/v1/shipments/sh-9', () => jsonResponse(200, {}));
    const s = await adapter.getShipment('sh-9');
    expect(s).toMatchObject({ providerShipmentId: 'sh-9', carrierStatus: null, trackingNumber: null, events: [] });
  });

  it('cancel: acepta con refundedCents si viene, null si no; 422 ⇒ ok:false', async () => {
    const { rec, adapter } = setup();
    rec.on('POST', '/api/v1/shipments/a/cancellations', () => jsonResponse(200, { data: { id: 'a', attributes: { refunded_amount: '51.25' } } }));
    rec.on('POST', '/api/v1/shipments/b/cancellations', () => jsonResponse(201, { data: { id: 'b' } }));
    rec.on('POST', '/api/v1/shipments/c/cancellations', () => jsonResponse(422, { message: 'ya recolectada', code: 'already_picked' }));
    await withSpendGateOpen(rec, async () => {
      expect(await adapter.cancel('a', 'reissue')).toEqual({ ok: true, refundedCents: 5125 });
      expect(await adapter.cancel('b', 'reissue')).toEqual({ ok: true, refundedCents: null });
      expect(await adapter.cancel('c', 'reissue')).toEqual({ ok: false, code: 'already_picked', message: 'ya recolectada' });
    });
  });

  it('balance: {data:{balance:965.16,currency:"MXN"}} ⇒ 96516 (medido, M-15); forma rara ⇒ 502', async () => {
    const { rec, adapter } = setup();
    rec.on('GET', '/api/v1/finance/credits', (_c, n) =>
      n === 1 ? jsonResponse(200, { data: { balance: 965.16, currency: 'MXN' } }) : jsonResponse(200, { data: { balance: 'x' } }),
    );
    expect(await adapter.balance()).toEqual({ balanceCents: 96516, currency: 'MXN' });
    await expect(adapter.balance()).rejects.toBeInstanceOf(ShippingProviderError);
  });

  it('extraCharges: pagina por meta.next_page y omite los ilegibles', async () => {
    const { rec, adapter } = setup();
    rec.on('GET', /^\/api\/v1\/finance\/extra-charges\?page=1&/, () =>
      jsonResponse(200, {
        data: [
          { id: 'c1', shipment_id: 'sh-1', amount: '35.50', charge_type: 'ExtraCharge::Overweight', created_at: '2026-10-10T00:00:00Z' },
          { shipment_id: 'sh-2', amount: '10.00' },
        ],
        meta: { next_page: 2 },
      }),
    );
    rec.on('GET', /^\/api\/v1\/finance\/extra-charges\?page=2&/, () =>
      jsonResponse(200, { data: [{ id: 7, attributes: { shipment_id: 'sh-3', amount: 12.4 } }], meta: { next_page: null } }),
    );
    const out = [];
    for await (const c of adapter.extraCharges(new Date('2026-09-01T00:00:00Z'), new Date('2026-10-15T00:00:00Z'))) out.push(c);
    expect(out).toEqual([
      { providerChargeId: 'c1', providerShipmentId: 'sh-1', trackingNumber: null, amountCents: 3550, chargeType: 'ExtraCharge::Overweight', chargedAt: '2026-10-10T00:00:00Z', status: null },
      { providerChargeId: '7', providerShipmentId: 'sh-3', trackingNumber: null, amountCents: 1240, chargeType: null, chargedAt: null, status: null },
    ]);
    expect(rec.calls.find((c) => c.path.includes('extra-charges'))!.path).toContain('start_date=2026-09-01&end_date=2026-10-15');
  });

  it('catálogos: empaques paginados; Carta Porte por código; plantillas SIN PII', async () => {
    const { rec, adapter } = setup();
    rec.on('GET', '/api/v1/shipments/packagings?page=1', () => jsonResponse(200, { data: [{ code: '4G', name: 'Caja de cartón' }], meta: { next_page: 2 } }));
    rec.on('GET', '/api/v1/shipments/packagings?page=2', () => jsonResponse(200, { data: [{ code: '5H4', name: 'Saco (bolsa) de película de plástico' }], meta: { next_page: null } }));
    rec.on('GET', '/api/v1/shipments/consignment_notes?consignment_note=49101600', () =>
      jsonResponse(200, { data: [{ consignment_note: '49101600', description: 'Coleccionables' }], meta: {} }),
    );
    rec.on('GET', /^\/api\/v1\/address_templates/, () =>
      jsonResponse(200, {
        data: [{ id: 'tpl-1', alias: 'Verapaz', address_type: 'from', default: false, address: { name: 'Dueño', phone: '5599999999', email: 'd@example.com', rfc: 'XAXX010101000', postal_code: '14210' } }],
        meta: { next_page: null },
      }),
    );
    expect(await adapter.packagings()).toEqual([
      { code: '4G', name: 'Caja de cartón' },
      { code: '5H4', name: 'Saco (bolsa) de película de plástico' },
    ]);
    expect(await adapter.consignmentNote('49101600')).toEqual({ code: '49101600', description: 'Coleccionables' });
    const tpls = await adapter.addressTemplates();
    expect(tpls).toEqual([{ id: 'tpl-1', alias: 'Verapaz', addressType: 'from', isDefault: false, postalCode: '14210' }]);
    expect(JSON.stringify(tpls)).not.toMatch(/5599999999|Dueño|XAXX|d@example/);
  });
});

describe('FakeShippingProvider — el doble con la realidad medida', () => {
  it('REUTILIZA la cotización (M-5): dos envíos misma ruta y medidas ⇒ mismo providerQuotationId; el eco dice el seguro de la primera', async () => {
    const fake = new FakeShippingProvider();
    const a = await fake.quote(QUOTE_INPUT);
    const b = await fake.quote({ ...QUOTE_INPUT, parcel: { ...QUOTE_INPUT.parcel, coverageCents: 1000000 } });
    expect(b.providerQuotationId).toBe(a.providerQuotationId);
    expect(a.insuranceEcho.ok).toBe(true);
    expect(b.insuranceEcho.ok).toBe(false);
    expect(b.rates.every((r) => r.insuranceCents === null)).toBe(true);
    const c = await fake.quote({ ...QUOTE_INPUT, parcel: { ...QUOTE_INPUT.parcel, heightCm: 4, coverageCents: 1000000 } });
    expect(c.providerQuotationId).not.toBe(a.providerQuotationId);
    expect(c.rates.find((r) => r.carrierName === 'fedex')!.insuranceCents).toBe(17000);
  });

  it('normaliza con la MISMA función que el real: conteos del fixture medido', async () => {
    const q = await new FakeShippingProvider().quote(QUOTE_INPUT);
    expect(q.rates).toHaveLength(FIXTURE_EXPECTED.offered);
    expect(q.excluded).toEqual(FIXTURE_EXPECTED.excluded);
  });

  it('compra programable: labeled / processing / error_detail / en vuelo / rechazo; registra el CUERPO real', async () => {
    const fake = new FakeShippingProvider();
    const q = await fake.quote(QUOTE_INPUT);
    const rateId = q.rates.find((r) => r.carrierName === 'ninetynineminutes')!.rateId;
    fake.purchaseOutcomes.push({ kind: 'processing' }, { kind: 'error_detail', code: 'E', message: 'm' }, { kind: 'in_flight' }, { kind: 'rejected' });
    const input = { ...PURCHASE_INPUT, rateId };
    const p1 = await fake.purchase(input);
    expect(p1.trackingNumber).toBeNull();
    expect((await fake.purchase(input)).error).toEqual({ code: 'E', message: 'm' });
    await expect(fake.purchase(input)).rejects.toBeInstanceOf(ShippingProviderPurchaseInFlightError);
    await expect(fake.purchase(input)).rejects.toMatchObject({ httpStatus: 422 });
    const ok = await fake.purchase(input);
    expect(ok.trackingNumber).toMatch(/^FAKE/);
    expect(ok.carrierName).toBe('ninetynineminutes');
    expect(ok.totalCents).toBe(7015);
    expect(ok.insuranceCents).toBe(2500);
    const body = (fake.callsOf('purchase')[0].input as { body: { shipment: { packages: unknown[] } } }).body;
    expect(body.shipment.packages[0]).toMatchObject({ package_protected: true, declared_value: 2500, consignment_note: '49101600' });
  });

  it('getShipment / eventos / cancelación programables', async () => {
    const fake = new FakeShippingProvider();
    const p = await fake.purchase(PURCHASE_INPUT);
    fake.pushEvent(p.providerShipmentId, 'picked_up', '2026-10-05T10:00:00Z');
    const s = await fake.getShipment(p.providerShipmentId);
    expect(s.carrierStatus).toBe('picked_up');
    expect(s.events).toHaveLength(1);
    fake.cancelOutcomes.push({ ok: false, code: 'x', message: 'no' }, { ok: true, refundedCents: 4625 });
    expect(await fake.cancel(p.providerShipmentId, 'r')).toEqual({ ok: false, code: 'x', message: 'no' });
    expect(await fake.cancel(p.providerShipmentId, 'r')).toEqual({ ok: true, refundedCents: 4625 });
    await expect(fake.getShipment('nope')).rejects.toBeInstanceOf(ShippingProviderError);
  });

  it('catálogos medidos (4G, 5H4, 49101600) y plantilla «Verapaz» sin PII', async () => {
    const fake = new FakeShippingProvider();
    expect((await fake.packagings()).map((p) => p.code)).toEqual(['4G', '5H4']);
    expect(await fake.consignmentNote('49101600')).toEqual({ code: '49101600', description: 'Coleccionables' });
    expect(await fake.addressTemplates()).toEqual([
      { id: 'fake-template-verapaz', alias: 'Verapaz', addressType: 'from', isDefault: false, postalCode: '14210' },
    ]);
  });
});
