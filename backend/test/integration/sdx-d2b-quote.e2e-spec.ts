/**
 * sdx-d2b-quote.e2e-spec.ts — 💰 D2b de Skydropx: `POST/GET /admin/shipments/:id/quote` contra Postgres REAL y la app
 * Nest completa por HTTP, con el proveedor DOBLE (⛔ nunca la red: PS-99) y el reloj de la guía manual. Propiedad: backend.
 *
 * Cubre (API_CONTRACT §M4-SHIP.19.6 con §19.19.4/.5, §19.20.1, §19.22.2, §19.30.5): PS-69 (guardas), PS-70 (lado servidor:
 * empaque, valor declarado, recomendada, cobrado de las columnas), PS-71 (reutilización y vigencia, lado cotizar),
 * PS-95 (mismo `providerQuotationId` en dos envíos, `force` actualiza, `expiresAt` de la primera observación),
 * PS-96 (escalón en el cuerpo que recibe el doble, sin escalón ⇒ `409` con cero llamadas, eco que no coincide ⇒ tabla,
 * `declaredValueCents` del cuerpo sin efecto), PS-105a (la cotización muere con la corrección) y C-23 en la cotización.
 * La parte de PS-71/PS-105 que COMPRA es de D2c (`sdx-d2c-label.e2e-spec.ts`).
 */
import { E2EHarness } from './helpers/e2e-app';
import { R, ShipPrepDb } from './helpers/ship-prep-db';
import { READY_ADDRESS, createLabelWorld, dial, errCode, providerOn, ready, restoreDials } from './helpers/label-db';
import { FakeShippingProvider } from '../../src/modules/shipping-provider/fake-shipping-provider';
import { ManualLabelClock } from '../../src/modules/shipments/label-clock';
import { QuoteInput } from '../../src/modules/shipping-provider/shipping-provider.port';
import { E2E_USERS } from '../../prisma/e2e-fixtures';

const RUN = `d2b${Date.now().toString(36)}`;

