/**
 * sdx-d2c.provider.spec.ts — 💰🔒 lo que D2c cambia en el LADO DEL PROVEEDOR (cliente, adaptador, doble), con el transporte
 * GRABADOR y el reloj virtual (⛔ nunca la red: PS-99). Propiedad: backend.
 *
 *  - PS-116 (lado adaptador, §19.26.1, SDX-D-1): id LEGIBLE o `null` (⛔ nunca `''`); `2xx` con id + `error_detail` ⇒ id
 *    y error; `422` con `data.id` ⇒ el id llega en `details.providerShipmentId` (UN parser de sobre).
 *  - PS-131 (d) (§19.28.2, C-10 (c)(d)): `429` con `Retry-After: 60` repetido ⇒ ningún intento sale tras `notAfter` y el
 *    error es `PurchaseDeadlineError` (⛔ no «en vuelo»); un cuerpo que no termina ⇒ el intento muere en su plazo.
 *  - PS-135 (b) lado cuerpo (§19.28.1): `address_to.reference` = «Pedido <token>».
 *  - `recentShipments` (§19.27.4, §19.28.1/.4): solo `GET /api/v1/shipments` (⛔ nunca v2), folio por RELACIÓN
 *    `address_to` (la primera dirección de `included` puede ser la de origen), `coversFrom` por `total_count`, ilegible.
 */
import { SkydropxClient } from '../src/modules/shipping-provider/http/skydropx-client';
import { SkydropxAdapter, buildPurchaseBody } from '../src/modules/shipping-provider/skydropx.adapter';
import {
  PurchaseDeadlineError,
  ShippingProviderError,
  ShippingProviderPurchaseInFlightError,
} from '../src/modules/shipping-provider/shipping-provider.errors';
import { PurchaseInput } from '../src/modules/shipping-provider/shipping-provider.port';
import { FakeShippingProvider } from '../src/modules/shipping-provider/fake-shipping-provider';
import {
  CapturedLogger,
  FAKE_CLIENT_ID,
  FAKE_SECRET,
  FakeClock,
  RECORDER_ORIGIN,
  RecorderTransport,
  jsonResponse,
  withSpendGateOpen,
} from './helpers/skydropx-recorder';

function setup(timeouts = { defaultMs: 40, purchaseMs: 60 }) {
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
    timeouts,
  });
  return { clock, rec, logger, client, adapter: new SkydropxAdapter({ client, clock, logger }) };
}

const INPUT: PurchaseInput = {
  rateId: 'r-1',
  printingFormat: 'standard',
  from: { templateId: 'tpl', snapshot: null },
  to: { street1: 'Calle 1 Int. 4', name: 'Ana', company: 'Ana', phone: '5512345678', email: 'a@example.com', reference: 'Pedido ENV-000045-01', furtherInformation: 'Portón' },
  package: { coverageCents: 250000, consignmentNote: '49101600', packageType: '5H4' },
  idempotencyKey: 'label:s1:r-1',
};

const caught = async <T>(p: Promise<T>) => p.then(() => null as never, (e: unknown) => e as ShippingProviderError);

describe('PS-116 (adaptador) — un id de compra presente NUNCA se descarta (§19.26.1)', () => {
  it('`2xx` con id ⇒ ese id; con id y `error_detail` ⇒ id + error (rechazo con id)', async () => {
    const { rec, adapter } = setup();
    rec.on('POST', '/api/v2/shipments', (_c, n) =>
      n === 1
        ? jsonResponse(201, [{ data: { id: 'sdx-1', attributes: { master_tracking_number: null } } }])
        : jsonResponse(201, { data: { id: 'sdx-2', attributes: { error_detail: { error_code: 'X', error_message: 'malo' } } } }),
    );
    const a = await withSpendGateOpen(rec, () => adapter.purchase(INPUT));
    expect({ id: a.providerShipmentId, err: a.error }).toEqual({ id: 'sdx-1', err: null });
    const b = await withSpendGateOpen(rec, () => adapter.purchase(INPUT));
    expect({ id: b.providerShipmentId, err: b.error?.code }).toEqual({ id: 'sdx-2', err: 'X' });
  });

  it('`error_detail` SIN id (o con id en blanco) ⇒ `providerShipmentId === null` (⛔ nunca `""`)', async () => {
    const { rec, adapter } = setup();
    rec.on('POST', '/api/v2/shipments', (_c, n) =>
      jsonResponse(201, { data: { ...(n === 1 ? {} : { id: '   ' }), attributes: { error_detail: { error_code: 'X', error_message: 'malo' } } } }),
    );
    const a = await withSpendGateOpen(rec, () => adapter.purchase(INPUT));
    expect(a.providerShipmentId).toBeNull();
    const b = await withSpendGateOpen(rec, () => adapter.purchase(INPUT));
    expect(b.providerShipmentId).toBeNull();
  });

  it('`422` cuyo cuerpo trae `data.id` ⇒ rechazo con `details.providerShipmentId`; sin id ⇒ sin la llave', async () => {
    const { rec, adapter } = setup();
    rec.on('POST', '/api/v2/shipments', (_c, n) =>
      n === 1 ? jsonResponse(422, { data: { id: 'sdx-422', attributes: {} }, message: 'no' }) : jsonResponse(422, { message: 'no' }),
    );
    const a = await withSpendGateOpen(rec, () => caught(adapter.purchase(INPUT)));
    expect(a).toBeInstanceOf(ShippingProviderError);
    expect(a.code).toBe('SHIPPING_PROVIDER_REJECTED');
    expect(a.details.providerShipmentId).toBe('sdx-422');
    const b = await withSpendGateOpen(rec, () => caught(adapter.purchase(INPUT)));
    expect(b.details).not.toHaveProperty('providerShipmentId');
    expect(rec.callsTo('POST', '/api/v2/shipments')).toHaveLength(2);
  });
});

