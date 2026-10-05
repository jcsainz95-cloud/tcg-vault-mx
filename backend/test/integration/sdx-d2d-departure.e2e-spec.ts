/**
 * sdx-d2d-departure.e2e-spec.ts — ⭐ D2d: «Salida de hoy» (API_CONTRACT §M4-SHIP.19.9, criterio 240; S-GAS-1 `folio`) contra
 * Postgres REAL, app completa por HTTP, proveedor DOBLE (⛔ nunca la red: PS-99). Propiedad: backend.
 *
 * PS-77: 3 envíos `guia` de Skydropx (2 × 99minutos, 1 × Paquetexpress) + 1 manual ⇒ 2 grupos (la preferida primero,
 * `isPreferred`), `manualPending:1`, sin teléfonos ni precios; `departed` ⇒ 3 × `shipped`, piezas `shipped`, 3 AV-5;
 * repetir ⇒ 3 × `already_shipped`, cero correos; concurrente (N=10 rondas × 10 lotes simultáneos) ⇒ UN AV-5 por envío;
 * el sondeo después ⇒ cero AV-5; el sondeo ANTES ⇒ `enviado` + 1 AV-5 y `departed` ⇒ `already_shipped`.
 */
import { E2EHarness } from './helpers/e2e-app';
import { R, ShipPrepDb } from './helpers/ship-prep-db';
import { buyBody, createLabelWorld, dial, errCode, purchaseOn, ready, restoreDials } from './helpers/label-db';
import { FakeShippingProvider } from '../../src/modules/shipping-provider/fake-shipping-provider';
import { ManualLabelClock } from '../../src/modules/shipments/label-clock';
import { MAIL_PORT, MailMessage, MailPort } from '../../src/modules/mail/mail.port';
import { E2E_USERS } from '../../prisma/e2e-fixtures';

const RUN = `d2dd${Date.now().toString(36)}`;
const H = 3_600_000;
const N = 10;

