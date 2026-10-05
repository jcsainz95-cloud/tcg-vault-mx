/**
 * sdx-d2d-orphans.e2e-spec.ts — 💰🔒 D2d: la conciliación de guías pagadas que NO son la del paquete (API_CONTRACT §19.28.6
 * con §19.29.1.5 (C-14), §19.30.6 (C-19), §19.29.6 AG-9 (b)(c)(d)) contra Postgres REAL, app completa, proveedor DOBLE (⛔
 * nunca la red: PS-99). Propiedad: backend.
 *
 * PS-130 (ampliada por C-14 y C-19): control positivo (huérfana tardía de un intento anterior, guía vigente de Skydropx con
 * otro id, rastreo ajeno, sin movimiento ⇒ `cancel` UNA vez y AG-9 🟡); (a) «Liberar» + captura a mano con el rastreo de
 * la huérfana ⇒ 0 `cancel` y AG-9 🔴; (b) ilegible / sin rastreo / guía vigente manual ⇒ 0 `cancel`; (c) fusible: con 3
 * intenciones en 24 h la 4.ª ⇒ 0 `cancel`, `orphan_cancel_fused`, AG-9 `orphan_fuse` una vez por día; (d) C-19: envío
 * `cancelado` con guía manual «1Z-999-AA1» y la huérfana con «1Z999AA1» en tránsito ⇒ 0 `cancel` (y con rastreos distintos
 * pero en tránsito, también 0); (e) C-19: `cancel` con resultado DESCONOCIDO (timeout) ×3 ⇒ la 4.ª no se cancela y cada una
 * deja AG-9 `orphan_cancel_unknown`.
 *
 * Cada prueba corre con el reloj en un día futuro propio: el fusible cuenta intenciones de las últimas 24 h de TODA la base.
 */
import { E2EHarness } from './helpers/e2e-app';
import { R, ShipPrepDb } from './helpers/ship-prep-db';
import { buyBody, createLabelWorld, dial, errCode, purchaseOn, ready, restoreDials } from './helpers/label-db';
import { FakeShippingProvider } from '../../src/modules/shipping-provider/fake-shipping-provider';
import { ShippingProviderError } from '../../src/modules/shipping-provider/shipping-provider.errors';
import { ManualLabelClock } from '../../src/modules/shipments/label-clock';
import { LabelVerifyConfig } from '../../src/modules/shipments/label-verify.constants';
import { ShipmentLabelProcessingJob } from '../../src/modules/shipments/label-processing.job';
import { dayMx } from '../../src/modules/spend-alerts/spend-alerts.service';

const RUN = `d2do${Date.now().toString(36)}`;
const MIN = 60_000;
const H = 60 * MIN;
const D = 24 * H;
const NOTE = 'Lo comprobé en el panel de Skydropx: no hay envío con esta referencia.';

