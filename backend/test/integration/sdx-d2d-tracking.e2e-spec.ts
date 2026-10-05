/**
 * sdx-d2d-tracking.e2e-spec.ts — ⭐💰 D2d: el rastreo de una guía de Skydropx contra Postgres REAL, app Nest completa por
 * HTTP, proveedor DOBLE (⛔ nunca la red: PS-99), llave de compra SUSTITUIDA (⛔ nadie pone `SKYDROPX_ALLOW_SPEND`), puerto
 * de avisos AV-17/18/19 SUSTITUIDO por un registro (los correos son de D2e). Propiedad: backend.
 *
 * Cubre (API_CONTRACT §M4-SHIP.19.3, §19.10, §19.18.1–.2, §19.19.9–.10, §19.29.6, §19.32.5):
 *  - PS-72 (un evento, una vez: secuencial ×10 y concurrente N=10 rondas; «solo estado actual» ×10; `updated_at` en la
 *    llave; SEC-SDX-9 fuera de orden; guía re-emitida con la misma llave ⇒ fila nueva).
 *  - PS-75 (guía en proceso ⇒ el job escribe el número y AV-4 UNA vez; `entregado` a mano ⇒ 0 AV-17; `delivered` después
 *    ⇒ AV-17 una vez aunque el CAS de estado cuente 0).
 *  - PS-78 (mapeo completo, una fila por estado), PS-79 (`delivered` sin `enviado`), PS-150 (AG-11/AG-12).
 *  - `refresh-tracking` (404 con el proveedor apagado, 403 al cliente, el DTO con `carrierAlert`), relleno de `labelUrl`
 *    nula (§19.19.9), estado desconocido (§19.19.10), los jobs no-op con `off` (SEC-SDX-12).
 */
import { E2EHarness } from './helpers/e2e-app';
import { R, ShipPrepDb } from './helpers/ship-prep-db';
import { NoticeRecorder, buyBody, createLabelWorld, dial, errCode, purchaseOn, ready, restoreDials } from './helpers/label-db';
import { FakeShippingProvider } from '../../src/modules/shipping-provider/fake-shipping-provider';
import { ManualLabelClock } from '../../src/modules/shipments/label-clock';
import { ShipmentCarrierService } from '../../src/modules/shipments/carrier-status.service';
import { MAIL_PORT, MailMessage, MailPort } from '../../src/modules/mail/mail.port';
import { E2E_USERS } from '../../prisma/e2e-fixtures';

const RUN = `d2dt${Date.now().toString(36)}`;
const H = 3_600_000;
const D = 24 * H;
const N = 10;

