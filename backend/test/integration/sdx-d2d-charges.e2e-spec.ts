/**
 * sdx-d2d-charges.e2e-spec.ts — 💰 D2d: el job `shipment-extra-charges` (API_CONTRACT §19.10, §19.11, criterio 238) y AG-6
 * (§19.29.6, S-GAS-4) contra Postgres REAL, app completa, proveedor DOBLE (⛔ nunca la red: PS-99); y el CABLEADO de los
 * tres jobs (el planificador los recibe del `ShipmentsModule` real; `POST /admin/jobs/*` solo súper-admin). Propiedad: backend.
 *
 * PS-80: 3 cargos (2 nuestros — uno de una guía ya CANCELADA, del libro —, 1 ajeno) ⇒ 2 `ShipmentCostAdjustment` con su
 * `kind`, `ivaCents = round(amount × 16/116)`, `chargedAt` del cargo; 10 corridas ⇒ 2 filas; `shippingCostCents` intacto.
 * PS-144: 10000 ⇒ 🟡; 15001 ⇒ 🔴; 15000 ⇒ 🟡 (umbral estricto); releer el mismo cargo ⇒ ningún aviso nuevo; un ajuste
 * `cancel:` ⇒ ningún AG-6. (El P&L del mes de `chargedAt` es de D2f: §19.31.10 fila 3b.)
 */
import { E2EHarness } from './helpers/e2e-app';
import { R, ShipPrepDb } from './helpers/ship-prep-db';
import { buyBody, createLabelWorld, dial, errCode, purchaseOn, ready, restoreDials } from './helpers/label-db';
import { FakeShippingProvider } from '../../src/modules/shipping-provider/fake-shipping-provider';
import { ProviderExtraCharge } from '../../src/modules/shipping-provider/shipping-provider.port';
import { ManualLabelClock } from '../../src/modules/shipments/label-clock';
import { SchedulerService } from '../../src/jobs/scheduler.service';
import { ShipmentTrackingPollJob } from '../../src/modules/shipments/tracking-poll.job';
import { ShipmentLabelProcessingJob } from '../../src/modules/shipments/label-processing.job';
import { ShipmentExtraChargesJob } from '../../src/modules/shipments/extra-charges.job';

const RUN = `d2dc${Date.now().toString(36)}`;