describe('💰 D2b — cotizar la guía (§M4-SHIP.19.6 + §19.19.4/.5)', () => {
  let h: E2EHarness;
  let db: ShipPrepDb;
  let fake: FakeShippingProvider;
  let clock: ManualLabelClock;

  const quote = (id: string, json: unknown = {}, token = db.opToken): Promise<R> => h.api('POST', `/admin/shipments/${id}/quote`, { token, json });
  const getQuote = (id: string, token = db.opToken): Promise<R> => h.api('GET', `/admin/shipments/${id}/quote`, { token });
  const quoteCalls = () => fake.callsOf('quote').length;
  const lastQuoteInput = () => fake.callsOf('quote').slice(-1)[0].input as QuoteInput;

  /** Un directo listo con piezas de los precios dados. */
  const readyDirect = async (prices: readonly number[] = [50000, 30000]) => {
    const d = await db.mkDirect({ prices });
    await ready(db, d.shipment.id);
    return d;
  };

  beforeAll(async () => {
    ({ h, db, fake, clock } = await createLabelWorld(RUN));
    await providerOn(h);
  });

  afterAll(async () => {
    await restoreDials(h);
    await db.cleanup();
    await h?.close();
  });

  beforeEach(() => {
    fake.calls.length = 0;
    fake.reuseQuotations = false;
    fake.forgetQuotations();
    clock.set(new Date());
  });

  // ================================================================ PS-69 — guardas

  describe('PS-69 — cotizar cuelga de «preparado» y de las guardas de §M4-SHIP.6 (las mismas funciones)', () => {
    it('`picking` sin `preparedAt` ⇒ 409 SHIPMENT_NOT_PREPARED, cero llamadas al doble', async () => {
      const d = await readyDirect();
      await h.prisma.shipmentRequest.update({ where: { id: d.shipment.id }, data: { preparedAt: null, preparedByUserId: null } });
      const r = await quote(d.shipment.id);
      expect(errCode(r)).toBe('409:SHIPMENT_NOT_PREPARED');
      expect(quoteCalls()).toBe(0);
    });

    it('retiro con caso `open` ⇒ 409 SHIPMENT_HAS_OPEN_REPLACEMENTS', async () => {
      const u = await db.mkUser();
      const vo = await db.mkVaultOrder(u.id, { placement: 'none' });
      const w = await db.mkWithdrawal(u.id, vo.pieces.map((p) => p.id), 'picking', { prepared: true, picked: true });
      await ready(db, w.shipment.id);
      await h.prisma.replacementCase.create({
        data: { source: 'withdrawal', shipmentRequestId: w.shipment.id, shipmentItemId: w.lines[0].id, customerUserId: u.id, originalInventoryItemId: vo.pieces[0].id, missingReason: 'not_found', originOrderItemId: vo.orderItems[0].id, openedAt: new Date(), openedByUserId: db.operatorId, status: 'open' },
      });
      const r = await quote(w.shipment.id);
      expect(errCode(r)).toBe('409:SHIPMENT_HAS_OPEN_REPLACEMENTS');
      expect(quoteCalls()).toBe(0);
      await h.prisma.replacementCase.deleteMany({ where: { shipmentRequestId: w.shipment.id } });
    });

    it('directo con la orden `refunded` ⇒ 409 ORDER_NOT_SETTLED', async () => {
      const d = await readyDirect();
      await h.prisma.order.update({ where: { id: d.order.id }, data: { status: 'refunded' } });
      expect(errCode(await quote(d.shipment.id))).toBe('409:ORDER_NOT_SETTLED');
      expect(quoteCalls()).toBe(0);
    });

    it('dial `off` ⇒ 404 FEATURE_DISABLED; sin plantilla de origen ⇒ 409 NOT_CONFIGURED {missing:[origin]}', async () => {
      const d = await readyDirect();
      await dial(h, 'shipping_provider', 'off');
      expect(errCode(await quote(d.shipment.id))).toBe('404:FEATURE_DISABLED');
      await dial(h, 'shipping_provider', 'skydropx');
      await dial(h, 'skydropx_origin_address_template_id', null);
      const r = await quote(d.shipment.id);
      expect(errCode(r)).toBe('409:SHIPPING_PROVIDER_NOT_CONFIGURED');
      expect(r.body.error.details).toEqual({ missing: ['origin'] });
      await dial(h, 'skydropx_origin_address_template_id', 'fake-template-verapaz');
      expect(quoteCalls()).toBe(0);
    });

    it('sin colonia (y sin destinatario) en el snapshot ⇒ 422 SHIPMENT_ADDRESS_INCOMPLETE con la MISMA lista que `address.missing`', async () => {
      const d = await readyDirect();
      const { neighborhood: _n, recipientName: _r, ...rest } = READY_ADDRESS;
      await h.prisma.shipmentRequest.update({ where: { id: d.shipment.id }, data: { addressSnapshot: rest } });
      const r = await quote(d.shipment.id);
      expect(errCode(r)).toBe('422:SHIPMENT_ADDRESS_INCOMPLETE');
      expect(r.body.error.details).toEqual({ missing: ['recipientName', 'neighborhood'] });
      const dto = await h.api('GET', `/admin/shipments/${d.shipment.id}`, { token: db.opToken });
      expect(dto.body.address.missing).toEqual(r.body.error.details.missing);
      expect(quoteCalls()).toBe(0);
    });

    it('ya con guía (manual legada o Skydropx) ⇒ 409 SHIPMENT_ALREADY_LABELED; reclamo vivo ⇒ 409 LABEL_IN_PROGRESS; `guia` ⇒ NOT_IN_PREPARATION', async () => {
      const d = await readyDirect();
      await h.prisma.shipmentRequest.update({ where: { id: d.shipment.id }, data: { trackingNumber: 'LEGACY1', carrier: 'dhl' } });
      const a = await quote(d.shipment.id);
      expect(errCode(a)).toBe('409:SHIPMENT_ALREADY_LABELED');
      expect(a.body.error.details).toEqual({ labelSource: 'manual' });
      const e = await readyDirect();
      await h.prisma.shipmentRequest.update({ where: { id: e.shipment.id }, data: { labelProcessingSince: new Date() } });
      expect(errCode(await quote(e.shipment.id))).toBe('409:LABEL_IN_PROGRESS');
      const f = await readyDirect();
      await h.prisma.shipmentRequest.update({ where: { id: f.shipment.id }, data: { status: 'guia' } });
      expect(errCode(await quote(f.shipment.id))).toBe('409:SHIPMENT_NOT_IN_PREPARATION');
      expect(quoteCalls()).toBe(0);
    });

    it('roles: cliente ⇒ 403; anónimo ⇒ 401; envío inexistente ⇒ 404', async () => {
      const d = await readyDirect();
      const customer = await h.login(E2E_USERS.customer.email, E2E_USERS.customer.password);
      expect((await quote(d.shipment.id, {}, customer)).status).toBe(403);
      expect((await h.api('POST', `/admin/shipments/${d.shipment.id}/quote`, { json: {} })).status).toBe(401);
      expect(errCode(await quote('00000000-0000-0000-0000-000000000000'))).toBe('404:NOT_FOUND');
    });
  });

  // ================================================================ PS-70 / PS-96 — lo que viaja y lo que vuelve

  describe('PS-70 / PS-96 — empaque, valor asegurado, escalón y la tarifa normalizada', () => {
    it('directo: valor = Σ lo pagado de las líneas `picked`; el doble recibe `coverageCents` del escalón y la colonia del snapshot', async () => {
      const d = await readyDirect([20000, 10000]); // 30000 ⇒ escalón de $2,500
      const r = await quote(d.shipment.id);
      expect(r.status).toBe(200);
      expect(r.body.insurance).toEqual({ insuredValueCents: 30000, coverageCents: 250000, costCents: 2500 });
      const input = lastQuoteInput();
      expect(input.parcel.coverageCents).toBe(250000);
      expect(input.to).toEqual({ countryCode: 'MX', postalCode: '01000', state: 'Ciudad de México', city: 'Álvaro Obregón', neighborhood: 'San Ángel' });
      expect(r.body.package.code).toBe('envelope');
      expect(r.body.rates.length).toBeGreaterThan(0);
      expect(r.body.excluded).toEqual({ unavailable: 2, noCoverage: 12, notApplicable: 5, multipackage: 0, breakdownMismatch: 0 });
      const rec = r.body.rates.find((x: any) => x.recommended);
      expect(rec.carrierName).toBe('ninetynineminutes');
      expect(r.body.recommendedRateId).toBe(rec.rateId);
      expect(r.body.rates.filter((x: any) => x.hidden).every((x: any) => x.deliveryKind === 'branch')).toBe(true);
      // ⛔ nada crudo del proveedor en el DTO
      expect(JSON.stringify(r.body)).not.toMatch(/rawResponseJson|provider_name|protection_value_total/);
      // ⛔ cotizar NO escribe el envío
      const s = await h.prisma.shipmentRequest.findUniqueOrThrow({ where: { id: d.shipment.id } });
      expect({ src: s.labelSource, since: s.labelProcessingSince, rate: s.providerRateId }).toEqual({ src: null, since: null, rate: null });
    });

    it('retiro: cobrado = columnas del envío (20300 ⇒ neto 17500); valor = mercado de «Mi bóveda» y, sin mercado, lo pagado', async () => {
      const u = await db.mkUser();
      const withMarket = await db.mkCard(40000);
      const noMarket = await db.mkCard(null);
      const vo = await db.mkVaultOrder(u.id, { placement: 'none', prices: [10000, 30000], cardIds: [withMarket.id, noMarket.id] });
      const w = await db.mkWithdrawal(u.id, vo.pieces.map((p) => p.id), 'picking', { prepared: true, picked: true });
      await ready(db, w.shipment.id);
      const r = await quote(w.shipment.id);
      expect(r.status).toBe(200);
      expect(r.body.charged).toEqual({ grossCents: 20300, netCents: 17500 });
      expect(r.body.insurance.insuredValueCents).toBe(40000 + 30000);
      const p = r.body.rates.find((x: any) => x.carrierName === 'paquetexpress');
      expect(p.marginCents).toBe(17500 - p.netCostCents);
    });

    it('empaque: 3 cartas + 1 sellado ⇒ box; `packageCode:"envelope"` explícito gana; código inexistente ⇒ 400', async () => {
      const d = await readyDirect([1000, 1000, 1000, 1000]);
      await h.prisma.inventoryItem.update({ where: { id: d.pieces[3].id }, data: { productType: 'sealed', rawCondition: null, sealedSubtype: 'box', sealedCondition: 'mint' } });
      const a = await quote(d.shipment.id);
      expect(a.body.package.code).toBe('box');
      expect(lastQuoteInput().parcel).toMatchObject({ lengthCm: 49, widthCm: 23, heightCm: 21, weightKg: 5 });
      const b = await quote(d.shipment.id, { packageCode: 'envelope' });
      expect(b.body.package.code).toBe('envelope');
      expect(errCode(await quote(d.shipment.id, { packageCode: 'nope' }))).toBe('400:VALIDATION_ERROR');
    });

    it('PS-96: valor > último escalón ⇒ 409 {missing:[insurance_tier], insuredValueCents, maxCoverageCents} y CERO llamadas', async () => {
      const d = await readyDirect([600000, 400001]);
      const r = await quote(d.shipment.id);
      expect(errCode(r)).toBe('409:SHIPPING_PROVIDER_NOT_CONFIGURED');
      expect(r.body.error.details).toEqual({ missing: ['insurance_tier'], insuredValueCents: 1000001, maxCoverageCents: 1000000 });
      expect(quoteCalls()).toBe(0);
    });

    it('PS-96: exactamente 250000 ⇒ escalón 250000 (no 10000); 250001 ⇒ 1000000; `declaredValueCents` del cuerpo sin efecto', async () => {
      const a = await readyDirect([250000]);
      await quote(a.shipment.id, { declaredValueCents: 1 });
      expect(lastQuoteInput().parcel.coverageCents).toBe(250000);
      const b = await readyDirect([250001]);
      const rb = await quote(b.shipment.id);
      expect(lastQuoteInput().parcel.coverageCents).toBe(1000000);
      expect(rb.body.insurance).toEqual({ insuredValueCents: 250001, coverageCents: 1000000, costCents: 17000 });
    });

    it('PS-96: eco que NO coincide (cotización reutilizada por el proveedor con otro seguro) ⇒ `tier_table` y el costo de la tabla', async () => {
      fake.reuseQuotations = true;
      const a = await readyDirect([1000]); // primera: cobertura 250000
      const ra = await quote(a.shipment.id);
      expect(ra.body.rates.every((x: any) => x.insuranceSource === 'quote')).toBe(true);
      const b = await readyDirect([300000]); // misma ruta y medidas ⇒ MISMO id, eco con el seguro de la primera
      const rb = await quote(b.shipment.id);
      expect(rb.body.providerQuotationId).toBe(ra.body.providerQuotationId);
      expect(rb.body.rates.every((x: any) => x.insuranceSource === 'tier_table' && x.breakdown.insuranceCents === 17000)).toBe(true);
      expect(rb.body.insurance.costCents).toBe(17000);
    });
  });

  // ================================================================ PS-71 / PS-95 — reutilización y vigencia

  describe('PS-71 / PS-95 — reutilización y vigencia (§19.19.4, §19.6 paso 6)', () => {
    it('segunda cotización < 24 h con mismos parámetros ⇒ `reused:true`, CERO llamadas; con `force` o distinto empaque ⇒ llamada nueva', async () => {
      const d = await readyDirect();
      const a = await quote(d.shipment.id);
      expect(a.body.reused).toBe(false);
      const b = await quote(d.shipment.id);
      expect({ reused: b.body.reused, quoteId: b.body.quoteId, calls: quoteCalls() }).toEqual({ reused: true, quoteId: a.body.quoteId, calls: 1 });
      expect(b.body.excluded).toEqual(a.body.excluded);
      expect(b.body.rates).toEqual(a.body.rates);
      await quote(d.shipment.id, { force: true });
      expect(quoteCalls()).toBe(2);
      await quote(d.shipment.id, { packageCode: 'box' });
      expect(quoteCalls()).toBe(3);
      const g = await getQuote(d.shipment.id);
      expect(g.status).toBe(200);
      expect(g.body.package.code).toBe('box');
    });

    it('reloj a +24 h ⇒ `GET` 404 y `POST` sin `force` vuelve a llamar', async () => {
      const d = await readyDirect();
      await quote(d.shipment.id);
      clock.advance(24 * 60 * 60 * 1000 + 1000);
      expect((await getQuote(d.shipment.id)).status).toBe(404);
      await quote(d.shipment.id);
      expect(quoteCalls()).toBe(2);
    });

    it('PS-95: el MISMO `providerQuotationId` para dos envíos ⇒ dos filas, cero 500; `expiresAt` = primera observación + 24 h', async () => {
      fake.reuseQuotations = true;
      const a = await readyDirect([1111]);
      const b = await readyDirect([2222]);
      const ra = await quote(a.shipment.id);
      clock.advance(60 * 60 * 1000); // +1 h
      const rb = await quote(b.shipment.id);
      expect([ra.status, rb.status]).toEqual([200, 200]);
      expect(rb.body.providerQuotationId).toBe(ra.body.providerQuotationId);
      const rows = await h.prisma.shipmentQuote.findMany({ where: { providerQuotationId: ra.body.providerQuotationId } });
      expect(rows.map((q) => q.shipmentRequestId).sort()).toEqual([a.shipment.id, b.shipment.id].sort());
      expect(rb.body.expiresAt).toBe(ra.body.expiresAt); // ⛔ no `now + 24 h` sobre un id ya visto
      // mismo envío con `force` ⇒ la fila se ACTUALIZA (una sola), `requestedAt` intacto
      const again = await quote(a.shipment.id, { force: true });
      expect(again.body.quoteId).toBe(ra.body.quoteId);
      expect(again.body.requestedAt).toBe(ra.body.requestedAt);
      expect(await h.prisma.shipmentQuote.count({ where: { shipmentRequestId: a.shipment.id } })).toBe(1);
    });
  });

  // ================================================================ PS-105a — la corrección mata la cotización

  describe('PS-105a — la cotización muere con la corrección de la dirección (§19.20.1, D2b)', () => {
    it('cotizar (v0) ⇒ corregir (v1) ⇒ `GET` 404; `POST` sin `force` LLAMA al doble (no reutiliza)', async () => {
      const d = await readyDirect();
      await quote(d.shipment.id);
      expect((await getQuote(d.shipment.id)).status).toBe(200);
      const fix = await h.api('PUT', `/admin/shipments/${d.shipment.id}/address`, {
        token: db.opToken,
        json: { expectedAddressVersion: 0, ...READY_ADDRESS, line1: 'Av. Revolución 1600', country: undefined, phone: undefined },
      });
      expect(fix.body.outcome).toBe('corrected');
      expect((await getQuote(d.shipment.id)).status).toBe(404);
      const r = await quote(d.shipment.id);
      expect(r.body.reused).toBe(false);
      expect(quoteCalls()).toBe(2);
      const rows = await h.prisma.shipmentQuote.findMany({ where: { shipmentRequestId: d.shipment.id }, orderBy: { requestedAt: 'asc' } });
      expect(rows[rows.length - 1].addressVersion).toBe(1);
    });
  });

  // ================================================================ C-23 — el destino viaja neutralizado también al COTIZAR

  describe('C-23 — la cotización tampoco lleva texto con forma de folio (§19.30.5)', () => {
    it('colonia/municipio/estado con «Pedido ENV-000046-01» (ASCII, ancho completo y guiones tipográficos) ⇒ el doble recibe texto neutralizado; el snapshot intacto', async () => {
      const d = await readyDirect();
      const forged = { ...READY_ADDRESS, neighborhood: 'Pedido ＥＮＶ－000046－01', city: 'Pedido ENV–000046–01', state: 'ENV-000046-01' };
      await ready(db, d.shipment.id, forged);
      const r = await quote(d.shipment.id);
      expect(r.status).toBe(200);
      const sent = JSON.stringify(lastQuoteInput().to).normalize('NFKC');
      expect(sent).not.toMatch(/ENV\s*[-‐–—]\s*\d/i);
      const s = await h.prisma.shipmentRequest.findUniqueOrThrow({ where: { id: d.shipment.id } });
      expect(s.addressSnapshot).toEqual(forged);
    });
  });

  it('bitácora `shipment.quoted` solo cuando se habló con el proveedor', async () => {
    const d = await readyDirect();
    await quote(d.shipment.id);
    await quote(d.shipment.id); // reutilizada
    const logs = await db.audits(d.shipment.id, 'shipment.quoted');
    expect(logs).toHaveLength(1);
    expect(Object.keys(logs[0].after as object).sort()).toEqual(['declaredValueCents', 'packageCode', 'providerQuotationId', 'quoteId', 'rates', 'recommendedRateId']);
  });
});
