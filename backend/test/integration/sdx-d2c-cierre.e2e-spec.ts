/**
 * sdx-d2c-cierre.e2e-spec.ts — 💰🔒 D2c-cierre (API_CONTRACT §M4-SHIP.19.31, errata v1.80.12.12; pieza 1 de §19.31.10).
 * Postgres REAL, app Nest completa por HTTP, proveedor DOBLE (⛔ nunca la red: PS-99), llave de compra SUSTITUIDA (⛔ nadie
 * pone `SKYDROPX_ALLOW_SPEND`). Propiedad: backend.
 *
 * Cubre:
 *  - `GET …/label.pdf` (§19.8, §19.31.5 (3)): `application/pdf` + `inline` + `private, no-store`, bitácora `label_printed`
 *    solo si se sirvió, ⛔ CERO `fetch`; operador ⇒ 200, cliente ⇒ 403, anónimo ⇒ 401; manual ⇒ 404 `{labelSource:'manual'}`;
 *    sin guía / `cancelado` ⇒ 404; con `shipping_provider='off'` sigue (SEC-SDX-12).
 *  - Filtros `?labelSource=` (E), `?alert=` (L), `?folio=` (S-GAS-2) de `GET /admin/shipments` — que FILTRAN (resultado, no
 *    solo `200`) y que lo de fuera de dominio es `400`.
 *  - PS-167 (a)(b)(c) — `label/cancel` cuando `cancel` LANZA o rechaza (§19.31.6).
 *  - PS-168 (a)(b)(c)(d) — vigencia de la cotización reutilizada y «la vigente» (§19.31.2).
 *  - PS-169 — los dos `reason` nuevos de `label` (§19.31.7 (a)).
 */
import { ApiResponse, E2EHarness } from './helpers/e2e-app';
import { R, ShipPrepDb } from './helpers/ship-prep-db';
import { buyBody, createLabelWorld, dial, errCode, purchaseOn, ready, restoreDials } from './helpers/label-db';
import { FakeShippingProvider } from '../../src/modules/shipping-provider/fake-shipping-provider';
import { ShippingProviderError } from '../../src/modules/shipping-provider/shipping-provider.errors';
import { ManualLabelClock } from '../../src/modules/shipments/label-clock';
import { ShipmentQuoteService } from '../../src/modules/shipments/label-quote.service';
import { E2E_USERS } from '../../prisma/e2e-fixtures';

const RUN = `d2cc${Date.now().toString(36)}`;
const MIN = 60_000;
const H = 60 * MIN;