describe('⭐ D2d — «Salida de hoy» (§19.9, PS-77)', () => {
  let h: E2EHarness;
  let db: ShipPrepDb;
  let fake: FakeShippingProvider;
  let clock: ManualLabelClock;
  let bandeja: MailMessage[];

  const quote = (id: string): Promise<R> => h.api('POST', `/admin/shipments/${id}/quote`, { token: db.opToken, json: {} });
  const buy = (id: string, json: unknown): Promise<R> => {
    clock.advance(1);
    return h.api('POST', `/admin/shipments/${id}/label`, { token: db.opToken, json });
  };
  const board = (q = ''): Promise<R> => h.api('GET', `/admin/shipments/departure${q}`, { token: db.opToken });
  const departed = (ids: string[], token = db.opToken): Promise<R> => h.api('POST', '/admin/shipments/departed', { token, json: { shipmentIds: ids } });
  const row = (id: string) => h.prisma.shipmentRequest.findUniqueOrThrow({ where: { id } });
  const AV5 = /va en camino|on its way/i;
  const av5To = (to: string) => bandeja.filter((m) => m.to === to && AV5.test(m.subject));

  const labeled = async (carrierName: string) => {
    const d = await db.mkDirect({ prices: [50000, 30000] });
    await ready(db, d.shipment.id);
    const q = await quote(d.shipment.id);
    expect(q.status).toBe(200);
    const rate = q.body.rates.find((r: any) => r.carrierName === carrierName);
    expect(rate).toBeDefined();
    const r = await buy(d.shipment.id, buyBody(q.body, rate));
    expect(errCode(r)).toBe('200');
    expect(r.body.outcome).toBe('labeled');
    const s = await row(d.shipment.id);
    return { id: d.shipment.id, psid: s.providerShipmentId as string, to: d.order.guestEmail as string, d, row: s };
  };
  /** Deja SOLO estos envíos como «por salir» con guía (los de otras pruebas pasan a `enviado`, como si hubieran salido). */
  const isolate = async (keep: string[]) => {
    await h.prisma.shipmentRequest.updateMany({ where: { status: 'guia', id: { notIn: keep } }, data: { status: 'enviado', shippedAt: new Date() } });
  };

  beforeAll(async () => {
    ({ h, db, fake, clock } = await createLabelWorld(RUN));
    await purchaseOn(h, 'operators');
    await dial(h, 'operator_label_cap_24h_cents', 1_000_000_000);
    await dial(h, 'shipping_preferred_carriers', ['ninetynineminutes']);
    const port = h.app.get<MailPort>(MAIL_PORT);
    jest.spyOn(port, 'send').mockImplementation(async (msg: MailMessage) => {
      bandeja.push(msg);
      return {};
    });
  });

  afterAll(async () => {
    await h.prisma.spendAlert.deleteMany({ where: { OR: [{ shipmentRequestId: { in: db.shipments } }, { subjectUserId: { in: [db.operatorId, db.adminId] } }, { dedupKey: { startsWith: 'ag7:' } }] } });
    await restoreDials(h);
    await db.cleanup();
    await h?.close();
  });

  beforeEach(async () => {
    fake.calls.length = 0;
    fake.purchaseOutcomes.length = 0;
    fake.balanceCents = 10_000_000;
    fake.forgetQuotations();
    clock.set(new Date());
    bandeja = [];
  });

  afterEach(async () => {
    await h.prisma.$executeRaw`UPDATE "ShipmentLabelAttempt" SET since = since - interval '25 hours' WHERE since > ${new Date(Date.now() - 25 * H)}`;
  });

  it('el tablero: 2 grupos (la preferida primero), folio, `manualPending:1`, ⛔ sin teléfonos ni precios; `departed` ⇒ 3 shipped + 3 AV-5; repetir ⇒ already_shipped y cero correos', async () => {
    const a = await labeled('ninetynineminutes');
    const b = await labeled('ninetynineminutes');
    const c = await labeled('paquetexpress');
    const m = await db.mkDirect();
    await ready(db, m.shipment.id);
    expect((await db.tracking(m.shipment.id)).status).toBe(201);
    await isolate([a.id, b.id, c.id, m.shipment.id]);
    fake.calls.length = 0;
    const r = await board();
    expect(errCode(r)).toBe('200');
    expect(r.body.manualPending).toBe(1);
    expect(r.body.groups.map((g: any) => [g.carrierName, g.isPreferred, g.shipments.map((x: any) => x.shipmentId)])).toEqual([
      ['ninetynineminutes', true, [a.id, b.id]],
      ['paquetexpress', false, [c.id]],
    ]);
    expect(r.body.groups[0].dropoff).toEqual(expect.objectContaining({ name: expect.any(String), address: expect.any(String) }));
    expect(r.body.groups[0].shipments[0]).toEqual({
      shipmentId: a.id,
      folio: a.row.folio,
      orderNumber: a.d.order.orderNumber,
      kind: 'guest_direct_ship',
      recipientName: expect.any(String),
      city: expect.any(String),
      trackingNumber: a.row.trackingNumber,
      labelAvailable: true,
      labelPurchasedAt: a.row.labelPurchasedAt!.toISOString(),
    });
    const json = JSON.stringify(r.body);
    expect(json).not.toMatch(/phone|Cents|price|line1|labelUrl|5512345678/i);
    // ⛔ El tablero no toca la red.
    expect(fake.calls).toHaveLength(0);

    const d1 = await departed([a.id, b.id, c.id]);
    expect(errCode(d1)).toBe('200');
    expect(d1.body.results).toEqual([a, b, c].map((s) => ({ shipmentId: s.id, outcome: 'shipped' })));
    for (const s of [a, b, c]) {
      const x = await row(s.id);
      expect(x.status).toBe('enviado');
      expect(x.shippedAt).not.toBeNull();
      expect(av5To(s.to)).toHaveLength(1);
      const pcs = await h.prisma.inventoryItem.findMany({ where: { id: { in: s.d.pieces.map((p) => p.id) } }, select: { status: true } });
      expect(pcs.map((p) => p.status)).toEqual(['shipped', 'shipped']);
      const logs = await h.prisma.auditLog.findMany({ where: { entityId: s.id, action: 'shipment.departed' } });
      expect(logs).toHaveLength(1);
      expect(logs[0].actorUserId).toBe(db.operatorId);
      expect(logs[0].after).toEqual({ batchId: expect.any(String) });
    }
    bandeja = [];
    const d2 = await departed([a.id, b.id, c.id]);
    expect(d2.body.results.map((x: any) => x.outcome)).toEqual(['already_shipped', 'already_shipped', 'already_shipped']);
    expect(bandeja).toHaveLength(0);
    // Después de salir: el tablero ya no los lista.
    expect((await board()).body.groups).toEqual([]);
    // El sondeo después con `picked_up` ⇒ CERO AV-5 (el CAS cuenta 0).
    fake.pushEvent(a.psid, 'picked_up', new Date(clock.now().getTime() - H).toISOString());
    expect(errCode(await h.api('POST', `/admin/shipments/${a.id}/refresh-tracking`, { token: db.opToken, json: {} }))).toBe('200');
    expect(bandeja).toHaveLength(0);
  });

  it('el sondeo ANTES que `departed` ⇒ enviado + 1 AV-5, y `departed` ⇒ already_shipped sin segundo AV-5; la guía manual también se acepta', async () => {
    const a = await labeled('ninetynineminutes');
    fake.pushEvent(a.psid, 'in_transit', new Date(clock.now().getTime() - H).toISOString());
    expect(errCode(await h.api('POST', `/admin/shipments/${a.id}/refresh-tracking`, { token: db.opToken, json: {} }))).toBe('200');
    expect(av5To(a.to)).toHaveLength(1);
    const m = await db.mkDirect();
    await ready(db, m.shipment.id);
    expect((await db.tracking(m.shipment.id)).status).toBe(201);
    const p = await db.mkDirect(); // en `picking`, sin guía ⇒ rechazado con el código de la guarda o CONFLICT
    const unknown = '00000000-0000-4000-8000-000000000000';
    const r = await departed([a.id, m.shipment.id, p.shipment.id, unknown]);
    expect(r.body.results).toEqual([
      { shipmentId: a.id, outcome: 'already_shipped' },
      { shipmentId: m.shipment.id, outcome: 'shipped' },
      { shipmentId: p.shipment.id, outcome: 'rejected', code: 'CONFLICT' },
      { shipmentId: unknown, outcome: 'rejected', code: 'NOT_FOUND' },
    ]);
    expect(av5To(a.to)).toHaveLength(1);
  });

  it('una guarda de §M4-SHIP.6 rechaza con SU código (pedido ya no liquidado ⇒ ORDER_NOT_SETTLED); el resto del lote sigue', async () => {
    const a = await labeled('ninetynineminutes');
    const b = await labeled('paquetexpress');
    await h.prisma.order.update({ where: { id: a.d.order.id }, data: { status: 'refunded' } });
    const r = await departed([a.id, b.id]);
    expect(r.body.results).toEqual([
      { shipmentId: a.id, outcome: 'rejected', code: 'ORDER_NOT_SETTLED' },
      { shipmentId: b.id, outcome: 'shipped' },
    ]);
    expect((await row(a.id)).status).toBe('guia');
  });

  it(`concurrente: ${N} rondas × 10 lotes simultáneos sobre el MISMO envío ⇒ exactamente 1 shipped y 1 AV-5 por ronda (proporción)`, async () => {
    let ok = 0;
    for (let i = 0; i < N; i += 1) {
      const a = await labeled('ninetynineminutes');
      bandeja = [];
      const rs = await Promise.all(Array.from({ length: 10 }, () => departed([a.id])));
      const outcomes = rs.map((r) => r.body.results?.[0]?.outcome);
      const good = outcomes.filter((o) => o === 'shipped').length === 1 && outcomes.filter((o) => o === 'already_shipped').length === 9 && av5To(a.to).length === 1;
      if (good) ok += 1;
    }
    // eslint-disable-next-line no-console
    console.log(`PS-77 concurrente: ${ok}/${N} rondas con exactamente 1 shipped y 1 AV-5`);
    expect(ok).toBe(N);
  });

  it('`?date=`: ausente ⇒ hoy MX; inválida ⇒ 400 {field:date}; un día ANTERIOR a la compra ⇒ no aparece; cuerpo inválido ⇒ 400; cliente ⇒ 403', async () => {
    const a = await labeled('ninetynineminutes');
    await isolate([a.id]);
    expect((await board()).body.groups.flatMap((g: any) => g.shipments.map((x: any) => x.shipmentId))).toEqual([a.id]);
    expect(errCode(await board('?date=2026-02-30'))).toBe('400:VALIDATION_ERROR');
    expect((await board('?date=2026-02-30')).body.error.details).toEqual({ field: 'date' });
    expect((await board('?date=2020-01-01')).body.groups).toEqual([]);
    expect((await board('?date=2099-01-01')).body.groups.flatMap((g: any) => g.shipments.map((x: any) => x.shipmentId))).toEqual([a.id]);
    expect(errCode(await h.api('POST', '/admin/shipments/departed', { token: db.opToken, json: { shipmentIds: [] } }))).toBe('400:VALIDATION_ERROR');
    const ct = await h.login(E2E_USERS.customer.email, E2E_USERS.customer.password);
    expect((await h.api('GET', '/admin/shipments/departure', { token: ct })).status).toBe(403);
    expect((await departed([a.id], ct)).status).toBe(403);
  });
});