describe('💰 D2d — cargos extra y AG-6 (§19.10, PS-80, PS-144); cableado de los jobs', () => {
  let h: E2EHarness;
  let db: ShipPrepDb;
  let fake: FakeShippingProvider;
  let clock: ManualLabelClock;

  const quote = (id: string): Promise<R> => h.api('POST', `/admin/shipments/${id}/quote`, { token: db.opToken, json: {} });
  const buy = (id: string, json: unknown): Promise<R> => {
    clock.advance(1);
    return h.api('POST', `/admin/shipments/${id}/label`, { token: db.opToken, json });
  };
  const job = (token = db.adminToken): Promise<R> => h.api('POST', '/admin/jobs/shipment-extra-charges', { token, json: {} });
  const row = (id: string) => h.prisma.shipmentRequest.findUniqueOrThrow({ where: { id } });
  const pickRate = (q: any) => q.rates.find((r: any) => r.deliveryKind !== 'branch' && r.marginCents >= 0 && !r.hidden) ?? q.rates[0];
  const charge = (over: Partial<ProviderExtraCharge>): ProviderExtraCharge => ({
    providerChargeId: `ch-${RUN}-${Math.random().toString(36).slice(2, 8)}`,
    providerShipmentId: null,
    trackingNumber: null,
    amountCents: 10000,
    chargeType: 'Overweight',
    chargedAt: '2026-08-15T12:00:00Z',
    status: 'paid',
    ...over,
  });
  const labeled = async () => {
    const d = await db.mkDirect({ prices: [50000, 30000] });
    await ready(db, d.shipment.id);
    const q = await quote(d.shipment.id);
    expect(errCode(await buy(d.shipment.id, buyBody(q.body, pickRate(q.body))))).toBe('200');
    const s = await row(d.shipment.id);
    return { id: s.id, psid: s.providerShipmentId as string, row: s };
  };

  beforeAll(async () => {
    ({ h, db, fake, clock } = await createLabelWorld(RUN));
    await purchaseOn(h, 'operators');
    await dial(h, 'operator_label_cap_24h_cents', 1_000_000_000);
    await dial(h, 'spend_alert_extra_charge_immediate_cents', 15000);
  });

  afterAll(async () => {
    await h.prisma.spendAlert.deleteMany({ where: { OR: [{ shipmentRequestId: { in: db.shipments } }, { subjectUserId: { in: [db.operatorId, db.adminId] } }, { dedupKey: { startsWith: 'ag7:' } }] } });
    await h.prisma.shipmentCostAdjustment.deleteMany({ where: { shipmentRequestId: { in: db.shipments } } });
    await restoreDials(h);
    await db.cleanup();
    await h?.close();
  });

  beforeEach(() => {
    fake.calls.length = 0;
    fake.extraChargeList = [];
    fake.forgetQuotations();
    clock.set(new Date());
  });

  it('PS-80: 2 nuestros (uno de una guía ya CANCELADA) + 1 ajeno ⇒ 2 filas con kind, IVA 16/116 y chargedAt del cargo; ×10 ⇒ siguen 2; shippingCostCents intacto', async () => {
    const a = await labeled();
    const b = await labeled();
    // b re-emite: su guía vieja queda SOLO en el libro de guías pagadas (la fila del envío ya no la tiene).
    expect(errCode(await h.api('POST', `/admin/shipments/${b.id}/label/cancel`, { token: db.opToken, json: { reason: 'Re-emitir con otra paquetería' } }))).toBe('200');
    expect((await row(b.id)).providerShipmentId).toBeNull();
    const c1 = charge({ providerShipmentId: a.psid, amountCents: 11600, chargeType: 'ExtraCharge::Overweight' });
    const c2 = charge({ providerShipmentId: b.psid, amountCents: 5800, chargeType: 'ExtendedZone', chargedAt: null });
    const c3 = charge({ providerShipmentId: `ajeno-${RUN}`, amountCents: 9999 });
    fake.extraChargeList = [c1, c2, c3];
    const r1 = await job();
    expect(errCode(r1)).toBe('200');
    expect(r1.body).toEqual(expect.objectContaining({ seen: 3, inserted: 2, duplicates: 0, unmatched: 1, chargedAtFallback: 1 }));
    for (let i = 0; i < 9; i += 1) {
      const r = await job();
      expect(r.body).toEqual(expect.objectContaining({ inserted: 0, duplicates: 2, unmatched: 1 }));
    }
    const adj = await h.prisma.shipmentCostAdjustment.findMany({ where: { providerChargeId: { in: [c1.providerChargeId, c2.providerChargeId, c3.providerChargeId] } }, orderBy: { amountCents: 'desc' } });
    expect(adj.map((x) => [x.shipmentRequestId, x.kind, x.amountCents, x.ivaCents, x.ivaSource])).toEqual([
      [a.id, 'overweight', 11600, 1600, 'computed'],
      [b.id, 'extended_zone', 5800, 800, 'computed'],
    ]);
    expect(adj[0].chargedAt.toISOString()).toBe('2026-08-15T12:00:00.000Z');
    expect(adj[1].chargedAt.getTime()).toBe(adj[1].observedAt.getTime()); // sin fecha del cargo ⇒ `observedAt`
    expect((await row(a.id)).shippingCostCents).toBe(a.row.shippingCostCents);
    expect((await h.prisma.auditLog.findMany({ where: { entityId: a.id, action: 'shipment.cost_adjusted' } })).length).toBe(1);
    // El DTO del operador muestra el ajuste (§19.22.4).
    const dto = await h.api('GET', `/admin/shipments/${a.id}`, { token: db.opToken });
    expect(dto.body.costAdjustments).toEqual([expect.objectContaining({ kind: 'overweight', amountCents: 11600, ivaCents: 1600, netCents: 10000 })]);
  });

  it('PS-144 (AG-6): 10000 ⇒ 🟡; 15001 ⇒ 🔴; 15000 ⇒ 🟡; releer ⇒ ningún aviso nuevo; un ajuste `cancel:` ⇒ ningún AG-6', async () => {
    const a = await labeled();
    const c10 = charge({ providerShipmentId: a.psid, amountCents: 10000 });
    const c15001 = charge({ providerShipmentId: a.psid, amountCents: 15001, chargeType: 'Return' });
    const c15000 = charge({ providerShipmentId: a.psid, amountCents: 15000, chargeType: 'Fuel' });
    const cc = charge({ providerChargeId: `cancel:${a.psid}`, providerShipmentId: a.psid, amountCents: 20000, chargeType: 'Cancellation::NotRefunded' });
    fake.extraChargeList = [c10, c15001, c15000, cc];
    await job();
    await job();
    const alerts = await h.prisma.spendAlert.findMany({ where: { shipmentRequestId: a.id, kind: 'carrier_extra_charge' } });
    const byAmount = Object.fromEntries(alerts.map((x) => [x.amountCents, [x.severity, x.mailStatus, x.occurrenceCount, (x.facts as any).kind]]));
    expect(byAmount).toEqual({
      10000: ['digest', 'not_applicable', 1, 'overweight'],
      15001: ['immediate', 'pending', 1, 'return'],
      15000: ['digest', 'not_applicable', 1, 'other'],
    });
    expect(alerts.every((x) => Object.keys(x.facts as object).sort().join() === 'amountCents,carrierName,kind')).toBe(true);
    const adj = await h.prisma.shipmentCostAdjustment.findMany({ where: { shipmentRequestId: a.id } });
    expect(alerts.map((x) => x.dedupKey).sort()).toEqual(adj.filter((x) => !x.providerChargeId.startsWith('cancel:')).map((x) => `ag6:${x.id}`).sort());
  });

  it('cableado: el planificador recibe los TRES jobs del ShipmentsModule real; `POST /admin/jobs/*` es solo súper-admin y audita', async () => {
    const sched = h.app.get(SchedulerService) as unknown as Record<string, unknown>;
    expect(sched.shipmentTrackingPoll).toBe(h.app.get(ShipmentTrackingPollJob));
    expect(sched.shipmentLabelProcessing).toBe(h.app.get(ShipmentLabelProcessingJob));
    expect(sched.shipmentExtraCharges).toBe(h.app.get(ShipmentExtraChargesJob));
    for (const name of ['shipment-tracking-poll', 'shipment-label-processing', 'shipment-extra-charges']) {
      expect(errCode(await h.api('POST', `/admin/jobs/${name}`, { token: db.opToken, json: {} }))).toBe('403:FORBIDDEN');
      const ok = await h.api('POST', `/admin/jobs/${name}`, { token: db.adminToken, json: {} });
      expect(errCode(ok)).toBe('200');
      const log = await h.prisma.auditLog.findFirst({ where: { action: `jobs.${name.replace(/-/g, '_')}.run`, actorUserId: db.adminId }, orderBy: { createdAt: 'desc' } });
      expect(log).toEqual(expect.objectContaining({ entityType: 'Job', entityId: name }));
    }
    expect(fake.callsOf('purchase')).toHaveLength(0);
  });
});