describe('⭐💰 D2d — rastreo: applyCarrierStatus, sondeo y refresh-tracking (§19.3, §19.10)', () => {
  let h: E2EHarness;
  let db: ShipPrepDb;
  let fake: FakeShippingProvider;
  let clock: ManualLabelClock;
  let notices: NoticeRecorder;
  let bandeja: MailMessage[];
  let carrier: ShipmentCarrierService;
  let customerToken: string;

  const quote = (id: string): Promise<R> => h.api('POST', `/admin/shipments/${id}/quote`, { token: db.opToken, json: {} });
  const buy = (id: string, json: unknown): Promise<R> => {
    clock.advance(1);
    return h.api('POST', `/admin/shipments/${id}/label`, { token: db.opToken, json });
  };
  const refresh = (id: string, token = db.opToken): Promise<R> => {
    clock.advance(1000);
    return h.api('POST', `/admin/shipments/${id}/refresh-tracking`, { token, json: {} });
  };
  const job = (name: string, json: unknown = {}): Promise<R> => h.api('POST', `/admin/jobs/${name}`, { token: db.adminToken, json });
  const row = (id: string) => h.prisma.shipmentRequest.findUniqueOrThrow({ where: { id } });
  const events = (id: string) => h.prisma.shipmentCarrierEvent.findMany({ where: { shipmentRequestId: id }, orderBy: [{ occurredAt: 'asc' }, { observedAt: 'asc' }] });
  const audits = (id: string, action: string) => h.prisma.auditLog.findMany({ where: { entityId: id, action }, orderBy: { createdAt: 'asc' } });
  const pickRate = (q: any) => q.rates.find((r: any) => r.deliveryKind !== 'branch' && r.marginCents >= 0 && !r.hidden) ?? q.rates[0];
  const mailsTo = (to: string, re: RegExp) => bandeja.filter((m) => m.to === to && re.test(m.subject));
  const AV4 = /guía de envío|tracking number/i;
  const AV5 = /va en camino|on its way/i;
  const iso = (ms: number) => new Date(ms).toISOString();

  /**
   * Un envío directo con guía de Skydropx comprada por el doble («éxito con número»). La compra escribe `carrierStatus:
   * 'created'` con `carrierStatusAt` = el instante de la compra, así que los eventos de la prueba van DESPUÉS: la compra se
   * hace `ageMs` antes (por defecto 2 h) y el reloj vuelve a «ahora».
   */
  const labeled = async (opts: { processing?: boolean; ageMs?: number } = {}) => {
    const back = clock.now().getTime();
    clock.set(new Date(back - (opts.ageMs ?? 2 * H)));
    const d = await db.mkDirect({ prices: [50000, 30000] });
    await ready(db, d.shipment.id);
    const q = await quote(d.shipment.id);
    expect(q.status).toBe(200);
    if (opts.processing) fake.purchaseOutcomes.push({ kind: 'processing' });
    const r = await buy(d.shipment.id, buyBody(q.body, pickRate(q.body)));
    expect(errCode(r)).toBe('200');
    expect(r.body.outcome).toBe(opts.processing ? 'processing' : 'labeled');
    const s = await row(d.shipment.id);
    clock.set(new Date(back));
    return { id: d.shipment.id, psid: s.providerShipmentId as string, to: d.order.guestEmail as string, d, row: s };
  };

  beforeAll(async () => {
    let world;
    ({ h, db, fake, clock, notices } = world = await createLabelWorld(RUN));
    void world;
    await purchaseOn(h, 'operators');
    await dial(h, 'operator_label_cap_24h_cents', 1_000_000_000);
    carrier = h.app.get(ShipmentCarrierService);
    customerToken = await h.login(E2E_USERS.customer.email, E2E_USERS.customer.password);
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
    notices.calls.length = 0;
    await dial(h, 'shipping_provider', 'skydropx');
  });

  afterEach(async () => {
    await h.prisma.$executeRaw`UPDATE "ShipmentLabelAttempt" SET since = since - interval '25 hours' WHERE since > ${new Date(Date.now() - 25 * H)}`;
  });

  // ================================================================ PS-72 — un evento, una vez

  describe('PS-72 — un evento, una vez (criterio 241)', () => {
    it('secuencial ×10 con el MISMO historial ⇒ 1 fila, 1 transición, 1 AV-5; la fila del envío no cambia tras la 1.ª (salvo carrierPolledAt)', async () => {
      const s = await labeled();
      fake.pushEvent(s.psid, 'picked_up', iso(clock.now().getTime() - H));
      bandeja = [];
      const r1 = await refresh(s.id);
      expect(errCode(r1)).toBe('200');
      const after1 = await row(s.id);
      for (let i = 0; i < 9; i += 1) expect(errCode(await refresh(s.id))).toBe('200');
      const after10 = await row(s.id);
      expect(await events(s.id)).toHaveLength(1);
      expect(after10.status).toBe('enviado');
      expect(mailsTo(s.to, AV5)).toHaveLength(1);
      expect(await audits(s.id, 'shipment.carrier_event')).toHaveLength(1);
      const { carrierPolledAt: p1, ...rest1 } = after1;
      const { carrierPolledAt: p10, ...rest10 } = after10;
      expect(rest10).toEqual(rest1);
      expect(p10!.getTime()).toBeGreaterThan(p1!.getTime());
    });

    it(`concurrente: ${N} lecturas simultáneas por ronda, N=${N} rondas ⇒ 1 fila, 1 transición y 1 AV-5 por ronda (proporción)`, async () => {
      let ok = 0;
      for (let round = 0; round < N; round += 1) {
        const s = await labeled();
        fake.pushEvent(s.psid, 'in_transit', iso(clock.now().getTime() - H));
        bandeja = [];
        const base = await row(s.id);
        await Promise.all(Array.from({ length: 10 }, () => carrier.pollShipment(base, 'track')));
        const ev = await events(s.id);
        const st = await row(s.id);
        const good = ev.length === 1 && st.status === 'enviado' && mailsTo(s.to, AV5).length === 1 && (await audits(s.id, 'shipment.carrier_event')).length === 1;
        if (good) ok += 1;
      }
      // eslint-disable-next-line no-console
      console.log(`PS-72 concurrente: ${ok}/${N} rondas con 1 fila, 1 transición y 1 AV-5`);
      expect(ok).toBe(N);
    });

    it('«solo estado actual» (sin historial ni updated_at): delivery_attempt ×10 con el reloj avanzando ⇒ 1 fila, 1 AV-19, carrierPolledAt avanza; delivered ⇒ 1 fila nueva y AV-17', async () => {
      const s = await labeled();
      fake.setShipment(s.psid, { carrierStatus: 'delivery_attempt', events: [], statusUpdatedAt: null });
      for (let i = 0; i < 10; i += 1) {
        clock.advance(H);
        expect(errCode(await refresh(s.id))).toBe('200');
      }
      const ev = await events(s.id);
      expect(ev.map((e) => [e.status, e.providerEventKey])).toEqual([['delivery_attempt', 'delivery_attempt']]);
      expect(notices.of(s.id, 'AV-19')).toHaveLength(1);
      expect((await row(s.id)).carrierPolledAt!.getTime()).toBe(clock.now().getTime());
      fake.setShipment(s.psid, { carrierStatus: 'delivered' });
      expect(errCode(await refresh(s.id))).toBe('200');
      expect((await events(s.id)).map((e) => e.status)).toEqual(['delivery_attempt', 'delivered']);
      expect(notices.of(s.id, 'AV-17')).toHaveLength(1);
      expect((await row(s.id)).status).toBe('entregado');
    });

    it('con updated_at ⇒ llave `estado:<updated_at>` (y otra fecha ⇒ otra fila)', async () => {
      const s = await labeled();
      fake.setShipment(s.psid, { carrierStatus: 'in_transit', events: [], statusUpdatedAt: '2026-10-05T10:00:00Z' });
      await refresh(s.id);
      await refresh(s.id);
      fake.setShipment(s.psid, { carrierStatus: 'last_mile', statusUpdatedAt: '2026-10-05T11:00:00Z' });
      await refresh(s.id);
      expect((await events(s.id)).map((e) => e.providerEventKey)).toEqual(['in_transit:2026-10-05T10:00:00Z', 'last_mile:2026-10-05T11:00:00Z']);
    });

    it('SEC-SDX-9: historial fuera de orden (last_mile y luego un in_transit MÁS VIEJO) ⇒ carrierStatus NO retrocede; las dos filas existen', async () => {
      const s = await labeled({ ageMs: 3 * D });
      const t = clock.now().getTime();
      fake.pushEvent(s.psid, 'last_mile', iso(t - H));
      await refresh(s.id);
      fake.pushEvent(s.psid, 'in_transit', iso(t - 2 * D));
      await refresh(s.id);
      const st = await row(s.id);
      expect(st.carrierStatus).toBe('last_mile');
      expect(st.carrierStatusAt!.toISOString()).toBe(iso(t - H));
      expect((await events(s.id)).map((e) => e.status).sort()).toEqual(['in_transit', 'last_mile']);
      expect(st.status).toBe('enviado');
      // Y por el cuerpo directo (un `entregado` ya no se sondea): `delivered` y luego un `in_transit` más viejo ⇒ sigue `delivered`.
      const now = clock.now();
      await carrier.applyCarrierStatus(s.id, { status: 'delivered', occurredAt: new Date(t - 10 * 60_000), observedAt: now, providerEventKey: 'delivered:x', synthetic: false });
      await carrier.applyCarrierStatus(s.id, { status: 'in_transit', occurredAt: new Date(t - D), observedAt: now, providerEventKey: 'in_transit:y', synthetic: false });
      const st2 = await row(s.id);
      expect(st2.carrierStatus).toBe('delivered');
      expect(st2.status).toBe('entregado');
      expect(await events(s.id)).toHaveLength(4);
    });

    it('guía re-emitida con la MISMA llave de evento que la cancelada ⇒ fila nueva (el @@unique lleva providerShipmentId), cero P2002', async () => {
      const s = await labeled();
      fake.pushEvent(s.psid, 'created', iso(clock.now().getTime() - H), { providerEventId: 'ev-same' });
      await refresh(s.id);
      expect(errCode(await h.api('POST', `/admin/shipments/${s.id}/label/cancel`, { token: db.opToken, json: { reason: 'Re-emitir con otra paquetería' } }))).toBe('200');
      const q2 = await quote(s.id);
      expect(errCode(await buy(s.id, buyBody(q2.body, pickRate(q2.body))))).toBe('200');
      const psid2 = (await row(s.id)).providerShipmentId as string;
      expect(psid2).not.toBe(s.psid);
      fake.pushEvent(psid2, 'created', iso(clock.now().getTime() - H), { providerEventId: 'ev-same' });
      expect(errCode(await refresh(s.id))).toBe('200');
      const ev = await events(s.id);
      expect(ev.map((e) => [e.providerShipmentId, e.providerEventKey])).toEqual([
        [s.psid, 'id:ev-same'],
        [psid2, 'id:ev-same'],
      ]);
    });
  });

  // ================================================================ PS-75 — guía en proceso; AV-17 cuelga del evento

  describe('PS-75 — guía en proceso y AV-17', () => {
    it('`processing` ⇒ picking con id y 0 AV-4; el job con número ⇒ guia, par escrito, UN AV-4; otra corrida ⇒ nada', async () => {
      const s = await labeled({ processing: true });
      expect(s.row).toEqual(expect.objectContaining({ status: 'picking', trackingNumber: null }));
      expect(s.row.labelProcessingSince).not.toBeNull();
      expect(mailsTo(s.to, AV4)).toHaveLength(0);
      // Sin número todavía ⇒ el job no aplica nada.
      expect(errCode(await job('shipment-label-processing'))).toBe('200');
      expect((await row(s.id)).status).toBe('picking');
      fake.setShipment(s.psid, { trackingNumber: 'TN75PROC', carrierStatus: 'created' });
      clock.advance(60_000);
      const r = await job('shipment-label-processing');
      expect(errCode(r)).toBe('200');
      expect(r.body.processing.checked).toBeGreaterThanOrEqual(1);
      const s1 = await row(s.id);
      expect(s1).toEqual(expect.objectContaining({ status: 'guia', trackingNumber: 'TN75PROC', labelProcessingSince: null, labelSource: 'skydropx', providerShipmentId: s.psid }));
      expect(s1.carrier).not.toBeNull();
      expect(mailsTo(s.to, AV4)).toHaveLength(1);
      clock.advance(60_000);
      await job('shipment-label-processing');
      await refresh(s.id);
      expect(mailsTo(s.to, AV4)).toHaveLength(1);
      expect((await audits(s.id, 'shipment.tracking')).filter((a) => (a.after as any)?.via === 'processing')).toHaveLength(1);
    });

    it('`entregado` A MANO ⇒ 0 AV-17; después `delivered` del transportista ⇒ AV-17 UNA vez aunque el CAS de estado cuente 0', async () => {
      const s = await labeled();
      for (const to of ['enviado', 'entregado']) {
        expect(errCode(await h.api('PATCH', `/admin/shipments/${s.id}/status`, { token: db.opToken, json: { to } }))).toBe('200');
      }
      expect(notices.of(s.id, 'AV-17')).toHaveLength(0);
      const now = clock.now();
      const ev = { status: 'delivered' as const, occurredAt: now, observedAt: now, providerEventKey: 'delivered', synthetic: true };
      const r1 = await carrier.applyCarrierStatus(s.id, ev);
      expect(r1).toEqual(expect.objectContaining({ applied: true, delivered: false, shipped: false }));
      expect(notices.of(s.id, 'AV-17')).toHaveLength(1);
      await carrier.applyCarrierStatus(s.id, ev);
      expect(notices.of(s.id, 'AV-17')).toHaveLength(1);
    });
  });

  // ================================================================ PS-78 / PS-79 / PS-150 — el mapeo completo

  describe('PS-78 — el mapeo completo (una fila por estado de CarrierStatus)', () => {
    it.each(['picked_up', 'in_transit', 'last_mile'] as const)('%s ⇒ enviado UNA vez (AV-5 uno), piezas `shipped`', async (st) => {
      const s = await labeled();
      fake.pushEvent(s.psid, st, iso(clock.now().getTime() - H));
      bandeja = [];
      await refresh(s.id);
      await refresh(s.id);
      const r = await row(s.id);
      expect(r.status).toBe('enviado');
      expect(r.shippedAt).not.toBeNull();
      expect(mailsTo(s.to, AV5)).toHaveLength(1);
      const pieces = await h.prisma.inventoryItem.findMany({ where: { id: { in: s.d.pieces.map((p) => p.id) } }, select: { status: true } });
      expect(pieces.map((p) => p.status)).toEqual(['shipped', 'shipped']);
    });

    it('delivered_to_branch ⇒ enviado (⛔ nunca entregado), AV-18 una vez con la sucursal; luego delivered (de hace 8 d) ⇒ entregado, deliveredAt ≈ now, carrierStatusAt = la fecha del transportista, AV-17', async () => {
      const s = await labeled({ ageMs: 10 * D });
      const t = clock.now().getTime();
      fake.pushEvent(s.psid, 'delivered_to_branch', iso(t - 9 * D), { branchName: 'Sucursal Centro' });
      await refresh(s.id);
      await refresh(s.id);
      expect((await row(s.id)).status).toBe('enviado');
      expect(notices.of(s.id, 'AV-18')).toHaveLength(1);
      expect(notices.of(s.id, 'AV-18')[0].event.branchName).toBe('Sucursal Centro');
      fake.pushEvent(s.psid, 'delivered', iso(t - 8 * D));
      await refresh(s.id);
      const r = await row(s.id);
      expect(r.status).toBe('entregado');
      expect(r.carrierStatusAt!.toISOString()).toBe(iso(t - 8 * D));
      // 🔒 SEC-SDX-1: el plazo corre desde que NOSOTROS lo supimos (max(occurredAt, observedAt)).
      expect(Math.abs(r.deliveredAt!.getTime() - clock.now().getTime())).toBeLessThan(5_000);
      expect(notices.of(s.id, 'AV-17')).toHaveLength(1);
      const pieces = await h.prisma.inventoryItem.findMany({ where: { id: { in: s.d.pieces.map((p) => p.id) } }, select: { status: true } });
      expect(pieces.map((p) => p.status)).toEqual(['delivered', 'delivered']);
    });

    it('delivery_attempt ×2 con fechas DISTINTAS ⇒ 2 AV-19; la MISMA fecha ⇒ 1; sin cambio de estado; AG-12 🟡 por evento', async () => {
      const s = await labeled();
      const t = clock.now().getTime();
      fake.pushEvent(s.psid, 'delivery_attempt', iso(t - 2 * H));
      await refresh(s.id);
      fake.pushEvent(s.psid, 'delivery_attempt', iso(t - 2 * H)); // mismo evento repetido en el historial
      await refresh(s.id);
      expect(notices.of(s.id, 'AV-19')).toHaveLength(1);
      fake.pushEvent(s.psid, 'delivery_attempt', iso(t - H));
      await refresh(s.id);
      expect(notices.of(s.id, 'AV-19')).toHaveLength(2);
      expect((await row(s.id)).status).toBe('guia');
      const ag12 = await h.prisma.spendAlert.findMany({ where: { shipmentRequestId: s.id, kind: 'parcel_problem' } });
      expect(ag12).toHaveLength(2);
      expect(ag12.every((a) => a.severity === 'digest' && a.mailStatus === 'not_applicable')).toBe(true);
    });

    it.each([
      ['exception', 'parcel_problem', 'digest'],
      ['retained', 'parcel_problem', 'digest'],
      ['in_return', 'parcel_returned', 'immediate'],
      ['destroyed', 'parcel_returned', 'immediate'],
    ] as const)('%s ⇒ sin cambio de estado, CERO correos al cliente, carrierAlert con el texto, ?alert=true lo lista; PS-150: %s %s', async (st, kind, severity) => {
      const s = await labeled();
      bandeja = [];
      fake.pushEvent(s.psid, st, iso(clock.now().getTime() - H), { detail: `Detalle ${st}` });
      const r = await refresh(s.id);
      expect(errCode(r)).toBe('200');
      expect(r.body.status).toBe('guia');
      expect(r.body.carrierAlert).toEqual({ status: st, detail: `Detalle ${st}`, at: iso(clock.now().getTime() - 1000 - H) });
      expect(bandeja).toHaveLength(0);
      expect(notices.of(s.id)).toHaveLength(0);
      const list = await h.api('GET', `/admin/shipments?alert=true&pageSize=100&q=${s.id}`, { token: db.opToken });
      expect(list.body.data.map((x: any) => x.id)).toContain(s.id);
      const alerts = await h.prisma.spendAlert.findMany({ where: { shipmentRequestId: s.id } });
      expect(alerts).toEqual([
        expect.objectContaining({
          kind,
          severity,
          dedupKey: `ag${kind === 'parcel_returned' ? 11 : 12}:${s.id}:${st}`,
          // AG-11 con correo al dueño (`HECHOS.md:62`): queda `pending` para el despachador de D2g; AG-12 sin correo.
          mailStatus: severity === 'immediate' ? 'pending' : 'not_applicable',
        }),
      ]);
      expect(Object.keys(alerts[0].facts as object).sort()).toEqual(kind === 'parcel_returned' ? ['carrierName', 'chargedCents', 'status'] : ['carrierName', 'status']);
      // La alerta se apaga sola con un estado posterior que no está en la lista.
      fake.pushEvent(s.psid, 'in_transit', iso(clock.now().getTime()));
      const r2 = await refresh(s.id);
      expect(r2.body.carrierAlert).toBeNull();
    });

    it('canceled SIN providerCanceledAt (lo canceló la paquetería) ⇒ carrierAlert; CON providerCanceledAt ⇒ nada', async () => {
      const s = await labeled();
      fake.pushEvent(s.psid, 'canceled', iso(clock.now().getTime() - H));
      const r = await refresh(s.id);
      expect(r.body.carrierAlert).toEqual(expect.objectContaining({ status: 'canceled' }));
      expect(r.body.status).toBe('guia');
      const s2 = await labeled();
      await h.prisma.shipmentRequest.update({ where: { id: s2.id }, data: { providerCanceledAt: clock.now(), providerCancelReason: 'reissue' } });
      const now = clock.now();
      const res = await carrier.applyCarrierStatus(s2.id, { status: 'canceled', occurredAt: now, observedAt: now, providerEventKey: 'canceled', synthetic: true });
      expect(res.applied).toBe(true);
      const d = await h.api('GET', `/admin/shipments/${s2.id}`, { token: db.opToken });
      expect(d.body.carrierAlert).toBeNull();
      expect(d.body.status).toBe('guia');
    });

    it('guía MANUAL ⇒ applied:false, cero escrituras; el sondeo no la selecciona (0 llamadas al doble)', async () => {
      const m = await db.mkDirect();
      await ready(db, m.shipment.id);
      expect((await db.tracking(m.shipment.id)).status).toBe(201);
      const before = await row(m.shipment.id);
      const now = clock.now();
      const res = await carrier.applyCarrierStatus(m.shipment.id, { status: 'delivered', occurredAt: now, observedAt: now, providerEventKey: 'delivered', synthetic: true });
      expect(res).toEqual(expect.objectContaining({ applied: false, reason: 'not_provider' }));
      expect(await row(m.shipment.id)).toEqual(before);
      expect(await events(m.shipment.id)).toHaveLength(0);
      // El lote: con todas las guías de Skydropx recién sondeadas, el job no llama al doble (la manual no es elegible).
      await h.prisma.shipmentRequest.updateMany({ where: { labelSource: 'skydropx' }, data: { carrierPolledAt: clock.now() } });
      fake.calls.length = 0;
      const r = await job('shipment-tracking-poll');
      expect(errCode(r)).toBe('200');
      expect(r.body.polled).toBe(0);
      expect(fake.callsOf('getShipment')).toHaveLength(0);
      expect(errCode(await refresh(m.shipment.id))).toBe('200');
      expect(fake.callsOf('getShipment')).toHaveLength(0);
    });
  });

  describe('PS-79 — `delivered` sin `enviado` previo (el sondeo perdió eventos)', () => {
    it('desde guia ⇒ enviado y entregado en la MISMA tx; AV-5 y AV-17 una vez cada uno; piezas terminales', async () => {
      const s = await labeled();
      bandeja = [];
      fake.pushEvent(s.psid, 'delivered', iso(clock.now().getTime() - H));
      await refresh(s.id);
      await refresh(s.id);
      const r = await row(s.id);
      expect(r.status).toBe('entregado');
      expect(r.shippedAt).not.toBeNull();
      expect(mailsTo(s.to, AV5)).toHaveLength(1);
      expect(notices.of(s.id, 'AV-17')).toHaveLength(1);
      const pieces = await h.prisma.inventoryItem.findMany({ where: { id: { in: s.d.pieces.map((p) => p.id) } }, select: { status: true } });
      expect(pieces.map((p) => p.status)).toEqual(['delivered', 'delivered']);
      const [ce] = await audits(s.id, 'shipment.carrier_event');
      expect(ce.after).toEqual(expect.objectContaining({ status: 'delivered', transition: 'entregado', actor: 'system:carrier-poll' }));
    });

    it('retiro de bóveda: delivered ⇒ `withdrawn` SOLO las `in_custody` del cliente (una `lost` se queda `lost`)', async () => {
      const cust = await db.mkUser('Cliente Retiro D2d');
      const v = await db.mkVaultOrder(cust.id, { placement: 'placed' });
      const w = await db.mkWithdrawal(cust.id, v.pieces.map((p) => p.id), 'picking');
      await ready(db, w.shipment.id);
      const q = await quote(w.shipment.id);
      expect(q.status).toBe(200);
      expect(errCode(await buy(w.shipment.id, buyBody(q.body, pickRate(q.body))))).toBe('200');
      const psid = (await row(w.shipment.id)).providerShipmentId as string;
      await h.prisma.inventoryItem.update({ where: { id: v.pieces[1].id }, data: { status: 'lost' } });
      fake.pushEvent(psid, 'delivered', iso(clock.now().getTime() - H));
      await refresh(w.shipment.id);
      expect((await row(w.shipment.id)).status).toBe('entregado');
      const pieces = await h.prisma.inventoryItem.findMany({ where: { id: { in: v.pieces.map((p) => p.id) } }, select: { id: true, status: true } });
      expect(Object.fromEntries(pieces.map((p) => [p.id, p.status]))).toEqual({ [v.pieces[0].id]: 'withdrawn', [v.pieces[1].id]: 'lost' });
    });
  });

  // ================================================================ refresh-tracking, labelUrl, estado desconocido, off

  describe('`refresh-tracking`, relleno de `labelUrl`, estado desconocido y el proveedor apagado', () => {
    it('cliente ⇒ 403; operador ⇒ 200 con el AdminShipmentDTO (carrierAlert, labelOptions); con `off` ⇒ 404 FEATURE_DISABLED y cero llamadas', async () => {
      const s = await labeled();
      expect((await refresh(s.id, customerToken)).status).toBe(403);
      const r = await refresh(s.id);
      expect(errCode(r)).toBe('200');
      expect(r.body).toEqual(expect.objectContaining({ id: s.id, carrierAlert: null, labelOptions: expect.any(Object) }));
      expect(JSON.stringify(r.body)).not.toMatch(/labelUrl/);
      await dial(h, 'shipping_provider', 'off');
      fake.calls.length = 0;
      expect(errCode(await refresh(s.id))).toBe('404:FEATURE_DISABLED');
      for (const name of ['shipment-tracking-poll', 'shipment-label-processing', 'shipment-extra-charges']) {
        const j = await job(name);
        expect(errCode(j)).toBe('200');
        expect(j.body.skipped).toBe('provider_off');
      }
      expect(fake.calls).toHaveLength(0);
      // SEC-SDX-12: «Salida de hoy» sigue con `off` (no toca la red).
      expect(errCode(await h.api('GET', '/admin/shipments/departure', { token: db.opToken }))).toBe('200');
      expect(errCode(await h.api('POST', `/admin/jobs/shipment-tracking-poll`, { token: db.opToken, json: {} }))).toBe('403:FORBIDDEN');
    });

    it('§19.19.9: guía nacida SIN labelUrl (host no admitido) ⇒ bitácora del rechazo UNA vez; el sondeo la RELLENA cuando la lectura trae una válida', async () => {
      fake.defaultLabelUrl = 'https://cdn.not-allowed.example/l.pdf';
      try {
        const s = await labeled();
        expect(s.row.labelUrl).toBeNull();
        await refresh(s.id);
        await refresh(s.id);
        const rej = await audits(s.id, 'shipment.provider_url_rejected');
        expect(rej.map((a) => (a.after as any).host)).toEqual(['cdn.not-allowed.example']);
        fake.setShipment(s.psid, { rawLabelUrl: 'https://pro.skydropx.com/labels/late.pdf' });
        const r = await refresh(s.id);
        expect((await row(s.id)).labelUrl).toBe('https://pro.skydropx.com/labels/late.pdf');
        expect(r.body.label.labelAvailable).toBe(true);
      } finally {
        fake.defaultLabelUrl = 'https://pro.skydropx.com/labels/x.pdf';
      }
    });

    // ⭐ D2e (§19.33.2): el desconocido se aplica COMO `exception` (antes: «evento no aplicado»). PS-78 ampliada entera en
    // `sdx-d2e-notices.e2e-spec.ts`; aquí queda la mitad de D2d (bitácora una vez, ⛔ nunca un 500, sin cambio de estado).
    it('§19.19.10 + §19.33.2: estado DESCONOCIDO ⇒ UNA fila `exception`, bitácora `carrier_status_unknown` una vez, ⛔ nunca un 500', async () => {
      const s = await labeled();
      fake.setShipment(s.psid, { carrierStatus: null, unknownCarrierStatus: 'teleported', events: [{ status: null, rawStatus: 'teleported', occurredAt: iso(clock.now().getTime()) }] });
      expect(errCode(await refresh(s.id))).toBe('200');
      expect(errCode(await refresh(s.id))).toBe('200');
      expect((await events(s.id)).map((e) => [e.status, e.detail])).toEqual([['exception', 'Estado no reconocido: teleported']]);
      expect((await audits(s.id, 'shipment.carrier_status_unknown')).map((a) => (a.after as any).value)).toEqual(['teleported']);
      expect((await row(s.id)).status).toBe('guia');
    });

    it('el lote del job: toma las guías vivas no sondeadas (más viejas primero) y omite las recién sondeadas', async () => {
      const a = await labeled();
      const b = await labeled();
      await h.prisma.shipmentRequest.updateMany({ where: { labelSource: 'skydropx', id: { notIn: [a.id, b.id] } }, data: { carrierPolledAt: clock.now() } });
      fake.pushEvent(a.psid, 'picked_up', iso(clock.now().getTime() - H));
      fake.calls.length = 0;
      const r = await job('shipment-tracking-poll');
      expect(errCode(r)).toBe('200');
      expect(r.body).toEqual(expect.objectContaining({ polled: 2, errors: 0 }));
      expect(fake.callsOf('getShipment').map((c) => c.input).sort()).toEqual([a.psid, b.psid].sort());
      expect((await row(a.id)).status).toBe('enviado');
      fake.calls.length = 0;
      const r2 = await job('shipment-tracking-poll');
      expect(r2.body.polled).toBe(0);
      // `{shipmentId}` refresca UNO aunque esté recién sondeado.
      const r3 = await job('shipment-tracking-poll', { shipmentId: b.id });
      expect(r3.body.polled).toBe(1);
      expect(errCode(await job('shipment-tracking-poll', { shipmentId: 'no-uuid' }))).toBe('400:VALIDATION_ERROR');
    });
  });
});