describe('PS-131 (d) — la compra tiene vida máxima (§19.28.2)', () => {
  it('`429` con `Retry-After: 60` tres veces y `notAfter = t0 + 120 s` ⇒ ningún intento después del plazo; `PurchaseDeadlineError` (503, ⛔ no en vuelo)', async () => {
    const { rec, client, clock } = setup();
    rec.on('POST', '/api/v2/shipments', () => jsonResponse(429, { message: 'slow down' }, { 'retry-after': '60' }));
    const notAfter = clock.now() + 120_000;
    const err = await withSpendGateOpen(rec, () => caught(client.mutate({ op: 'purchase', body: {}, idempotencyKey: 'k', notAfter })));
    expect(err).toBeInstanceOf(PurchaseDeadlineError);
    expect(err).not.toBeInstanceOf(ShippingProviderPurchaseInFlightError);
    expect(err.httpStatus).toBe(503);
    const posts = rec.callsTo('POST', '/api/v2/shipments');
    for (const c of posts) expect(c.at).toBeLessThanOrEqual(notAfter);
    // t0 y t0+60 s salen; el 3.º caería en t0+120 s + el turno de la cubeta (> plazo) ⇒ la puerta lo corta ANTES de la red.
    expect(posts.length).toBe(2);
  });

  it('un cuerpo `2xx` que nunca termina ⇒ el intento muere en su plazo (cabeceras Y cuerpo bajo el temporizador) y es «en vuelo»', async () => {
    const { rec, client } = setup({ defaultMs: 40, purchaseMs: 60 });
    rec.on('POST', '/api/v2/shipments', () => ({
      status: 201,
      headers: { get: () => 'application/json' },
      text: () => new Promise<string>(() => undefined),
    }));
    const started = Date.now();
    const err = await withSpendGateOpen(rec, () => caught(client.mutate({ op: 'purchase', body: {}, idempotencyKey: 'k' })));
    expect(err).toBeInstanceOf(ShippingProviderPurchaseInFlightError);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(rec.callsTo('POST', '/api/v2/shipments')).toHaveLength(1);
  });

  it('una LECTURA con cuerpo colgado también muere (y se reintenta como red, ≤ 2)', async () => {
    const { rec, adapter } = setup({ defaultMs: 30, purchaseMs: 60 });
    rec.on('GET', '/api/v1/finance/credits', () => ({ status: 200, headers: { get: () => null }, text: () => new Promise<string>(() => undefined) }));
    const err = await caught(adapter.balance());
    expect(err.code).toBe('SHIPPING_PROVIDER_BUSY');
    expect(rec.callsTo('GET', '/api/v1/finance/credits')).toHaveLength(3);
  });
});

describe('PS-135 (b) — el cuerpo de la compra lleva NUESTRO folio en `address_to.reference` (§19.28.1)', () => {
  it('`reference` = el texto exacto; `further_information` = las referencias del cliente', () => {
    const body = buildPurchaseBody(INPUT) as { shipment: { address_to: Record<string, unknown> } };
    expect(body.shipment.address_to.reference).toBe('Pedido ENV-000045-01');
    expect(body.shipment.address_to.further_information).toBe('Portón');
  });
});

