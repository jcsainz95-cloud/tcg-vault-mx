/**
 * bsd-b2-inbound.e2e-spec.ts — 💰 rev BSD-1, paso B-2 (API_CONTRACT §BSD.3, §BSD.4.1/.2/.4/.6, §BSD.8.2; erratas BSD-1.1
 * C-1/C-6 y BSD-1.3 puntos 2/5): la guía de ENTRADA del buylist sobre el MISMO motor de compra, contra Postgres REAL y la app
 * Nest completa por HTTP, con el proveedor DOBLE (⛔ nunca la red: PS-99) y la llave de gasto SUSTITUIDA (⛔ ninguna prueba
 * pone `SKYDROPX_ALLOW_SPEND`).
 *
 * | ID | Qué afirma | Mutación |
 * |---|---|---|
 * | BSD-B4 | `inbound-shipment`: copia, `userId` nulo, montos 0, idempotente, guardas en orden; N ≥ 10 rondas × 5 simultáneas ⇒ 1 fila | **por pares** (errata BSD-1.4 punto 1): quitar A LA VEZ el candado de la solicitud y el manejo de `P2002` ⇒ `500`. Cada muro solo no muerde (0/10); el de `P2002` tiene su canario determinista, BSD-B45 (`test/bsd-b5.units.spec.ts`) |
 * | BSD-B5 | `quote`: `from` = vendedor, `to` = tienda; cobertura por `offerGrossCents`; margen = tarifa − neto; recomendada = la más barata a domicilio; sin `recipientName` ⇒ 422 con 0 llamadas | `to` desde el snapshot; recomendada de salida |
 * | BSD-B6 | claves de destino ⇒ 400 con 0 llamadas; la compra lleva `address_to.postal_code` = la tienda | quitar la lista de claves |
 * | BSD-B7 | sin dial / sin llave ⇒ `canPurchase=false`, 404 / 409, 0 `port.purchase` | saltar `assertGate` |
 * | BSD-B8 | compra con número: fila, libros, solicitud (paquetería LEGIBLE, número, plazo), UN AV-7 con PDF, CERO AV-4 | sin `writeSellRequestGuide`; AV-4 |
 * | BSD-B9 | doble clic y dos personas, N ≥ 10 rondas ⇒ toda respuesta es `200 labeled`/`200 in_progress`/`409 CONFLICT {purchase_in_flight}`/`409 SHIPMENT_ALREADY_LABELED` (⛔ `5xx`), y 1 `port.purchase` y 1 guía pagada por ronda | errata BSD-1.5 punto 1 (§BSD.19): quitar A LA VEZ los TRES muros de `label-purchase.service.ts` — el candado consultivo, la relectura `in_progress` de `claim` bajo I-BSD-4 y `labelProcessingSince: null` del CAS ⇒ roja por el CONJUNTO de respuestas (proporción y muro de abajo: BACKEND_NOTES §78.B6) |
 * | BSD-B10 | «en proceso» ⇒ sin plazo ni correo; el job trae el número ⇒ plazo + UN AV-7 | plazo en `persistProcessing`; `status:'picking'` en el job |
 * | BSD-B11 | errata BSD-1.4 punto 5: la compra de una guía de entrada no cambia la oferta ni ninguna cifra `*Cents` del portal (el neto se calcula al PAGAR: BSD-B46, `bsd-b5.e2e-spec.ts`) | — |
 * | BSD-B12 | TG-1 cuenta la guía de entrada (403 + AG-3); ⛔ AG-1 tras corregir el origen; ⛔ AG-10 a 3 días | sin filtro `kind` en spend-watch |
 * | BSD-B22 | `GET /buylist/requests/:id/label.pdf`: dueño 200 PDF; otro 404 NOT_FOUND; manual/cancelada/cerrada 404 LABEL_NOT_AVAILABLE; ningún DTO de cliente trae `labelUrl` | saltar la comprobación de dueño |
 * | BSD-B24 | rutas solo-salida ⇒ 404; fuera de la lista admin y de `GET /shipments` del vendedor | quitar el 404 de `PATCH :id/status` |
 * | BSD-B26 | re-emitir: fila `solicitado`, solicitud sin guía y re-anclada; «ya lo mandé» ⇒ 409; la compra nueva manda AV-7 «sustituye» | no limpiar `shipDeadlineAt` |
 * | BSD-B27 (costura) | `scrubInboundShipmentPii` en la tx del llamador: vacía el domicilio de la fila de entrada del vendedor y borra sus revisiones | ver la prueba |
 *
 * ⚠️ BSD-B27 POR HTTP depende de que `deleteUser` (`admin.service.ts`) llame a la costura; BSD-B13/B28 y `labelPdfAvailable`
 * del DTO de cliente (C-1) los cablea B-3 en `buylist.service.ts`. Aquí, la costura de B-2 en su transacción.
 */
import { Prisma } from '@prisma/client';
import { E2EHarness } from './helpers/e2e-app';
import { R, ShipPrepDb } from './helpers/ship-prep-db';
import { READY_ADDRESS, buyBody, createLabelWorld, dial, errCode, purchaseOn, restoreDials } from './helpers/label-db';
import { FakeShippingProvider } from '../../src/modules/shipping-provider/fake-shipping-provider';
import { PurchaseInput, QuoteInput } from '../../src/modules/shipping-provider/shipping-provider.port';
import { ManualLabelClock } from '../../src/modules/shipments/label-clock';
import { MAIL_PORT, MailMessage, MailPort } from '../../src/modules/mail/mail.port';
import { addBusinessDays } from '../../src/common/business-days';
import { ShipmentsService } from '../../src/modules/shipments/shipments.service';
import { ShipmentLabelProcessingJob } from '../../src/modules/shipments/label-processing.job';
import { SpendWatchService } from '../../src/modules/spend-alerts/spend-watch.service';
import { scrubInboundShipmentPii } from '../../src/modules/shipments/inbound-sync';

const RUN = `b2${Date.now().toString(36)}`;
const N = 10;
const DAY = 24 * 60 * 60 * 1000;

/** La tienda (`skydropx_origin_snapshot`): el DESTINO de toda guía de entrada (I-BSD-5). */
const STORE = {
  name: 'TCG HUNT',
  company: 'TCG HUNT SA de CV',
  street1: 'Verapaz 123',
  postalCode: '14210',
  areaLevel1: 'Ciudad de México',
  areaLevel2: 'Tlalpan',
  areaLevel3: 'Pedregal de San Nicolás',
  phone: '5511112222',
  email: 'tienda@e2e.local',
  reference: 'Portón gris',
};