describe('💰🔒 D2c-cierre — label.pdf, filtros, cancelación sin respuesta, vigencia reutilizada, reason nuevos', () => {
  let h: E2EHarness;
  let db: ShipPrepDb;
  let fake: FakeShippingProvider;
  let clock: ManualLabelClock;
  let custToken: string;
  let fetchSpy: jest.SpyInstance;

  const quote = (id: string, json: unknown = {}, token = db.opToken): Promise<R> => h.api('POST', `/admin/shipments/${id}/quote`, { token, json });
  const current = (id: string): Promise<R> => h.api('GET', `/admin/shipments/${id}/quote`, { token: db.opToken });
  const buy = (id: string, json: unknown, token = db.opToken): Promise<R> => {
    clock.advance(1);
    return h.api('POST', `/admin/shipments/${id}/label`, { token, json });
  };
  const cancel = (id: string, json: unknown = { reason: 'Re-emitir con otra paquetería' }, token = db.opToken): Promise<R> =>
    h.api('POST', `/admin/shipments/${id}/label/cancel`, { token, json });
  const pdf = (id: string, token: string = db.opToken): Promise<ApiResponse> => h.api('GET', `/admin/shipments/${id}/label.pdf`, { token });
  const list = (qs: string, token = db.opToken): Promise<R> => h.api('GET', `/admin/shipments?pageSize=100&${qs}`, { token });
  const row = (id: string) => h.prisma.shipmentRequest.findUniqueOrThrow({ where: { id } });
  const audits = (id: string, action: string) => h.prisma.auditLog.findMany({ where: { entityId: id, action }, orderBy: { createdAt: 'asc' } });
  const pickRate = (q: any) => q.rates.find((r: any) => r.deliveryKind !== 'branch' && r.marginCents >= 0 && !r.hidden) ?? q.rates[0];
  const ids = (r: R) => (r.body.data as { id: string }[]).map((x) => x.id).sort();

  const readyQuoted = async () => {
    const d = await db.mkDirect({ prices: [50000, 30000] });
    await ready(db, d.shipment.id);
    const q = await quote(d.shipment.id);
    expect(q.status).toBe(200);
    return { d, id: d.shipment.id, q: q.body, rate: pickRate(q.body) };
  };
  const labeled = async () => {
    const s = await readyQuoted();
    const r = await buy(s.id, buyBody(s.q, s.rate));
    expect(errCode(r)).toBe('200');
    expect(r.body.outcome).toBe('labeled');
    return { ...s, row: await row(s.id) };
  };

  beforeAll(async () => {
    ({ h, db, fake, clock } = await createLabelWorld(RUN));
    await purchaseOn(h, 'operators');
    await dial(h, 'operator_label_cap_24h_cents', 1_000_000_000);
    await dial(h, 'shipping_label_reissue_max_per_shipment', 50);
    custToken = await h.login(E2E_USERS.customer.email, E2E_USERS.customer.password);
  });

  afterAll(async () => {
    await h.prisma.spendAlert.deleteMany({ where: { OR: [{ subjectUserId: { in: [db.operatorId, db.adminId] } }, { shipmentRequestId: { in: db.shipments } }, { dedupKey: { startsWith: 'ag7:' } }] } });
    await restoreDials(h);
    await db.cleanup();
    await h?.close();
  });

  beforeEach(async () => {
    fake.calls.length = 0;
    fake.purchaseOutcomes.length = 0;
    fake.cancelOutcomes.length = 0;
    fake.balanceSequence.length = 0;
    fake.purchaseBarrier = null;
    fake.onPurchase = null;
    fake.onBalance = null;
    fake.balanceCents = 10_000_000;
    fake.reuseQuotations = false;
    fake.forgetQuotations();
    clock.set(new Date());
    fetchSpy = jest.spyOn(globalThis, 'fetch');
    await dial(h, 'shipping_provider', 'skydropx');
  });

  afterEach(async () => {
    fetchSpy.mockRestore();
    await h.prisma.$executeRaw`UPDATE "ShipmentLabelAttempt" SET since = since - interval '25 hours' WHERE since > ${new Date(Date.now() - 25 * H)}`;
  });

  // ================================================================ GET …/label.pdf

  describe('GET …/label.pdf (§19.8 + §19.31.5 (3))', () => {
    it('operador ⇒ 200 application/pdf, inline, private no-store, el PDF del doble, `label_printed`, CERO fetch', async () => {
      const s = await labeled();
      fake.calls.length = 0;
      const r = await pdf(s.id);
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toMatch(/^application\/pdf/);
      expect(r.headers['cache-control']).toBe('private, no-store');
      expect(r.headers['content-disposition']).toBe(`inline; filename="guia-${s.d.order.orderNumber}.pdf"`);
      expect(r.text.startsWith('%PDF-')).toBe(true);
      expect(fake.callsOf('labelPdf').map((c) => c.input)).toEqual([s.row.providerShipmentId]);
      expect(fetchSpy).not.toHaveBeenCalled();
      const printed = await audits(s.id, 'shipment.label_printed');
      expect(printed).toHaveLength(1);
      expect(printed[0]).toEqual(expect.objectContaining({ actorUserId: db.operatorId, actorRole: 'vault_operator' }));
      // ⛔ la URL cruda no viaja (ni en la cabecera ni en la bitácora)
      expect(JSON.stringify(r.headers)).not.toContain('pro.skydropx.com');
      expect(JSON.stringify(printed[0].after)).not.toContain('http');
    });

    it('cliente ⇒ 403; anónimo ⇒ 401; ninguno escribe `label_printed`', async () => {
      const s = await labeled();
      expect((await pdf(s.id, custToken)).status).toBe(403);
      expect((await h.api('GET', `/admin/shipments/${s.id}/label.pdf`)).status).toBe(401);
      expect(await audits(s.id, 'shipment.label_printed')).toHaveLength(0);
      expect(fake.callsOf('labelPdf')).toHaveLength(0);
    });

    it('guía manual ⇒ 404 LABEL_NOT_AVAILABLE {labelSource:manual}; sin guía ⇒ 404; inexistente ⇒ 404 NOT_FOUND', async () => {
      const m = await db.mkDirect({ prices: [1000] });
      await h.prisma.shipmentRequest.update({ where: { id: m.shipment.id }, data: { trackingNumber: `MAN-${RUN}`, carrier: 'dhl', labelSource: 'manual' } });
      const r1 = await pdf(m.shipment.id);
      expect(errCode(r1)).toBe('404:LABEL_NOT_AVAILABLE');
      expect(r1.body.error.details).toEqual({ labelSource: 'manual' });
      // guía manual anterior a v1.81 (número sin `labelSource`): la misma derivación (`labelSourceOf`)
      const legacy = await db.mkDirect({ prices: [1000] });
      await h.prisma.shipmentRequest.update({ where: { id: legacy.shipment.id }, data: { trackingNumber: `LEG-${RUN}`, carrier: 'dhl' } });
      expect((await pdf(legacy.shipment.id)).body.error.details).toEqual({ labelSource: 'manual' });
      const none = await db.mkDirect({ prices: [1000] });
      expect(errCode(await pdf(none.shipment.id))).toBe('404:LABEL_NOT_AVAILABLE');
      expect(errCode(await pdf('no-existe'))).toBe('404:NOT_FOUND');
      expect(fake.callsOf('labelPdf')).toHaveLength(0);
    });

    it('`cancelado` ⇒ 404; `labelUrl` nula (URL rechazada al escribir) ⇒ 404; `entregado` ⇒ 200 (reimprimible)', async () => {
      const a = await labeled();
      await h.prisma.shipmentRequest.update({ where: { id: a.id }, data: { status: 'cancelado' } });
      expect(errCode(await pdf(a.id))).toBe('404:LABEL_NOT_AVAILABLE');
      const b = await labeled();
      await h.prisma.shipmentRequest.update({ where: { id: b.id }, data: { labelUrl: null } });
      expect(errCode(await pdf(b.id))).toBe('404:LABEL_NOT_AVAILABLE');
      const c = await labeled();
      await h.prisma.shipmentRequest.update({ where: { id: c.id }, data: { status: 'entregado' } });
      expect((await pdf(c.id)).status).toBe(200);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("con `shipping_provider='off'` sigue sirviendo (SEC-SDX-12)", async () => {
      const s = await labeled();
      await dial(h, 'shipping_provider', 'off');
      expect((await pdf(s.id)).status).toBe(200);
    });
  });

  // ================================================================ filtros de GET /admin/shipments

  describe('GET /admin/shipments — `?labelSource=`, `?alert=`, `?folio=`', () => {
    it('?folio= es igualdad exacta y combina con los otros filtros', async () => {
      const a = await labeled();
      const b = await readyQuoted();
      const fa = (await row(a.id)).folio;
      expect(ids(await list(`folio=${fa}`))).toEqual([a.id]);
      expect(ids(await list(`folio=${(await row(b.id)).folio}`))).toEqual([b.id]);
      expect(ids(await list(`folio=${fa}&labelSource=skydropx`))).toEqual([a.id]);
      expect(ids(await list(`folio=${fa}&labelSource=manual`))).toEqual([]);
      expect(ids(await list('folio='))).not.toEqual([]); // en blanco ⇒ sin filtro
    });

    it('?labelSource= filtra con la derivación de `labelSourceOf` (manual explícita, manual heredada y skydropx)', async () => {
      const sky = await labeled();
      const man = await db.mkDirect({ prices: [1000] });
      await h.prisma.shipmentRequest.update({ where: { id: man.shipment.id }, data: { trackingNumber: `MAN2-${RUN}`, carrier: 'dhl', labelSource: 'manual' } });
      const leg = await db.mkDirect({ prices: [1000] });
      await h.prisma.shipmentRequest.update({ where: { id: leg.shipment.id }, data: { trackingNumber: `LEG2-${RUN}`, carrier: 'dhl' } });
      const none = await db.mkDirect({ prices: [1000] });
      const mine = new Set([sky.id, man.shipment.id, leg.shipment.id, none.shipment.id]);
      const pick = (r: R) => ids(r).filter((x) => mine.has(x));
      expect(pick(await list('labelSource=skydropx'))).toEqual([sky.id]);
      expect(pick(await list('labelSource=manual'))).toEqual([man.shipment.id, leg.shipment.id].sort());
      expect(pick(await list(''))).toEqual([...mine].sort());
    });

    it('?alert=true ⇔ carrierAlert ∨ labelAlert (las MISMAS funciones del DTO)', async () => {
      const ok = await labeled();
      const live = await labeled(); // guía viva sobre un `cancelado` ⇒ label_live_on_cancelled
      await h.prisma.shipmentRequest.update({ where: { id: live.id }, data: { status: 'cancelado' } });
      const carrier = await labeled(); // el transportista reporta un problema ⇒ carrierAlert
      await h.prisma.shipmentRequest.update({ where: { id: carrier.id }, data: { carrierStatus: 'exception', carrierStatusAt: new Date() } });
      const moving = await labeled(); // en tránsito: sin alerta
      await h.prisma.shipmentRequest.update({ where: { id: moving.id }, data: { carrierStatus: 'in_transit', carrierStatusAt: new Date() } });
      const mine = new Set([ok.id, live.id, carrier.id, moving.id]);
      const pick = (r: R) => ids(r).filter((x) => mine.has(x));
      expect(pick(await list('alert=true'))).toEqual([live.id, carrier.id].sort());
      // el detalle dice lo mismo (una definición)
      expect((await h.api('GET', `/admin/shipments/${live.id}`, { token: db.opToken })).body.labelAlert?.kind).toBe('label_live_on_cancelled');
      expect((await h.api('GET', `/admin/shipments/${ok.id}`, { token: db.opToken })).body.labelAlert).toBeNull();
      expect(pick(await list(''))).toEqual([...mine].sort());
    });

    it('fuera de dominio ⇒ 400 (§0-Q / S-GAS-2), ⛔ nunca 500', async () => {
      const f = await list('folio=ENV-45');
      expect(errCode(f)).toBe('400:VALIDATION_ERROR');
      expect(f.body.error.details).toEqual({ field: 'folio' });
      const l = await list('labelSource=nope');
      expect(l.status).toBe(400);
      expect(l.body.error.details).toEqual(expect.objectContaining({ field: 'labelSource', allowed: expect.arrayContaining(['manual', 'skydropx']) }));
      const a = await list('alert=false');
      expect(a.status).toBe(400);
      expect(a.body.error.details).toEqual(expect.objectContaining({ field: 'alert', allowed: ['true'] }));
    });
  });

  // ================================================================ PS-167 — `label/cancel` sin respuesta / rechazada

  describe('PS-167 — `label/cancel` cuando `cancel` LANZA o rechaza (§19.31.6)', () => {
    it('(a) timeout en una re-emisión ⇒ sello REVERTIDO, 502 {op:cancel}, `label_cancel_unknown`, guía intacta; el reintento con ok ⇒ cancelled', async () => {
      const s = await labeled();
      fake.cancelOutcomes.push({ throws: ShippingProviderError.error('cancel', null, 'timeout') });
      const r = await cancel(s.id);
      expect(errCode(r)).toBe('502:SHIPPING_PROVIDER_ERROR');
      expect(r.body.error.details).toEqual(expect.objectContaining({ op: 'cancel' }));
      const s1 = await row(s.id);
      expect(s1).toEqual(expect.objectContaining({ status: 'guia', providerShipmentId: s.row.providerShipmentId, trackingNumber: s.row.trackingNumber, providerCanceledAt: null, providerCancelReason: null }));
      const unknown = await audits(s.id, 'shipment.label_cancel_unknown');
      expect(unknown).toHaveLength(1);
      expect(unknown[0].after).toEqual({ providerShipmentId: s.row.providerShipmentId, error: { code: 'SHIPPING_PROVIDER_ERROR', status: null, reason: 'timeout' } });
      fake.calls.length = 0;
      const again = await cancel(s.id);
      expect(errCode(again)).toBe('200');
      expect(again.body.outcome).toBe('cancelled');
      expect(fake.callsOf('cancel')).toHaveLength(1);
      expect((await row(s.id)).status).toBe('picking');
    });

    it('(a) también con 503 (ocupado) ⇒ revertido y `label_cancel_unknown`', async () => {
      const s = await labeled();
      fake.cancelOutcomes.push({ throws: ShippingProviderError.busy('cancel') });
      expect(errCode(await cancel(s.id))).toBe('503:SHIPPING_PROVIDER_BUSY');
      expect((await row(s.id)).providerCanceledAt).toBeNull();
      expect(await audits(s.id, 'shipment.label_cancel_unknown')).toHaveLength(1);
    });

    it("(b) ok:false y `getShipment` con `canceled` ⇒ cancelled (re-emisión aplicada, refundedCents null, via 'provider_already_cancelled')", async () => {
      const s = await labeled();
      fake.setShipment(s.row.providerShipmentId as string, { carrierStatus: 'canceled' });
      fake.cancelOutcomes.push({ ok: false, code: 'already_cancelled', message: 'ya cancelada' });
      const r = await cancel(s.id);
      expect(errCode(r)).toBe('200');
      expect(r.body.outcome).toBe('cancelled');
      expect(fake.calls.map((c) => c.op).filter((op) => op === 'cancel' || op === 'getShipment')).toEqual(['cancel', 'getShipment']);
      const s1 = await row(s.id);
      expect(s1).toEqual(expect.objectContaining({ status: 'picking', providerShipmentId: null, labelSource: null }));
      const paid = await h.prisma.shipmentPaidLabel.findUniqueOrThrow({ where: { providerShipmentId: s.row.providerShipmentId as string } });
      expect(paid).toEqual(expect.objectContaining({ cancelKind: 'reissue', unrefundedCents: null }));
      const [c] = await audits(s.id, 'shipment.label_cancelled');
      expect(c.after).toEqual(expect.objectContaining({ refundedCents: null, via: 'provider_already_cancelled' }));
    });

    it('(b) ok:false y `getShipment` sin `canceled` ⇒ 422 y revertido; ilegible ⇒ 422 y revertido', async () => {
      const s = await labeled();
      fake.cancelOutcomes.push({ ok: false, code: 'not_allowed', message: 'no' });
      const r = await cancel(s.id);
      expect(errCode(r)).toBe('422:SHIPPING_PROVIDER_REJECTED');
      expect(fake.callsOf('getShipment')).toHaveLength(1);
      expect((await row(s.id))).toEqual(expect.objectContaining({ status: 'guia', providerCanceledAt: null }));
      const original = fake.getShipment.bind(fake);
      fake.getShipment = async () => {
        throw ShippingProviderError.error('shipment', 500);
      };
      try {
        fake.cancelOutcomes.push({ ok: false, code: 'not_allowed', message: 'no' });
        expect(errCode(await cancel(s.id))).toBe('422:SHIPPING_PROVIDER_REJECTED');
        expect((await row(s.id))).toEqual(expect.objectContaining({ status: 'guia', providerCanceledAt: null }));
      } finally {
        fake.getShipment = original;
      }
      expect(await audits(s.id, 'shipment.label_cancelled')).toHaveLength(0);
    });

    it('(c) `auto_close` con timeout ⇒ sello CONSERVADO (sin confirmar) y `label_cancel_failed`; ⛔ sin `label_cancel_unknown`', async () => {
      const s = await labeled();
      fake.cancelOutcomes.push({ throws: ShippingProviderError.error('cancel', null, 'timeout') });
      const dispute = await h.sendStripeWebhook({ id: `evt_${RUN}_${Math.random().toString(36).slice(2)}`, type: 'charge.dispute.created', data: { object: { object: 'dispute', payment_intent: s.d.pi } } });
      expect(dispute.status).toBeLessThan(300);
      const s1 = await row(s.id);
      expect(s1).toEqual(expect.objectContaining({ status: 'cancelado', providerCancelReason: 'auto_close', providerCancelConfirmedAt: null }));
      expect(s1.providerCanceledAt).not.toBeNull();
      expect(fake.callsOf('cancel')).toHaveLength(1);
      expect(await audits(s.id, 'shipment.label_cancel_unknown')).toHaveLength(0);
      clock.set(new Date(Date.now() + 3 * MIN));
      expect((await h.api('GET', `/admin/shipments/${s.id}`, { token: db.opToken })).body.labelAlert?.kind).toBe('label_cancel_failed');
    });
  });

  // ================================================================ PS-168 — vigencia de la cotización reutilizada

  describe('PS-168 — la cotización reutilizada y «la vigente» (§19.31.2)', () => {
    const mkReady = async () => {
      const d = await db.mkDirect({ prices: [50000, 30000] });
      await ready(db, d.shipment.id);
      return d.shipment.id;
    };
    const quoteRow = (shipmentId: string, providerQuotationId: string) =>
      h.prisma.shipmentQuote.findUniqueOrThrow({ where: { shipmentRequestId_providerQuotationId: { shipmentRequestId: shipmentId, providerQuotationId } } });

    it('(a) X visto en T (A) y en T+10 h para B ⇒ expiresAt de B = T+24 h (⛔ no se alarga)', async () => {
      fake.reuseQuotations = true;
      const T = clock.now();
      const a = await mkReady();
      const b = await mkReady();
      const qa = await quote(a);
      clock.set(new Date(T.getTime() + 10 * H));
      const qb = await quote(b);
      expect(qb.body.providerQuotationId).toBe(qa.body.providerQuotationId);
      expect(qb.body.expiresAt).toBe(new Date(T.getTime() + 24 * H).toISOString());
    });

    it('(b) X visto en T+25 h para B (todas vencidas) ⇒ T+49 h y log; `label` con ella en T+26 h ⇒ compra (⛔ sin QUOTE_EXPIRED)', async () => {
      fake.reuseQuotations = true;
      const logSpy = jest.spyOn((h.app.get(ShipmentQuoteService) as unknown as { logger: { log: (m: string) => void } }).logger, 'log');
      const T = clock.now();
      const a = await mkReady();
      const b = await mkReady();
      const qa = await quote(a);
      clock.set(new Date(T.getTime() + 25 * H));
      const qb = await quote(b);
      expect(qb.body.providerQuotationId).toBe(qa.body.providerQuotationId);
      expect(qb.body.expiresAt).toBe(new Date(T.getTime() + 49 * H).toISOString());
      const lines = logSpy.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('quotation_id_reissued_after_expiry'));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain(`lastExpiredAt=${new Date(T.getTime() + 24 * H).toISOString()}`);
      expect(lines[0]).not.toContain(qa.body.providerQuotationId);
      logSpy.mockRestore();
      clock.set(new Date(T.getTime() + 26 * H));
      const r = await buy(b, buyBody(qb.body, pickRate(qb.body)));
      expect(errCode(r)).toBe('200');
      expect(r.body.outcome).toBe('labeled');
    });

    it('(c) A re-cotiza con `force` en T+2 h y recibe X ⇒ fila actualizada (requestedAt, requestedByUserId) sin alargar; con Y (otro empaque) en T+1 h, GET devuelve X', async () => {
      fake.reuseQuotations = true;
      const T = clock.now();
      const a = await mkReady();
      const x = await quote(a, { packageCode: 'envelope' });
      clock.set(new Date(T.getTime() + 1 * H));
      const y = await quote(a, { packageCode: 'box' });
      expect(y.body.providerQuotationId).not.toBe(x.body.providerQuotationId);
      expect((await current(a)).body.quoteId).toBe(y.body.quoteId);
      clock.set(new Date(T.getTime() + 2 * H));
      const x2 = await quote(a, { packageCode: 'envelope', force: true }, db.adminToken);
      expect(x2.body.providerQuotationId).toBe(x.body.providerQuotationId);
      const rowX = await quoteRow(a, x.body.providerQuotationId);
      expect(rowX.requestedAt.toISOString()).toBe(new Date(T.getTime() + 2 * H).toISOString());
      expect(rowX.requestedByUserId).toBe(db.adminId);
      expect(rowX.expiresAt.toISOString()).toBe(new Date(T.getTime() + 24 * H).toISOString());
      expect((await current(a)).body.quoteId).toBe(x.body.quoteId);
    });

    it('(d) `excluded` de la fresca == el de la reutilizada (fixture medido de PS-94)', async () => {
      const a = await mkReady();
      const fresh = await quote(a);
      const reused = await quote(a);
      expect(fresh.body.reused).toBe(false);
      expect(reused.body.reused).toBe(true);
      expect(reused.body.excluded).toEqual(fresh.body.excluded);
      expect(Object.values(fresh.body.excluded as Record<string, number>).some((n) => n > 0)).toBe(true); // no-vacuidad
    });
  });

  // ================================================================ PS-169 — los dos `reason` nuevos

  describe('PS-169 — `label` sin `409 CONFLICT` mudo (§19.31.7 (a))', () => {
    it("`count 0` local (otra causa, mismo reclamo) ⇒ 409 {reason:'shipment_changed_during_purchase', labelAutoCancelled:true} y UN cancel", async () => {
      const s = await readyQuoted();
      fake.onPurchase = async () => {
        await h.prisma.shipmentRequest.update({ where: { id: s.id }, data: { preparedAt: null, preparedByUserId: null } });
      };
      const r = await buy(s.id, buyBody(s.q, s.rate));
      expect(errCode(r)).toBe('409:CONFLICT');
      expect(r.body.error.details).toEqual({ reason: 'shipment_changed_during_purchase', labelAutoCancelled: true });
      expect(fake.callsOf('purchase')).toHaveLength(1);
      expect(fake.callsOf('cancel')).toHaveLength(1);
      const s1 = await row(s.id);
      expect(s1).toEqual(expect.objectContaining({ status: 'picking', labelProcessingSince: null, providerShipmentId: null, labelSource: null }));
    });

    it("7b.2 con el reclamo liberado ⇒ 409 {reason:'claim_released'} y CERO purchase", async () => {
      const s = await readyQuoted();
      let calls = 0;
      fake.onBalance = async () => {
        calls += 1;
        if (calls !== 2) return; // la 2.ª lectura es la del 7b.1, ya con el reclamo escrito
        await h.prisma.shipmentRequest.update({ where: { id: s.id }, data: { labelProcessingSince: null } });
      };
      const r = await buy(s.id, buyBody(s.q, s.rate));
      expect(errCode(r)).toBe('409:CONFLICT');
      expect(r.body.error.details).toEqual({ reason: 'claim_released' });
      expect(fake.callsOf('purchase')).toHaveLength(0);
    });
  });
});