describe('`recentShipments` — verificación de SOLO LECTURA (§19.27.4, §19.28.1/.4)', () => {
  const page = (items: unknown[], included: unknown[], total: number) => ({ data: items, included, meta: { total_count: total } });
  const ship = (id: string, toId: string, extra: Record<string, unknown> = {}) => ({
    id,
    type: 'shipment',
    attributes: { created_at: '2026-10-04T04:00:05Z', carrier_name: 'ninetynineminutes', total: '70.15', source: 'api', ...extra },
    relationships: { address_from: { data: { id: 'from-1', type: 'address' } }, address_to: { data: { id: toId, type: 'address' } } },
  });

  it('solo `GET /api/v1/shipments` (⛔ v2); el folio sale de la dirección de DESTINO por relación, no de la primera de `included`', async () => {
    const { rec, adapter } = setup();
    rec.on('GET', /^\/api\/v1\/shipments\?page=1/, () =>
      jsonResponse(
        200,
        page(
          [ship('Y', 'to-y'), ship('Z', 'to-z', { error_detail: { error_code: 'E' } })],
          [
            // la de ORIGEN primero, con un texto que parece nuestro folio (es de la plantilla)
            { id: 'from-1', type: 'address', attributes: { reference: 'Pedido ENV-000045-01', postal_code: '14210' } },
            { id: 'to-y', type: 'address', attributes: { reference: 'Pedido ENV-000045-01', postal_code: '01000' } },
            { id: 'to-z', type: 'address', attributes: { reference: 'Portón negro', postal_code: '06600' } },
          ],
          2,
        ),
      ),
    );
    const r = await adapter.recentShipments(new Date('2026-10-04T03:58:00Z'));
    expect(r.readable).toBe(true);
    expect(r.coversFrom).toBe(true);
    expect(r.shipments).toEqual([
      { providerShipmentId: 'Y', createdAt: '2026-10-04T04:00:05Z', carrierName: 'ninetynineminutes', totalCents: 7015, postalCodeTo: '01000', source: 'api', hasError: false, providerReference: 'ENV-000045-01' },
      { providerShipmentId: 'Z', createdAt: '2026-10-04T04:00:05Z', carrierName: 'ninetynineminutes', totalCents: 7015, postalCodeTo: '06600', source: 'api', hasError: true, providerReference: null },
    ]);
    expect(rec.calls.filter((c) => c.method !== 'POST' || !c.path.startsWith('/api/v1/oauth')).every((c) => c.method === 'GET' && c.path.startsWith('/api/v1/shipments?'))).toBe(true);
    expect(rec.callsTo('POST', /\/api\/v2\//)).toHaveLength(0);
  });

  it('sin `total_count` que cubra ⇒ lee hasta 3 páginas y `coversFrom:false`; sobre ilegible ⇒ `readable:false`', async () => {
    const { rec, adapter } = setup();
    rec.on('GET', /^\/api\/v1\/shipments\?page=/, () => jsonResponse(200, page([ship('A', 'to-a')], [], 999)));
    const r = await adapter.recentShipments(new Date());
    expect({ readable: r.readable, coversFrom: r.coversFrom, n: r.shipments.length }).toEqual({ readable: true, coversFrom: false, n: 3 });
    expect(rec.callsTo('GET', /^\/api\/v1\/shipments\?/)).toHaveLength(3);
    const other = setup();
    other.rec.on('GET', /^\/api\/v1\/shipments\?page=/, () => jsonResponse(200, { nope: true }));
    const bad = await other.adapter.recentShipments(new Date());
    expect({ readable: bad.readable, coversFrom: bad.coversFrom }).toEqual({ readable: false, coversFrom: false });
  });
});

describe('el DOBLE (lo que las pruebas de D2c programan)', () => {
  it('lista lo que compró con su folio y CP; «rechazo con id» y «422 con id»; saldo por secuencia', async () => {
    const fake = new FakeShippingProvider();
    await fake.quote({ from: { templateId: 't' }, to: { countryCode: 'MX', postalCode: '01000', state: 'E', city: 'M', neighborhood: 'C' }, parcel: { lengthCm: 1, widthCm: 1, heightCm: 1, weightKg: 1, coverageCents: 250000 } });
    const rateId = fake.callsOf('quote').length > 0 ? (await fake.quote({ from: { templateId: 't' }, to: { countryCode: 'MX', postalCode: '01000', state: 'E', city: 'M', neighborhood: 'C' }, parcel: { lengthCm: 1, widthCm: 1, heightCm: 1, weightKg: 1, coverageCents: 250000 } })).rates[0].rateId : '';
    const p = await fake.purchase({ ...INPUT, rateId });
    const listed = await fake.recentShipments(new Date(0));
    expect(listed.shipments.find((s) => s.providerShipmentId === p.providerShipmentId)).toMatchObject({ providerReference: 'ENV-000045-01', postalCodeTo: '01000', source: 'api' });
    fake.purchaseOutcomes.push({ kind: 'error_detail', code: 'X', message: 'm' }, { kind: 'error_detail', code: 'X', message: 'm', withoutId: true }, { kind: 'rejected', providerShipmentId: 'sdx-r' });
    expect((await fake.purchase(INPUT)).providerShipmentId).toEqual(expect.any(String));
    expect((await fake.purchase(INPUT)).providerShipmentId).toBeNull();
    const e = await caught(fake.purchase(INPUT));
    expect(e.details.providerShipmentId).toBe('sdx-r');
    fake.balanceSequence.push(100000, new Error('boom'), 90000);
    expect((await fake.balance()).balanceCents).toBe(100000);
    await expect(fake.balance()).rejects.toThrow('boom');
    expect((await fake.balance()).balanceCents).toBe(90000);
    expect((await fake.balance()).balanceCents).toBe(fake.balanceCents);
  });
});