/** El domicilio de recolección del vendedor (con un `addressId` que ⛔ no debe viajar a la fila de entrada). */
const PICKUP = { ...READY_ADDRESS, addressId: 'addr-e2e-b2' };

describe('💰 B-2 — la guía de ENTRADA del buylist sobre el mismo motor (§BSD.3/.4)', () => {
  let h: E2EHarness;
  let db: ShipPrepDb;
  let fake: FakeShippingProvider;
  let clock: ManualLabelClock;
  let spend: { on: boolean };
  let bandeja: MailMessage[];
  const srIds: string[] = [];

  const open = (srId: string, json: unknown = {}, token = db.opToken): Promise<R> => h.api('POST', `/admin/buylist/${srId}/inbound-shipment`, { token, json });
  const quote = (id: string, json: unknown = {}, token = db.opToken): Promise<R> => h.api('POST', `/admin/shipments/${id}/quote`, { token, json });
  const buy = (id: string, json: unknown, token = db.opToken): Promise<R> => {
    clock.advance(1);
    return h.api('POST', `/admin/shipments/${id}/label`, { token, json });
  };
  const row = (id: string) => h.prisma.shipmentRequest.findUniqueOrThrow({ where: { id } });
  const sr = (id: string) => h.prisma.sellRequest.findUniqueOrThrow({ where: { id } });
  const purchases = (shipmentId: string) =>
    fake
      .callsOf('purchase')
      .map((c) => c.input as { input: PurchaseInput; body: any })
      .filter((c) => c.input.idempotencyKey.startsWith(`label:${shipmentId}:`));
  const quotesTo = () => fake.callsOf('quote').map((c) => c.input as QuoteInput);
  const mailsTo = (email: string) => bandeja.filter((m) => m.to === email);
  const recommendedOf = (q: any) => q.rates.find((r: any) => r.rateId === q.recommendedRateId);

  /** Una solicitud `aceptada` con oferta (bruto 1 500, tarifa 180, neto 1 320) y domicilio de recolección. */
  const mkAccepted = async (over: Partial<Prisma.SellRequestUncheckedCreateInput> = {}, pickup: unknown = PICKUP) => {
    const seller = await db.mkUser('Vendedora B2');
    const s = await h.prisma.sellRequest.create({
      data: {
        userId: seller.id,
        status: 'aceptada',
        acceptedAt: new Date(),
        quotedTotalCents: 150000,
        offerGrossCents: 150000,
        offerShippingFeeCents: 18000,
        offerNetCents: 132000,
        pickupAddressSnapshot: pickup === null ? Prisma.DbNull : (pickup as Prisma.InputJsonValue),
        ...over,
        items: {
          create: [{ cardId: db.cardId, productType: 'raw', rawCondition: 'NM', quotedPriceCents: 150000, offerDecision: 'buy', offeredPriceCents: 150000 }],
        },
      },
    });
    srIds.push(s.id);
    return { sr: s, seller };
  };

  /** Solicitud aceptada + fila de entrada abierta + cotizada; la tarifa = la recomendada. */
  const readyInbound = async (over: Partial<Prisma.SellRequestUncheckedCreateInput> = {}) => {
    const a = await mkAccepted(over);
    const o = await open(a.sr.id);
    expect(errCode(o)).toBe('200');
    const id = o.body.shipment.id as string;
    const q = await quote(id);
    expect(errCode(q)).toBe('200');
    return { ...a, id, q: q.body, rate: recommendedOf(q.body) };
  };

  beforeAll(async () => {
    ({ h, db, fake, clock, spend } = await createLabelWorld(RUN));
    await purchaseOn(h, 'operators');
    await dial(h, 'skydropx_origin_snapshot', STORE);
    await dial(h, 'operator_label_cap_24h_cents', 1_000_000_000);
    await dial(h, 'shipping_label_reissue_max_per_shipment', 5);
    const port = h.app.get<MailPort>(MAIL_PORT);
    jest.spyOn(port, 'send').mockImplementation(async (msg: MailMessage) => {
      bandeja.push(msg);
      return {};
    });
  });

  afterAll(async () => {
    const p = h.prisma;
    const inbound = (await p.shipmentRequest.findMany({ where: { sellRequestId: { in: srIds } }, select: { id: true } })).map((r) => r.id);
    await p.shipmentPaidLabel.deleteMany({ where: { shipmentRequestId: { in: inbound } } });
    await p.shipmentLabelAttempt.deleteMany({ where: { shipmentRequestId: { in: inbound } } });
    await p.shipmentCostAdjustment.deleteMany({ where: { shipmentRequestId: { in: inbound } } });
    await p.spendAlert.deleteMany({ where: { OR: [{ shipmentRequestId: { in: inbound } }, { subjectUserId: { in: [db.operatorId, db.adminId] } }] } });
    await p.shipmentRequest.deleteMany({ where: { id: { in: inbound } } });
    await p.auditLog.deleteMany({ where: { entityId: { in: [...srIds, ...inbound] } } });
    await p.sellRequest.deleteMany({ where: { id: { in: srIds } } });
    await restoreDials(h);
    await db.cleanup();
    await h?.close();
  });

  beforeEach(async () => {
    fake.calls.length = 0;
    fake.purchaseOutcomes.length = 0;
    fake.cancelOutcomes.length = 0;
    fake.purchaseBarrier = null;
    fake.onPurchase = null;
    fake.balanceCents = 10_000_000;
    fake.reuseQuotations = false;
    fake.forgetQuotations();
    clock.set(new Date());
    spend.on = true;
    bandeja = [];
    await dial(h, 'shipping_provider', 'skydropx');
    await dial(h, 'shipping_label_purchase', 'operators');
    await dial(h, 'skydropx_origin_snapshot', STORE);
  });

  afterEach(async () => {
    // Un reclamo «en vuelo» que una prueba dejó vivo bloquearía la compra de la siguiente (§19.28.8).
    await h.prisma.shipmentRequest.updateMany({
      where: { sellRequestId: { in: srIds }, labelProcessingSince: { not: null }, providerShipmentId: null },
      data: { labelProcessingSince: null, providerRateId: null },
    });
  });

  // ================================================================ BSD-B4

  describe('BSD-B4 — `POST /admin/buylist/:id/inbound-shipment`', () => {
    it('crea la fila: copia campo por campo (⛔ `addressId`), `userId`/`orderId` nulos, montos 0, `solicitado`; DTO `kind=buylist_inbound` + `inbound`', async () => {
      const { sr: s, seller } = await mkAccepted();
      const r = await open(s.id);
      expect(errCode(r)).toBe('200');
      expect(r.body.created).toBe(true);
      const f = await row(r.body.shipment.id);
      expect({ kind: f.kind, sellRequestId: f.sellRequestId, userId: f.userId, orderId: f.orderId, status: f.status }).toEqual({
        kind: 'buylist_inbound',
        sellRequestId: s.id,
        userId: null,
        orderId: null,
        status: 'solicitado',
      });
      expect([f.shippingFeeCents, f.ivaCents, f.processingFeeCents, f.totalCents]).toEqual([0, 0, 0, 0]);
      const { addressId: _drop, ...expected } = PICKUP;
      expect(f.addressSnapshot).toEqual(expected);
      expect(r.body.shipment.kind).toBe('buylist_inbound');
      expect(r.body.shipment.inbound).toEqual({
        sellRequestId: s.id,
        sellerName: seller.name,
        offerShippingFeeCents: 18000,
        offerGrossCents: 150000,
        destination: { name: STORE.name, street1: STORE.street1, postalCode: STORE.postalCode, state: STORE.areaLevel1, city: STORE.areaLevel2, neighborhood: STORE.areaLevel3 },
      });
      const log = await h.prisma.auditLog.findMany({ where: { entityId: s.id, action: 'buylist.inbound_shipment_opened' } });
      expect(log).toHaveLength(1);
      expect(JSON.stringify(log[0].after)).not.toMatch(/Revolución|Ana Gómez|5512345678/);
    });

    it('idempotente: la segunda llamada ⇒ `200 {created:false}` con la MISMA fila', async () => {
      const { sr: s } = await mkAccepted();
      const a = await open(s.id);
      const b = await open(s.id);
      expect([errCode(a), errCode(b), a.body.created, b.body.created]).toEqual(['200', '200', true, false]);
      expect(b.body.shipment.id).toBe(a.body.shipment.id);
      expect(await h.prisma.shipmentRequest.count({ where: { sellRequestId: s.id } })).toBe(1);
    });

    it('guardas en orden: 404; status ⇒ 409 {reason:status}; cerrada ⇒ closed; «ya lo mandé» ⇒ seller_declared_shipped; manual ⇒ 409 manual; legada ⇒ 422', async () => {
      expect(errCode(await open('00000000-0000-4000-8000-000000000000'))).toBe('404:NOT_FOUND');
      const cot = await mkAccepted({ status: 'cotizada', acceptedAt: null });
      const r1 = await open(cot.sr.id);
      expect([errCode(r1), r1.body.error.details]).toEqual(['409:GUIDE_NOT_ALLOWED', { status: 'cotizada', reason: 'status' }]);
      const closed = await mkAccepted({ closedAt: new Date() });
      expect((await open(closed.sr.id)).body.error.details).toEqual({ status: 'aceptada', reason: 'closed' });
      const decl = await mkAccepted({ sellerShippedDeclaredAt: new Date() });
      expect((await open(decl.sr.id)).body.error.details).toEqual({ status: 'aceptada', reason: 'seller_declared_shipped' });
      const manual = await mkAccepted({ shipmentCarrier: 'DHL', shipmentTrackingNumber: 'MAN-1', guideSentAt: new Date() });
      const r4 = await open(manual.sr.id);
      expect([errCode(r4), r4.body.error.details]).toEqual(['409:SHIPMENT_ALREADY_LABELED', { labelSource: 'manual' }]);
      const legacy = await mkAccepted({}, null);
      expect(errCode(await open(legacy.sr.id))).toBe('422:PICKUP_ADDRESS_MISSING');
      // Ninguna creó fila.
      expect(await h.prisma.shipmentRequest.count({ where: { sellRequestId: { in: [cot.sr.id, closed.sr.id, decl.sr.id, manual.sr.id, legacy.sr.id] } } })).toBe(0);
    });

    it('`shipping_provider=off` ⇒ 404 FEATURE_DISABLED; cuerpo con claves ⇒ 400 {field}; cliente ⇒ 403', async () => {
      const { sr: s, seller } = await mkAccepted();
      const bad = await open(s.id, { addressSnapshot: {} });
      expect([errCode(bad), bad.body.error.details]).toEqual(['400:VALIDATION_ERROR', { field: 'addressSnapshot' }]);
      const token = await db.loginCustomer(seller.email as string);
      expect(errCode(await open(s.id, {}, token))).toBe('403:FORBIDDEN');
      await dial(h, 'shipping_provider', 'off');
      expect(errCode(await open(s.id))).toBe('404:FEATURE_DISABLED');
      expect(await h.prisma.shipmentRequest.count({ where: { sellRequestId: s.id } })).toBe(0);
    });

    it(`carrera: ${N} rondas × 5 llamadas simultáneas ⇒ por ronda 5 × 200, UN created:true y UNA fila (⛔ nunca 500)`, async () => {
      const tally: string[] = [];
      for (let i = 0; i < N; i++) {
        const { sr: s } = await mkAccepted();
        const rs = await Promise.all(Array.from({ length: 5 }, () => open(s.id)));
        const ok = rs.every((r) => r.status === 200);
        const created = rs.filter((r) => r.body?.created === true).length;
        const ids = new Set(rs.map((r) => r.body?.shipment?.id));
        const rows = await h.prisma.shipmentRequest.count({ where: { sellRequestId: s.id } });
        tally.push(`${ok}/${created}/${ids.size}/${rows}`);
      }
      expect(tally).toEqual(Array.from({ length: N }, () => 'true/1/1/1'));
    });
  });

  // ================================================================ BSD-B5 / BSD-B6

  describe('BSD-B5 — `quote` de entrada', () => {
    it('`from` = el vendedor (por áreas), `to` = la tienda; cobertura por `offerGrossCents` (1 500 ⇒ escalón 2 500); margen = 18 000 − neto', async () => {
      const s = await readyInbound();
      const sent = quotesTo()[quotesTo().length - 1];
      expect(sent.from).toEqual({ address: { countryCode: 'MX', postalCode: PICKUP.postalCode, state: PICKUP.state, city: PICKUP.city, neighborhood: PICKUP.neighborhood } });
      expect(sent.to).toEqual({ countryCode: 'MX', postalCode: STORE.postalCode, state: STORE.areaLevel1, city: STORE.areaLevel2, neighborhood: STORE.areaLevel3 });
      expect(sent.parcel.coverageCents).toBe(250000);
      expect(s.q.insurance.insuredValueCents).toBe(150000);
      expect(s.q.charged).toEqual({ grossCents: 18000, netCents: 18000 });
      expect(s.q.rates.length).toBeGreaterThan(1);
      for (const r of s.q.rates) expect({ id: r.rateId, m: r.marginCents }).toEqual({ id: r.rateId, m: 18000 - r.netCostCents });
      for (const r of s.q.rates) expect(r.dropoff).toBeNull();
    });

    it('recomendada = la MÁS BARATA con `deliveryKind ≠ branch` (P-BSD-4), aunque el dial de salida prefiera otra paquetería', async () => {
      const probe = await readyInbound();
      const home = probe.q.rates.filter((r: any) => r.deliveryKind !== 'branch').sort((a: any, b: any) => a.priceCents - b.priceCents);
      expect(home.length).toBeGreaterThan(1);
      const cheapest = home[0];
      const pricier = home.find((r: any) => r.carrierName !== cheapest.carrierName);
      expect(pricier).toBeDefined();
      // El dial de SALIDA prefiere la paquetería de una tarifa más cara: si la entrada usara la regla de salida, saldría ésa.
      await dial(h, 'shipping_preferred_carriers', [pricier.carrierName]);
      try {
        const s = await readyInbound();
        const rec = recommendedOf(s.q);
        const cheapestNow = s.q.rates.filter((r: any) => r.deliveryKind !== 'branch').sort((a: any, b: any) => a.priceCents - b.priceCents)[0];
        expect(rec.rateId).toBe(cheapestNow.rateId);
        expect(rec.carrierName).not.toBe(pricier.carrierName);
      } finally {
        await dial(h, 'shipping_preferred_carriers', []);
      }
    });

    it('sin `recipientName` ⇒ 422 SHIPMENT_ADDRESS_INCOMPLETE {missing:[recipientName]} con 0 llamadas al doble', async () => {
      const { recipientName: _n, ...noName } = PICKUP;
      const a = await mkAccepted({}, noName);
      const o = await open(a.sr.id);
      fake.calls.length = 0;
      const q = await quote(o.body.shipment.id);
      expect([errCode(q), q.body.error.details]).toEqual(['422:SHIPMENT_ADDRESS_INCOMPLETE', { missing: ['recipientName'] }]);
      expect(fake.calls).toHaveLength(0);
    });

    it('la tienda incompleta ⇒ 409 SHIPPING_PROVIDER_NOT_CONFIGURED {missing:[origin_snapshot]} con 0 llamadas', async () => {
      const a = await mkAccepted();
      const o = await open(a.sr.id);
      await dial(h, 'skydropx_origin_snapshot', { ...STORE, areaLevel3: null });
      fake.calls.length = 0;
      const q = await quote(o.body.shipment.id);
      expect([errCode(q), q.body.error.details]).toEqual(['409:SHIPPING_PROVIDER_NOT_CONFIGURED', { missing: ['origin_snapshot'] }]);
      expect(fake.calls).toHaveLength(0);
    });
  });

  describe('BSD-B6 — el destino no se edita por el cuerpo; la compra lleva el CP de la tienda', () => {
    it('`to`/`destination`/`addressTo`/`address_to` en quote, label y address ⇒ 400 con 0 llamadas', async () => {
      const s = await readyInbound();
      fake.calls.length = 0;
      for (const key of ['to', 'destination', 'addressTo', 'address_to']) {
        const want = ['400:VALIDATION_ERROR', { field: key, reason: 'destination_not_editable' }];
        const q = await quote(s.id, { [key]: { postalCode: '99999' } });
        const l = await buy(s.id, { ...buyBody(s.q, s.rate), [key]: { postalCode: '99999' } });
        const a = await h.api('PUT', `/admin/shipments/${s.id}/address`, { token: db.opToken, json: { ...READY_ADDRESS, expectedAddressVersion: 0, [key]: 'x' } });
        expect([[errCode(q), q.body.error.details], [errCode(l), l.body.error.details], [errCode(a), a.body.error.details]]).toEqual([want, want, want]);
      }
      expect(fake.calls).toHaveLength(0);
    });

    it('la compra: `address_from` = vendedor explícito (correo de la TIENDA), `address_to` = tienda con su CP y el folio; SAT 49101600', async () => {
      const s = await readyInbound();
      const r = await buy(s.id, buyBody(s.q, s.rate));
      expect(errCode(r)).toBe('200');
      const [p] = purchases(s.id);
      expect(p.body.shipment.address_from).not.toHaveProperty('address_template_id');
      expect(p.body.shipment.address_from).toMatchObject({ postal_code: PICKUP.postalCode, name: PICKUP.recipientName, email: STORE.email, phone: PICKUP.phone });
      expect(p.body.shipment.address_to).toMatchObject({ postal_code: STORE.postalCode, street1: STORE.street1, email: STORE.email, further_information: STORE.reference });
      expect(p.body.shipment.address_to.reference).toMatch(/^Pedido ENV-\d{6,}-\d{2}$/);
      expect(p.body.shipment.packages[0].consignment_note).toBe('49101600');
      expect(JSON.stringify(p.body)).not.toContain((await h.prisma.user.findUniqueOrThrow({ where: { id: s.seller.id } })).email as string);
    });
  });

  // ================================================================ BSD-B7

  describe('BSD-B7 — la misma puerta de compra', () => {
    it('dial `disabled` ⇒ `labelOptions.canPurchase=false` y 404 FEATURE_DISABLED; llave apagada ⇒ 409 {missing:[allow_spend]}; 0 `port.purchase`', async () => {
      const s = await readyInbound();
      await dial(h, 'shipping_label_purchase', 'disabled');
      const d = await h.api('GET', `/admin/shipments/${s.id}`, { token: db.opToken });
      expect(d.body.labelOptions.canPurchase).toBe(false);
      expect(errCode(await buy(s.id, buyBody(s.q, s.rate)))).toBe('404:FEATURE_DISABLED');
      await dial(h, 'shipping_label_purchase', 'operators');
      spend.on = false;
      const r = await buy(s.id, buyBody(s.q, s.rate));
      expect([errCode(r), r.body.error.details]).toEqual(['409:SHIPPING_PROVIDER_NOT_CONFIGURED', { missing: ['allow_spend'] }]);
      expect(purchases(s.id)).toHaveLength(0);
      expect(await h.prisma.shipmentLabelAttempt.count({ where: { shipmentRequestId: s.id } })).toBe(0);
    });
  });

  // ================================================================ BSD-B8

  describe('BSD-B8 — compra con número', () => {
    it('fila con costo, libros; solicitud con paquetería LEGIBLE, número, `guideSentAt`, plazo a 3 días hábiles; UN AV-7 con PDF; CERO AV-4', async () => {
      const av4 = jest.spyOn(h.app.get(ShipmentsService), 'notifyLabelCaptured');
      try {
        const s0 = await readyInbound();
        // C-6 solo se distingue con una tarifa cuyo nombre LEGIBLE difiere del código (p. ej. `ninetynineminutes` ⇒ «99minutos»).
        const legible = s0.q.rates.find((r: any) => r.deliveryKind !== 'branch' && r.carrierLabel && r.carrierLabel !== r.carrierName);
        expect(legible).toBeDefined();
        const s = { ...s0, rate: legible };
        const r = await buy(s.id, buyBody(s.q, s.rate));
        expect([errCode(r), r.body.outcome]).toEqual(['200', 'labeled']);
        const f = await row(s.id);
        expect({ status: f.status, labelSource: f.labelSource, carrier: f.carrier }).toEqual({ status: 'guia', labelSource: 'skydropx', carrier: s.rate.carrierName });
        expect(f.trackingNumber).toBeTruthy();
        expect(f.shippingCostCents).toBe(s.rate.priceCents);
        expect(f.insuranceCostCents).toBe(s.rate.breakdown.insuranceCents);
        expect(await h.prisma.shipmentPaidLabel.count({ where: { shipmentRequestId: s.id, origin: 'response' } })).toBe(1);
        expect((await h.prisma.shipmentLabelAttempt.findMany({ where: { shipmentRequestId: s.id } })).map((a) => a.outcome)).toEqual(['labeled']);
        const after = await sr(s.sr.id);
        const now = clock.now();
        expect({
          carrier: after.shipmentCarrier,
          tn: after.shipmentTrackingNumber,
          guideSentAt: after.guideSentAt?.toISOString(),
          deadline: after.shipDeadlineAt?.toISOString(),
        }).toEqual({ carrier: s.rate.carrierLabel, tn: f.trackingNumber, guideSentAt: now.toISOString(), deadline: addBusinessDays(now, 3).toISOString() });
        // UN AV-7 con la etiqueta adjunta; el sello reclamado.
        const mails = mailsTo(s.seller.email as string);
        expect(mails).toHaveLength(1);
        expect(mails[0].subject).toContain('guía prepagada');
        expect(mails[0].text).toContain(`Paquetería: ${s.rate.carrierLabel} · Guía: ${f.trackingNumber}`);
        expect(mails[0].text).toContain(`sucursal de ${s.rate.carrierLabel}`);
        expect(mails[0].attachments).toHaveLength(1);
        expect(mails[0].attachments![0]).toMatchObject({ filename: `guia-${s.sr.id.replace(/-/g, '').slice(0, 8)}.pdf`, contentType: 'application/pdf' });
        expect(mails[0].attachments![0].content.subarray(0, 5).toString('latin1')).toBe('%PDF-');
        expect(after.guideNoticeSentAt).not.toBeNull();
        // CERO AV-4: la fila de entrada no tiene cliente y su aviso no es el de un envío.
        expect(av4.mock.calls.filter(([id]) => id === s.id)).toHaveLength(0);
        expect(f.trackingNoticeSentAt).toBeNull();
      } finally {
        av4.mockRestore();
      }
    });

    it('descarga del PDF fallida ⇒ el correo sale IGUAL sin adjunto (S0) y una sola vez', async () => {
      const s = await readyInbound();
      fake.purchaseOutcomes.push({ kind: 'labeled', labelUrl: null });
      const r = await buy(s.id, buyBody(s.q, s.rate));
      expect(errCode(r)).toBe('200');
      const mails = mailsTo(s.seller.email as string);
      expect(mails).toHaveLength(1);
      expect(mails[0].attachments ?? []).toHaveLength(0);
      expect(mails[0].text).toContain('No pudimos adjuntarla');
    });
  });

  // ================================================================ BSD-B9

  describe('BSD-B9 — doble clic y dos personas', () => {
    /**
     * Errata BSD-1.5 punto 1 (§BSD.19): el conjunto de respuestas ADMITIDAS de un clic concurrente. ⛔ Ningún `5xx` ni nada
     * fuera de esta lista. `409 SHIPMENT_ALREADY_LABELED` es el clic que llega después de `persistLabeled`
     * (`label-inbound.ts`, `assertInboundOpenForLabel`). Devuelve la etiqueta de la respuesta, o `null` si está admitida.
     */
    const fueraDelConjunto = (r: R): string | null => {
      if (r.status === 200 && (r.body?.outcome === 'labeled' || r.body?.outcome === 'in_progress')) return null;
      if (r.status === 409 && r.body?.error?.code === 'CONFLICT' && r.body?.error?.details?.reason === 'purchase_in_flight') return null;
      if (r.status === 409 && r.body?.error?.code === 'SHIPMENT_ALREADY_LABELED') return null;
      return `${r.status}:${r.body?.error?.code ?? r.body?.outcome ?? '?'}${r.body?.error?.details?.reason ? `:${r.body.error.details.reason}` : ''}`;
    };

    it(`${N} rondas: 2 clics del operador + 1 del súper-admin a la vez ⇒ toda respuesta admitida (⛔ 5xx) y UNA \`port.purchase\` y UNA guía pagada por ronda`, async () => {
      const tally: string[] = [];
      const fuera: string[] = [];
      for (let i = 0; i < N; i++) {
        const s = await readyInbound();
        fake.calls.length = 0;
        const body = buyBody(s.q, s.rate);
        clock.advance(1);
        const rs = await Promise.all([
          h.api('POST', `/admin/shipments/${s.id}/label`, { token: db.opToken, json: body }),
          h.api('POST', `/admin/shipments/${s.id}/label`, { token: db.opToken, json: body }),
          h.api('POST', `/admin/shipments/${s.id}/label`, { token: db.adminToken, json: body }),
        ]);
        for (const r of rs) {
          const x = fueraDelConjunto(r);
          if (x !== null) fuera.push(`ronda ${i}: ${x}`);
        }
        const paid = await h.prisma.shipmentPaidLabel.count({ where: { shipmentRequestId: s.id } });
        tally.push(`${purchases(s.id).length}/${paid}/${(await row(s.id)).status}`);
        await h.prisma.shipmentRequest.updateMany({ where: { id: s.id, labelProcessingSince: { not: null }, providerShipmentId: null }, data: { labelProcessingSince: null } });
      }
      // eslint-disable-next-line no-console
      console.log(`BSD-B9 compras/pagadas/estado por ronda: ${JSON.stringify(tally)} · fuera del conjunto: ${JSON.stringify(fuera)}`);
      // PRIMERO el conjunto (la aserción que la mutación de los tres muros pone roja, §BSD.19.1); luego el dinero.
      expect(fuera).toEqual([]);
      expect(tally).toEqual(Array.from({ length: N }, () => '1/1/guia'));
    });
  });

  // ================================================================ BSD-B10

  describe('BSD-B10 — «en proceso»: el plazo arranca con el NÚMERO', () => {
    it('sin número ⇒ ni `guideSentAt` ni correo; el job trae el número ⇒ plazo + UN AV-7 (aunque el job corra dos veces)', async () => {
      const s = await readyInbound();
      fake.purchaseOutcomes.push({ kind: 'processing' });
      const r = await buy(s.id, buyBody(s.q, s.rate));
      expect([errCode(r), r.body.outcome]).toEqual(['200', 'processing']);
      const f0 = await row(s.id);
      expect({ status: f0.status, labelSource: f0.labelSource, tn: f0.trackingNumber }).toEqual({ status: 'solicitado', labelSource: 'skydropx', tn: null });
      const s0 = await sr(s.sr.id);
      expect([s0.guideSentAt, s0.shipDeadlineAt, s0.shipmentTrackingNumber]).toEqual([null, null, null]);
      expect(mailsTo(s.seller.email as string)).toHaveLength(0);
      fake.setShipment(f0.providerShipmentId as string, { trackingNumber: 'TRK-B10-1', carrierStatus: 'created', rawLabelUrl: 'https://pro.skydropx.com/labels/b10.pdf' });
      clock.advance(60_000);
      const job = h.app.get(ShipmentLabelProcessingJob);
      await job.run();
      await job.run();
      const f1 = await row(s.id);
      expect({ status: f1.status, tn: f1.trackingNumber, since: f1.labelProcessingSince }).toEqual({ status: 'guia', tn: 'TRK-B10-1', since: null });
      const s1 = await sr(s.sr.id);
      expect({ tn: s1.shipmentTrackingNumber, carrier: s1.shipmentCarrier, sent: s1.guideSentAt !== null, deadline: s1.shipDeadlineAt !== null }).toEqual({
        tn: 'TRK-B10-1',
        carrier: s.rate.carrierLabel,
        sent: true,
        deadline: true,
      });
      const mails = mailsTo(s.seller.email as string);
      expect(mails).toHaveLength(1);
      expect(mails[0].attachments).toHaveLength(1);
    });
  });

  // ================================================================ BSD-B11

  describe('BSD-B11 — la compra de una guía de entrada no cambia la oferta ni ninguna cifra `*Cents` del portal', () => {
    it('dos solicitudes (bruto 1 500, tarifa 180) con guías de distinto costo ⇒ oferta y portal sin cambio; `payoutNetCents` sigue nulo (lo escribe `paySpei`: BSD-B46)', async () => {
      /** Toda cifra `*Cents` del DTO de cliente, por ruta (para comparar antes/después de comprar la guía). */
      const cents = (v: unknown, path = '', out: Record<string, unknown> = {}): Record<string, unknown> => {
        if (Array.isArray(v)) v.forEach((x, i) => cents(x, `${path}[${i}]`, out));
        else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (/Cents$/.test(k) ? (out[`${path}.${k}`] = x) : cents(x, `${path}.${k}`, out));
        return out;
      };
      const a = await readyInbound();
      const b = await readyInbound();
      const before: Record<string, unknown>[] = [];
      for (const x of [a, b]) {
        const token = await db.loginCustomer(x.seller.email as string);
        before.push(cents((await h.api('GET', `/buylist/requests/${x.sr.id}`, { token })).body));
      }
      // Dos guías de costo distinto (150 y 250 de total del proveedor).
      fake.purchaseOutcomes.push({ kind: 'labeled', totalCents: 15000 });
      await buy(a.id, buyBody(a.q, a.rate));
      fake.purchaseOutcomes.push({ kind: 'labeled', totalCents: 25000 });
      await buy(b.id, buyBody(b.q, b.rate));
      expect((await row(a.id)).shippingCostCents).not.toBe((await row(b.id)).shippingCostCents);
      for (const [i, x] of [a, b].entries()) {
        const after = await sr(x.sr.id);
        expect({ g: after.offerGrossCents, f: after.offerShippingFeeCents, n: after.offerNetCents, p: after.payoutNetCents }).toEqual({ g: 150000, f: 18000, n: 132000, p: null });
        const token = await db.loginCustomer(x.seller.email as string);
        const mine = await h.api('GET', `/buylist/requests/${x.sr.id}`, { token });
        expect(errCode(mine)).toBe('200');
        expect(cents(mine.body)).toEqual(before[i]);
      }
    });
  });

  // ================================================================ BSD-B12

  describe('BSD-B12 — topes y avisos', () => {
    it('TG-1 cuenta la guía de entrada: gastado al borde del tope + esta ⇒ 403 LABEL_PURCHASE_LIMIT {daily_spend} + AG-3; 0 compra', async () => {
      // TG-1 mide 24 h: lo que el operador gastó en las pruebas anteriores sale de la ventana.
      await h.prisma.$executeRaw`UPDATE "ShipmentLabelAttempt" SET since = since - interval '25 hours' WHERE "actorUserId" = ${db.operatorId}`;
      const s = await readyInbound();
      await dial(h, 'operator_label_cap_24h_cents', s.rate.priceCents + 100);
      try {
        // Una primera guía de entrada (otra solicitud) consume casi todo el tope del operador.
        const first = await readyInbound();
        const r1 = await buy(first.id, buyBody(first.q, first.rate));
        expect(errCode(r1)).toBe('200');
        const r = await buy(s.id, buyBody(s.q, s.rate));
        expect([errCode(r), r.body.error.details]).toEqual(['403:LABEL_PURCHASE_LIMIT', { limit: 'daily_spend' }]);
        expect(purchases(s.id)).toHaveLength(0);
        expect(await h.prisma.spendAlert.count({ where: { kind: 'label_cap_blocked', subjectUserId: db.operatorId } })).toBeGreaterThanOrEqual(1);
      } finally {
        await dial(h, 'operator_label_cap_24h_cents', 1_000_000_000);
        await h.prisma.$executeRaw`UPDATE "ShipmentLabelAttempt" SET since = since - interval '25 hours' WHERE "actorUserId" = ${db.operatorId}`;
      }
    });

    it('corregir el ORIGEN (vendedor) y comprar ⇒ versión +1, revisión con valores, ⛔ AG-1; a 3 días sin escaneo ⛔ AG-10', async () => {
      const s = await readyInbound();
      const fix = await h.api('PUT', `/admin/shipments/${s.id}/address`, {
        token: db.opToken,
        json: { ...READY_ADDRESS, recipientName: 'Vendedora Corregida', expectedAddressVersion: 0 },
      });
      expect([errCode(fix), fix.body.outcome]).toEqual(['200', 'corrected']);
      expect((await row(s.id)).addressVersion).toBe(1);
      expect((await sr(s.sr.id)).pickupAddressSnapshot).toEqual(PICKUP); // ⛔ la copia de la solicitud no cambia
      const q = await quote(s.id);
      const r = await buy(s.id, buyBody(q.body, recommendedOf(q.body)));
      expect(errCode(r)).toBe('200');
      expect(await h.prisma.spendAlert.count({ where: { shipmentRequestId: s.id, kind: 'label_after_address_fix' } })).toBe(0);
      await h.app.get(SpendWatchService).run(new Date(clock.now().getTime() + 3 * DAY + 60_000));
      expect(await h.prisma.spendAlert.count({ where: { shipmentRequestId: s.id, kind: 'label_not_shipped' } })).toBe(0);
    });
  });

  // ================================================================ BSD-B22

  describe('BSD-B22 — `GET /buylist/requests/:id/label.pdf` (el vendedor)', () => {
    const pdf = (srId: string, token: string) => h.api('GET', `/buylist/requests/${srId}/label.pdf`, { token });

    it('dueño ⇒ 200 application/pdf `attachment` + bitácora; otro vendedor ⇒ 404 NOT_FOUND (misma respuesta que inexistente)', async () => {
      const s = await readyInbound();
      await buy(s.id, buyBody(s.q, s.rate));
      const token = await db.loginCustomer(s.seller.email as string);
      const r = await pdf(s.sr.id, token);
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toMatch(/^application\/pdf/);
      expect(r.headers['content-disposition']).toBe(`attachment; filename="guia-${s.sr.id.replace(/-/g, '').slice(0, 8)}.pdf"`);
      expect(r.text.startsWith('%PDF-')).toBe(true);
      expect(await h.prisma.auditLog.count({ where: { entityId: s.sr.id, action: 'buylist.label_downloaded', actorUserId: s.seller.id } })).toBe(1);
      const other = await db.mkUser('Otro vendedor');
      const t2 = await db.loginCustomer(other.email as string);
      const r2 = await pdf(s.sr.id, t2);
      const r3 = await pdf('00000000-0000-4000-8000-000000000000', t2);
      expect([errCode(r2), errCode(r3)]).toEqual(['404:NOT_FOUND', '404:NOT_FOUND']);
    });

    it('manual ⇒ 404 LABEL_NOT_AVAILABLE {manual}; cancelada (re-emitida) y cerrada ⇒ 404 LABEL_NOT_AVAILABLE', async () => {
      const manual = await mkAccepted({ shipmentCarrier: 'DHL', shipmentTrackingNumber: 'MAN-22', guideSentAt: new Date() });
      const tm = await db.loginCustomer(manual.seller.email as string);
      const rm = await pdf(manual.sr.id, tm);
      expect([errCode(rm), rm.body.error.details]).toEqual(['404:LABEL_NOT_AVAILABLE', { labelSource: 'manual' }]);

      const re = await readyInbound();
      await buy(re.id, buyBody(re.q, re.rate));
      const c = await h.api('POST', `/admin/shipments/${re.id}/label/cancel`, { token: db.opToken, json: { reason: 'Re-emitir B22' } });
      expect(errCode(c)).toBe('200');
      const tr = await db.loginCustomer(re.seller.email as string);
      expect(errCode(await pdf(re.sr.id, tr))).toBe('404:LABEL_NOT_AVAILABLE');

      const cl = await readyInbound();
      await buy(cl.id, buyBody(cl.q, cl.rate));
      await h.prisma.sellRequest.update({ where: { id: cl.sr.id }, data: { status: 'expirada', closedAt: new Date(), expiredReason: 'not_continued' } });
      const tc = await db.loginCustomer(cl.seller.email as string);
      expect(errCode(await pdf(cl.sr.id, tc))).toBe('404:LABEL_NOT_AVAILABLE');
    });

    it('barrido: ningún DTO de cliente (lista y detalle de solicitudes) trae `labelUrl` ni el host de la etiqueta', async () => {
      const s = await readyInbound();
      await buy(s.id, buyBody(s.q, s.rate));
      const token = await db.loginCustomer(s.seller.email as string);
      const list = await h.api('GET', '/buylist/requests', { token });
      const one = await h.api('GET', `/buylist/requests/${s.sr.id}`, { token });
      const shipments = await h.api('GET', '/shipments', { token });
      for (const r of [list, one, shipments]) {
        expect(errCode(r)).toBe('200');
        expect(r.text).not.toMatch(/labelUrl|pro\.skydropx\.com/);
      }
    });
  });

  // ================================================================ BSD-B24

  describe('BSD-B24 — para las rutas de salida una fila de entrada no existe', () => {
    it('refresh-tracking, prep-items, prepared (POST/DELETE), PATCH status, POST tracking ⇒ 404; departed ⇒ rechazada NOT_FOUND', async () => {
      const s = await readyInbound();
      await buy(s.id, buyBody(s.q, s.rate));
      const t = db.opToken;
      const rs = [
        await h.api('POST', `/admin/shipments/${s.id}/refresh-tracking`, { token: t }),
        await h.api('PATCH', `/admin/shipments/${s.id}/prep-items/00000000-0000-4000-8000-000000000000`, { token: t, json: { status: 'picked' } }),
        await h.api('POST', `/admin/shipments/${s.id}/prepared`, { token: t, json: { expectedRefundCents: 0 } }),
        await h.api('DELETE', `/admin/shipments/${s.id}/prepared`, { token: t }),
        await h.api('PATCH', `/admin/shipments/${s.id}/status`, { token: t, json: { to: 'cancelado' } }),
        await h.api('POST', `/admin/shipments/${s.id}/tracking`, { token: t, json: { carrier: 'DHL', trackingNumber: 'X1' } }),
      ];
      expect(rs.map(errCode)).toEqual(Array.from({ length: 6 }, () => '404:NOT_FOUND'));
      const dep = await h.api('POST', '/admin/shipments/departed', { token: t, json: { shipmentIds: [s.id] } });
      expect(errCode(dep)).toBe('200');
      expect(dep.body.results).toEqual([{ shipmentId: s.id, outcome: 'rejected', code: 'NOT_FOUND' }]);
      const f = await row(s.id);
      expect(f.status).toBe('guia');
    });

    it('la fila no sale en la lista admin (ni con `?alert=true`) ni en `GET /shipments` del vendedor; el detalle por id SÍ (la ventana)', async () => {
      const s = await readyInbound();
      const folio = (await row(s.id)).folio;
      const list = await h.api('GET', '/admin/shipments?pageSize=100', { token: db.opToken });
      expect(errCode(list)).toBe('200');
      expect(list.text).not.toContain(s.id);
      const byFolio = await h.api('GET', `/admin/shipments?folio=${folio}`, { token: db.opToken });
      expect(errCode(byFolio)).toBe('200');
      expect(byFolio.text).not.toContain(s.id);
      const alerts = await h.api('GET', '/admin/shipments?alert=true&pageSize=100', { token: db.opToken });
      expect(alerts.text).not.toContain(s.id);
      const token = await db.loginCustomer(s.seller.email as string);
      const mine = await h.api('GET', '/shipments', { token });
      expect(mine.text).not.toContain(s.id);
      expect(errCode(await h.api('GET', `/shipments/${s.id}`, { token }))).toBe('404:NOT_FOUND');
      expect(errCode(await h.api('GET', `/admin/shipments/${s.id}`, { token: db.opToken }))).toBe('200');
    });
  });

  // ================================================================ BSD-B26

  describe('BSD-B26 — re-emitir una guía de entrada', () => {
    it('cancelar ⇒ fila `solicitado` sin guía, solicitud sin guía y RE-ANCLADA; la compra nueva manda AV-7 «sustituye a la anterior»', async () => {
      const s = await readyInbound();
      await buy(s.id, buyBody(s.q, s.rate));
      expect((await sr(s.sr.id)).shipDeadlineAt).not.toBeNull();
      clock.advance(60_000);
      const c = await h.api('POST', `/admin/shipments/${s.id}/label/cancel`, { token: db.opToken, json: { reason: 'Re-emitir B26' } });
      expect([errCode(c), c.body.outcome]).toEqual(['200', 'cancelled']);
      const f = await row(s.id);
      expect({ status: f.status, ls: f.labelSource, tn: f.trackingNumber, pid: f.providerShipmentId, cost: f.shippingCostCents }).toEqual({
        status: 'solicitado',
        ls: null,
        tn: null,
        pid: null,
        cost: 0,
      });
      const after = await sr(s.sr.id);
      expect({
        carrier: after.shipmentCarrier,
        tn: after.shipmentTrackingNumber,
        sent: after.guideSentAt,
        deadline: after.shipDeadlineAt,
        notice: after.guideNoticeSentAt,
        reminder: after.shipReminderSentAt,
        status: after.status,
      }).toEqual({ carrier: null, tn: null, sent: null, deadline: null, notice: null, reminder: null, status: 'aceptada' });
      expect(after.inboundGuideClockStartedAt).not.toBeNull();
      expect(Math.abs(after.inboundGuideClockStartedAt!.getTime() - clock.now().getTime())).toBeLessThan(5_000);
      // La compra nueva: AV-7 con la línea de sustitución.
      bandeja = [];
      const q2 = await quote(s.id, { force: true });
      const r2 = await buy(s.id, buyBody(q2.body, recommendedOf(q2.body)));
      expect([errCode(r2), r2.body.outcome]).toEqual(['200', 'labeled']);
      const mails = mailsTo(s.seller.email as string);
      expect(mails).toHaveLength(1);
      expect(mails[0].subject).toContain('nueva guía');
      expect(mails[0].text).toContain('Esta guía sustituye a la que te enviamos antes: no uses la anterior.');
      expect((await sr(s.sr.id)).shipDeadlineAt).not.toBeNull();
    });

    it('con «ya lo mandé» ⇒ 409 LABEL_NOT_CANCELLABLE {seller_declared_shipped}; solicitud fuera de aceptada ⇒ {sell_request_status}; 0 `cancel`', async () => {
      const s = await readyInbound();
      await buy(s.id, buyBody(s.q, s.rate));
      await h.prisma.sellRequest.update({ where: { id: s.sr.id }, data: { sellerShippedDeclaredAt: new Date() } });
      fake.calls.length = 0;
      const c = await h.api('POST', `/admin/shipments/${s.id}/label/cancel`, { token: db.opToken, json: { reason: 'No debe' } });
      expect([errCode(c), c.body.error.details]).toEqual(['409:LABEL_NOT_CANCELLABLE', { reason: 'seller_declared_shipped' }]);
      await h.prisma.sellRequest.update({ where: { id: s.sr.id }, data: { sellerShippedDeclaredAt: null, status: 'en_transito', shipmentConfirmedAt: new Date() } });
      const c2 = await h.api('POST', `/admin/shipments/${s.id}/label/cancel`, { token: db.opToken, json: { reason: 'No debe' } });
      expect([errCode(c2), c2.body.error.details]).toEqual(['409:LABEL_NOT_CANCELLABLE', { reason: 'sell_request_status', status: 'en_transito' }]);
      expect(fake.callsOf('cancel')).toHaveLength(0);
      expect((await row(s.id)).providerCanceledAt).toBeNull();
    });
  });
  // ================================================================ costuras de `inbound-sync.ts` (B13 / B28 / B27)

  describe('costura de la anonimización (`inbound-sync.ts`), en la tx del llamador', () => {
    it('BSD-B27 (costura): anonimizar al vendedor vacía el domicilio de SU fila de entrada y borra sus revisiones; la de otro no se toca', async () => {
      const mine = await readyInbound();
      const other = await readyInbound();
      const fix = await h.api('PUT', `/admin/shipments/${mine.id}/address`, { token: db.opToken, json: { ...READY_ADDRESS, line1: 'Calle B27', expectedAddressVersion: 0 } });
      expect(errCode(fix)).toBe('200');
      expect(await h.prisma.shipmentAddressRevision.count({ where: { shipmentRequestId: mine.id } })).toBe(1);
      const n = await h.prisma.$transaction((t) => scrubInboundShipmentPii(t, mine.seller.id));
      expect(n).toBe(1);
      expect((await row(mine.id)).addressSnapshot).toEqual({});
      expect(await h.prisma.shipmentAddressRevision.count({ where: { shipmentRequestId: mine.id } })).toBe(0);
      expect(((await row(other.id)).addressSnapshot as Record<string, unknown>).line1).toBe(PICKUP.line1);
    });
  });
});