describe('💰🔒 D2d — conciliación de huérfanas con C-14 + C-19 y fusible (PS-130)', () => {
  let h: E2EHarness;
  let db: ShipPrepDb;
  let fake: FakeShippingProvider;
  let clock: ManualLabelClock;
  let cfg: LabelVerifyConfig;
  let jobSvc: ShipmentLabelProcessingJob;
  let dayN = 900;

  const quote = (id: string): Promise<R> => h.api('POST', `/admin/shipments/${id}/quote`, { token: db.opToken, json: {} });
  const buy = (id: string, json: unknown): Promise<R> => {
    clock.advance(1);
    return h.api('POST', `/admin/shipments/${id}/label`, { token: db.opToken, json });
  };
  const row = (id: string) => h.prisma.shipmentRequest.findUniqueOrThrow({ where: { id } });
  const audits = (id: string, action: string) => h.prisma.auditLog.findMany({ where: { entityId: id, action }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  const pickRate = (q: any) => q.rates.find((r: any) => r.deliveryKind !== 'branch' && r.marginCents >= 0 && !r.hidden) ?? q.rates[0];
  const capture = (id: string, carrier: string, trackingNumber: string): Promise<R> =>
    h.api('POST', `/admin/shipments/${id}/tracking`, { token: db.opToken, json: { carrier, trackingNumber } });
  const cancels = () => fake.callsOf('cancel').map((c) => (c.input as any).providerShipmentId as string);
  const ag9 = (y: string) => h.prisma.spendAlert.findUnique({ where: { dedupKey: `ag9:o:${y}` } });
  const newDay = () => {
    dayN += 3;
    clock.set(new Date(Date.now() + dayN * D));
  };

  /** Envío directo con guía de Skydropx viva (psid A) y su intento. */
  const labeled = async () => {
    const d = await db.mkDirect({ prices: [50000, 30000] });
    await ready(db, d.shipment.id);
    const q = await quote(d.shipment.id);
    expect(q.status).toBe(200);
    expect(errCode(await buy(d.shipment.id, buyBody(q.body, pickRate(q.body))))).toBe('200');
    const s = await row(d.shipment.id);
    const att = await h.prisma.shipmentLabelAttempt.findFirstOrThrow({ where: { shipmentRequestId: s.id }, orderBy: { since: 'desc' } });
    return { id: s.id, psid: s.providerShipmentId as string, row: s, attempt: att };
  };
  /** Una huérfana Y de S (fila del libro `origin:'orphan'` atribuida al intento) que el doble lee con `state`. */
  const orphanOf = async (s: { id: string; attempt: { id: string; expectedChargeCents: number } }, state: Record<string, unknown> = {}, opts: { readable?: boolean } = {}) => {
    const y = `orph-${RUN}-${Math.random().toString(36).slice(2, 8)}`;
    if (opts.readable !== false) {
      fake.addListed(
        { providerShipmentId: y, createdAt: clock.now().toISOString(), carrierName: 'x', totalCents: null, postalCodeTo: null, source: 'api', hasError: false, providerReference: null },
        { trackingNumber: `ORPH${Math.random().toString(36).slice(2, 8).toUpperCase()}`, carrierStatus: 'created', ...state },
      );
    }
    await h.prisma.shipmentPaidLabel.create({ data: { providerShipmentId: y, shipmentRequestId: s.id, attemptId: s.attempt.id, origin: 'orphan', chargedCents: s.attempt.expectedChargeCents } });
    return y;
  };

  beforeAll(async () => {
    ({ h, db, fake, clock, cfg } = await createLabelWorld(RUN));
    await purchaseOn(h, 'operators');
    await dial(h, 'operator_label_cap_24h_cents', 1_000_000_000);
    jobSvc = h.app.get(ShipmentLabelProcessingJob);
  });

  afterAll(async () => {
    await h.prisma.spendAlert.deleteMany({ where: { OR: [{ shipmentRequestId: { in: db.shipments } }, { subjectUserId: { in: [db.operatorId, db.adminId] } }, { dedupKey: { startsWith: 'ag7:' } }, { dedupKey: { startsWith: 'ag9:fuse:' } }] } });
    await restoreDials(h);
    await db.cleanup();
    await h?.close();
  });

  beforeEach(async () => {
    fake.calls.length = 0;
    fake.purchaseOutcomes.length = 0;
    fake.cancelOutcomes.length = 0;
    fake.recentExtra.length = 0;
    fake.createdShipments.length = 0;
    fake.recentOverride = null;
    fake.balanceCents = 10_000_000;
    fake.forgetQuotations();
    cfg.adoptionEnabled = false;
    newDay();
  });

  afterEach(async () => {
    await h.prisma.shipmentRequest.updateMany({
      where: { id: { in: db.shipments }, labelProcessingSince: { not: null }, providerShipmentId: null },
      data: { labelProcessingSince: null, providerRateId: null },
    });
  });

  it('control positivo (flujo REAL): intento 01 en vuelo que Skydropx sí creó, «Liberar», intento 02 con guía ⇒ la huérfana TARDÍA se detecta en el listado y se cancela sola UNA vez (AG-9 🟡)', async () => {
    const d = await db.mkDirect({ prices: [50000, 30000] });
    await ready(db, d.shipment.id);
    const q = await quote(d.shipment.id);
    fake.purchaseOutcomes.push({ kind: 'in_flight', created: true });
    expect((await buy(d.shipment.id, buyBody(q.body, pickRate(q.body)))).body.outcome).toBe('in_flight');
    const since = (await row(d.shipment.id)).labelProcessingSince as Date;
    const y = fake.createdShipments[0];
    expect(y.providerReference).toMatch(/-01$/);
    // «Liberar» sin verificar (la adopción está apagada en las pruebas) y la segunda compra.
    fake.recentOverride = () => ({ readable: true, coversFrom: true, shipments: [] });
    clock.set(new Date(since.getTime() + 16 * MIN));
    expect((await h.api('POST', `/admin/shipments/${d.shipment.id}/label/release`, { token: db.adminToken, json: { note: NOTE } })).body.outcome).toBe('released');
    fake.recentOverride = null;
    const q2 = await quote(d.shipment.id);
    expect(errCode(await buy(d.shipment.id, buyBody(q2.body, pickRate(q2.body))))).toBe('200');
    const s = await row(d.shipment.id);
    expect(s.providerShipmentId).not.toBe(y.providerShipmentId);
    // El job, dentro de la calibración (minutos 1…5 tras la compra), lee el listado y ve Y con el folio del intento 01.
    clock.advance(2 * MIN);
    fake.calls.length = 0;
    const r = await jobSvc.run();
    expect(r.orphans.late).toBe(1);
    expect(r.orphans.cancelled).toBe(1);
    expect(cancels()).toEqual([y.providerShipmentId]);
    const [lo] = await audits(d.shipment.id, 'shipment.label_orphan');
    expect(lo.after).toEqual(expect.objectContaining({ cause: 'late', providerShipmentId: y.providerShipmentId, providerReference: y.providerReference }));
    const paid = await h.prisma.shipmentPaidLabel.findUniqueOrThrow({ where: { providerShipmentId: y.providerShipmentId } });
    expect(paid).toEqual(expect.objectContaining({ origin: 'orphan', cancelKind: 'orphan_auto', cancelledByUserId: null }));
    expect(paid.autoCancelIntentAt).not.toBeNull();
    expect(paid.cancelledAt).not.toBeNull();
    expect((await audits(d.shipment.id, 'shipment.orphan_cancel_intent')).length).toBe(1);
    expect((await audits(d.shipment.id, 'shipment.label_orphan_cancelled'))[0].after).toEqual(expect.objectContaining({ actor: 'system:label-verify' }));
    expect(await ag9(y.providerShipmentId)).toEqual(expect.objectContaining({ severity: 'digest', facts: expect.objectContaining({ cause: 'orphan_auto_cancelled', providerReference: y.providerReference }) }));
    // La guía vigente del paquete NO se toca; otra corrida no repite nada.
    expect((await row(d.shipment.id)).providerCanceledAt).toBeNull();
    await jobSvc.run();
    expect(cancels()).toEqual([y.providerShipmentId]);
    expect(fake.callsOf('purchase')).toHaveLength(0);
  });

  it('(a) C-14: «Liberar» y CAPTURA A MANO con el rastreo que la huérfana trae ⇒ 0 cancel, AG-9 🔴 y la alerta `label_orphan` en el DTO', async () => {
    const d = await db.mkDirect({ prices: [50000, 30000] });
    await ready(db, d.shipment.id);
    const q = await quote(d.shipment.id);
    fake.purchaseOutcomes.push({ kind: 'in_flight', created: true, trackingNumber: `TNA${RUN}` });
    await buy(d.shipment.id, buyBody(q.body, pickRate(q.body)));
    const since = (await row(d.shipment.id)).labelProcessingSince as Date;
    const y = fake.createdShipments[0];
    fake.recentOverride = () => ({ readable: true, coversFrom: true, shipments: [] });
    clock.set(new Date(since.getTime() + 16 * MIN));
    await h.api('POST', `/admin/shipments/${d.shipment.id}/label/release`, { token: db.adminToken, json: { note: NOTE } });
    expect((await capture(d.shipment.id, 'Paquetexpress', `TNA${RUN}`)).status).toBe(201);
    fake.recentOverride = null;
    // Otro envío en vuelo hace que el job lea el listado (sin peticiones nuevas solo para huérfanas).
    const o = await db.mkDirect({ prices: [50000, 30000] });
    await ready(db, o.shipment.id);
    const qo = await quote(o.shipment.id);
    fake.purchaseOutcomes.push({ kind: 'in_flight', created: false });
    await buy(o.shipment.id, buyBody(qo.body, pickRate(qo.body)));
    clock.advance(cfg.purchaseMaxLifeMs + MIN);
    fake.calls.length = 0;
    const r = await jobSvc.run();
    expect(r.orphans.late).toBe(1);
    expect(cancels()).toEqual([]);
    expect(await ag9(y.providerShipmentId)).toEqual(expect.objectContaining({ severity: 'immediate', facts: expect.objectContaining({ cause: 'orphan' }) }));
    const dto = await h.api('GET', `/admin/shipments/${d.shipment.id}`, { token: db.opToken });
    expect(dto.body.labelAlert).toEqual(expect.objectContaining({ kind: 'label_orphan' }));
  });

  it.each<[string, (s: Awaited<ReturnType<typeof labeled>>) => Promise<string>]>([
    ['getShipment(Y) ilegible', (s) => orphanOf(s, {}, { readable: false })],
    ['Y sin número de rastreo', (s) => orphanOf(s, { trackingNumber: null })],
    ['Y con un estado DESCONOCIDO (cuenta como movimiento)', (s) => orphanOf(s, { carrierStatus: null, unknownCarrierStatus: 'teleported' })],
    ['la guía vigente de S es MANUAL', async (s) => {
      const m = await db.mkDirect({ prices: [50000, 30000] });
      await ready(db, m.shipment.id);
      expect((await db.tracking(m.shipment.id)).status).toBe(201);
      const att = await h.prisma.shipmentLabelAttempt.create({ data: { shipmentRequestId: m.shipment.id, since: new Date(clock.now().getTime() - D), actorUserId: db.operatorId, capExempt: false, rateId: 'r', carrierName: 'x', expectedChargeCents: 5000, marginCents: 0, outcome: 'released_unverified', outcomeAt: clock.now() } });
      return orphanOf({ id: m.shipment.id, attempt: att });
    }],
  ])('(b) %s ⇒ 0 cancel y AG-9 🔴 (falla cerrado)', async (_n, make) => {
    const s = await labeled();
    const y = await make(s);
    fake.calls.length = 0;
    await jobSvc.run();
    expect(cancels()).toEqual([]);
    expect(await ag9(y)).toEqual(expect.objectContaining({ severity: 'immediate', facts: expect.objectContaining({ cause: 'orphan' }) }));
    const paid = await h.prisma.shipmentPaidLabel.findUniqueOrThrow({ where: { providerShipmentId: y } });
    expect(paid.autoCancelIntentAt).toBeNull();
    // Evaluada una vez: la corrida siguiente no la vuelve a leer.
    fake.calls.length = 0;
    await jobSvc.run();
    expect(fake.callsOf('getShipment').map((c) => c.input)).not.toContain(y);
  });

  it('(c) fusible: 3 intenciones en 24 h ⇒ la 4.ª NO se cancela; `orphan_cancel_fused` y AG-9 `orphan_fuse` UNA vez por día MX', async () => {
    const s = await labeled();
    const ys = [await orphanOf(s), await orphanOf(s), await orphanOf(s)];
    await jobSvc.run();
    expect(cancels().sort()).toEqual([...ys].sort());
    const y4 = await orphanOf(s);
    const y5 = await orphanOf(s);
    fake.calls.length = 0;
    const r = await jobSvc.run();
    expect(r.orphans.fused).toBe(2);
    expect(cancels()).toEqual([]);
    expect((await audits(s.id, 'shipment.orphan_cancel_fused')).map((a) => (a.after as any).providerShipmentId).sort()).toEqual([y4, y5].sort());
    const fuse = await h.prisma.spendAlert.findUniqueOrThrow({ where: { dedupKey: `ag9:fuse:${dayMx(clock.now())}` } });
    expect(fuse).toEqual(expect.objectContaining({ severity: 'immediate', facts: expect.objectContaining({ cause: 'orphan_fuse' }) }));
    expect(fuse.occurrenceCount).toBe(2); // una FILA por día (las repeticiones suben el contador)
    for (const y of [y4, y5]) expect((await h.prisma.shipmentPaidLabel.findUniqueOrThrow({ where: { providerShipmentId: y } })).autoCancelIntentAt).toBeNull();
    // Pasadas 24 h el fusible se rearma (las intenciones viejas ya no cuentan) — pero y4/y5 ya están evaluadas (AG-9).
    clock.advance(25 * H);
    const y6 = await orphanOf(s);
    fake.calls.length = 0;
    await jobSvc.run();
    expect(cancels()).toEqual([y6]);
  });

  it('(d) C-19: S `cancelado` con guía MANUAL «1Z-999-AA1» y la huérfana con «1Z999AA1» en tránsito ⇒ 0 cancel y AG-9 🔴; con rastreos distintos pero en tránsito ⇒ 0 cancel', async () => {
    const m = await db.mkDirect({ prices: [50000, 30000] });
    await ready(db, m.shipment.id);
    expect((await capture(m.shipment.id, 'DHL', '1Z-999-AA1')).status).toBe(201);
    await h.prisma.shipmentRequest.update({ where: { id: m.shipment.id }, data: { status: 'cancelado' } });
    const att = await h.prisma.shipmentLabelAttempt.create({ data: { shipmentRequestId: m.shipment.id, since: new Date(clock.now().getTime() - D), actorUserId: db.operatorId, capExempt: false, rateId: 'r', carrierName: 'x', expectedChargeCents: 5000, marginCents: 0, outcome: 'released_unverified', outcomeAt: clock.now() } });
    const y1 = await orphanOf({ id: m.shipment.id, attempt: att }, { trackingNumber: '1Z999AA1', carrierStatus: 'in_transit' });
    const y2 = await orphanOf({ id: m.shipment.id, attempt: att }, { trackingNumber: 'OTRO123', carrierStatus: 'in_transit' });
    // Y la mutación de (c) sola: mismo rastreo normalizado SIN movimiento ⇒ también 0 (la regla (c) por sí misma).
    const y3 = await orphanOf({ id: m.shipment.id, attempt: att }, { trackingNumber: '1z 999 aa1', carrierStatus: 'created' });
    await jobSvc.run();
    expect(cancels()).toEqual([]);
    for (const y of [y1, y2, y3]) expect(await ag9(y)).toEqual(expect.objectContaining({ severity: 'immediate' }));
  });

  it('(e) C-19: `cancel` con resultado DESCONOCIDO ×3 ⇒ la 4.ª NO se cancela (fusible por intenciones) y cada una deja AG-9 `orphan_cancel_unknown`', async () => {
    const s = await labeled();
    for (let i = 0; i < 3; i += 1) fake.cancelOutcomes.push({ throws: ShippingProviderError.busy('cancel') });
    const ys = [await orphanOf(s), await orphanOf(s), await orphanOf(s)];
    const r = await jobSvc.run();
    expect(r.orphans.cancelUnknown).toBe(3);
    for (const y of ys) {
      expect(await ag9(y)).toEqual(expect.objectContaining({ severity: 'immediate', facts: expect.objectContaining({ cause: 'orphan_cancel_unknown' }) }));
      const paid = await h.prisma.shipmentPaidLabel.findUniqueOrThrow({ where: { providerShipmentId: y } });
      expect(paid.autoCancelIntentAt).not.toBeNull();
      expect(paid.cancelledAt).toBeNull();
    }
    const y4 = await orphanOf(s);
    fake.calls.length = 0;
    await jobSvc.run();
    expect(cancels()).toEqual([]);
    expect(await audits(s.id, 'shipment.orphan_cancel_fused')).toHaveLength(1);
    expect((await h.prisma.shipmentPaidLabel.findUniqueOrThrow({ where: { providerShipmentId: y4 } })).autoCancelIntentAt).toBeNull();
    // Una intención sin `cancelledAt` ⛔ no se reintenta sola.
    clock.advance(25 * H);
    fake.calls.length = 0;
    await jobSvc.run();
    expect(cancels()).toEqual([]);
  });
});
