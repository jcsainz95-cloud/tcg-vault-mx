/**
 * sdx-d2f-money.e2e-spec.ts — 💰 D2f «Dinero y tablero» contra Postgres REAL, app Nest completa por HTTP, proveedor DOBLE
 * (⛔ nunca la red: PS-99), llave de compra SUSTITUIDA. Propiedad: backend.
 *
 * Cubre (API_CONTRACT §19.11, §19.13, §19.19.6, §19.20.3, §19.22.3, §19.29.9, §19.30.8 S-GAS-3, §19.31.10 fila 3b, §19.33.6):
 *  - PS-80 (P&L): el ajuste cuenta en el mes de su `chargedAt` (≠ mes del envío), en `shippingCostCents` y aparte en
 *    `shippingAdjustmentsCents`; el mes del envío NO cambia.
 *  - PS-81 (P&L): guía Skydropx 7625 (IVA 690, seguro 2500) ⇒ neto 6935, `shippingInsuranceCents` 2500, y no cuenta en
 *    `shippingCostMissingCount`; una guía manual sin costo sí.
 *  - PS-90 (tablero/saldo): `workQueue.shipping.lowBalance` con saldo 40000 y umbral 50000, UNA llamada al doble por dos
 *    cargas (caché de 5 min); el operador recibe `lowBalance` sin `balanceCents`; `off` ⇒ `null` y cero llamadas;
 *    `GET /admin/shipping/balance` súper-admin, en vivo, `no-store`, `observeBalance` (AG-7); operador ⇒ 403.
 *  - PS-171: `withCarrierAlert` = filas de `GET /admin/shipments` con `carrierAlert ≠ null` (cada `CarrierStatus`, entregado con
 *    exception, cancelado con delivery_attempt, `canceled` con `providerCanceledAt`, estado desconocido como exception).
 *  - `workQueue.spendControl` (súper-admin; `null` al operador) y S-GAS-3 con el MISMO número.
 *  - PS-110 + §19.22.3: empaques (`GET` operador+, `PUT` súper-admin con bitácora antes/después y la misma forma).
 *  - §19.19.6 + §19.22.3: catálogos (forma nueva) y búsqueda de Carta Porte con `hasMore`.
 */
import { E2EHarness } from './helpers/e2e-app';
import { ShipPrepDb } from './helpers/ship-prep-db';
import { buyBody, createLabelWorld, dial, errCode, purchaseOn, ready, restoreDials } from './helpers/label-db';
import { FakeShippingProvider } from '../../src/modules/shipping-provider/fake-shipping-provider';
import { CARRIER_STATUSES, ProviderExtraCharge } from '../../src/modules/shipping-provider/shipping-provider.port';
import { ManualLabelClock } from '../../src/modules/shipments/label-clock';
import { ShippingProviderError } from '../../src/modules/shipping-provider/shipping-provider.errors';
import { ProviderBalanceService } from '../../src/modules/spend-alerts/provider-balance.service';
import { isOwnerAccount, OWNER_SELECT } from '../../src/modules/spend-alerts/owner';
import { labelSpend24h } from '../../src/modules/shipments/label-spend';
import { CarrierStatus, ShippingPackage, SpendAlertKind, SpendAlertSeverity } from '@prisma/client';

const RUN = `d2f${Date.now().toString(36)}`;
const H = 3_600_000;

describe('💰 D2f — dinero y tablero (§19.11, §19.13, §19.29.9, §19.33.6)', () => {
  let h: E2EHarness;
  let db: ShipPrepDb;
  let fake: FakeShippingProvider;
  let clock: ManualLabelClock;
  let balance: ProviderBalanceService;
  let savedPackages: ShippingPackage[] = [];
  const alertIds: string[] = [];

  const api = (method: string, path: string, token: string, json?: unknown) => h.api(method, path, { token, ...(json === undefined ? {} : { json }) });
  const quote = (id: string) => api('POST', `/admin/shipments/${id}/quote`, db.opToken, {});
  const pickRate = (q: any) => q.rates.find((r: any) => r.deliveryKind !== 'branch' && r.marginCents >= 0 && !r.hidden) ?? q.rates[0];
  const row = (id: string) => h.prisma.shipmentRequest.findUniqueOrThrow({ where: { id } });
  const dashboard = (token: string) => api('GET', '/admin/dashboard', token);
  const pnl = async (from: string, to: string) => {
    const r = await api('GET', `/admin/finance/pnl?from=${from}&to=${to}`, db.adminToken);
    expect(errCode(r)).toBe('200');
    return r.body;
  };
  const labeled = async () => {
    const d = await db.mkDirect({ prices: [50000, 30000] });
    await ready(db, d.shipment.id);
    const q = await quote(d.shipment.id);
    expect(errCode(q)).toBe('200');
    clock.advance(1);
    const b = await api('POST', `/admin/shipments/${d.shipment.id}/label`, db.opToken, buyBody(q.body, pickRate(q.body)));
    expect(errCode(b)).toBe('200');
    const s = await row(d.shipment.id);
    return { id: s.id, psid: s.providerShipmentId as string, row: s };
  };
  const balanceCalls = () => fake.calls.filter((c) => c.op === 'balance').length;

  beforeAll(async () => {
    ({ h, db, fake, clock } = await createLabelWorld(RUN));
    await purchaseOn(h, 'operators');
    await dial(h, 'operator_label_cap_24h_cents', 1_000_000_000);
    balance = h.app.get(ProviderBalanceService);
    savedPackages = await h.prisma.shippingPackage.findMany();
  });

  afterAll(async () => {
    await h.prisma.spendAlert.deleteMany({
      where: { OR: [{ id: { in: alertIds } }, { shipmentRequestId: { in: db.shipments } }, { subjectUserId: { in: [db.operatorId, db.adminId] } }, { dedupKey: { startsWith: 'ag7:' } }] },
    });
    await h.prisma.shipmentCostAdjustment.deleteMany({ where: { shipmentRequestId: { in: db.shipments } } });
    await h.prisma.shipmentCarrierEvent.deleteMany({ where: { shipmentRequestId: { in: db.shipments } } });
    await h.prisma.shippingPackage.deleteMany({});
    for (const p of savedPackages) await h.prisma.shippingPackage.create({ data: p });
    await restoreDials(h);
    await db.cleanup();
    await h?.close();
  });

  beforeEach(async () => {
    fake.calls.length = 0;
    fake.purchaseOutcomes.length = 0;
    fake.balanceCents = 10_000_000;
    fake.balanceSequence.length = 0;
    fake.extraChargeList = [];
    fake.forgetQuotations();
    clock.set(new Date());
    balance.invalidate();
    await dial(h, 'shipping_provider', 'skydropx');
  });

  // ============================================================================ P&L

  describe('P&L (§19.11, §M10-IVA.8)', () => {
    it('PS-80: el ajuste cuenta en el mes de su `chargedAt` (neto en `shippingCostCents` y aparte en `shippingAdjustmentsCents`); el mes del envío NO cambia', async () => {
      const ENV = ['2031-01-01', '2031-01-31'] as const;
      const CHG = ['2031-02-01', '2031-02-28'] as const;
      const envBefore = await pnl(...ENV);
      const chgBefore = await pnl(...CHG);
      const a = await labeled();
      await h.prisma.shipmentRequest.update({ where: { id: a.id }, data: { pickingAt: new Date('2031-01-15T12:00:00Z') } });
      const envMid = await pnl(...ENV);
      const net = a.row.shippingCostCents - a.row.shippingCostIvaCents;
      expect(envMid.shippingCostCents - envBefore.shippingCostCents).toBe(net);
      // El cargo extra entra por el job real (D2d) con `chargedAt` de febrero.
      const c: ProviderExtraCharge = { providerChargeId: `ch-${RUN}-a`, providerShipmentId: a.psid, trackingNumber: null, amountCents: 11600, chargeType: 'ExtraCharge::Overweight', chargedAt: '2031-02-10T12:00:00Z', status: 'paid' };
      fake.extraChargeList = [c];
      expect(errCode(await api('POST', '/admin/jobs/shipment-extra-charges', db.adminToken, {}))).toBe('200');
      const adj = await h.prisma.shipmentCostAdjustment.findFirstOrThrow({ where: { providerChargeId: c.providerChargeId } });
      expect([adj.amountCents, adj.ivaCents]).toEqual([11600, 1600]);
      const envAfter = await pnl(...ENV);
      const chgAfter = await pnl(...CHG);
      expect(envAfter).toEqual(envMid);
      expect(chgAfter.shippingAdjustmentsCents - chgBefore.shippingAdjustmentsCents).toBe(10000);
      expect(chgAfter.shippingCostCents - chgBefore.shippingCostCents).toBe(10000);
      expect(chgAfter.profitCents - chgBefore.profitCents).toBe(-10000);
      // ⛔ por `observedAt` (hoy): el mes de hoy no lo ve.
      const today = new Date().toISOString().slice(0, 10);
      const now = await pnl(today, today);
      expect(now.shippingAdjustmentsCents).toBe(await adjustmentsNetBetween(new Date(`${today}T00:00:00Z`), new Date(`${today}T23:59:59.999Z`)));
    });

    it('PS-81: guía Skydropx 7625 (IVA 690, seguro 2500) ⇒ neto 6935, seguro 2500, fuera de los faltantes; guía manual sin costo ⇒ cuenta', async () => {
      const P = ['2031-03-01', '2031-03-31'] as const;
      const before = await pnl(...P);
      const a = await labeled();
      await h.prisma.shipmentRequest.update({
        where: { id: a.id },
        data: { pickingAt: new Date('2031-03-10T12:00:00Z'), shippingCostCents: 7625, shippingCostIvaCents: 690, insuranceCostCents: 2500 },
      });
      const sky0 = await labeled();
      await h.prisma.shipmentRequest.update({ where: { id: sky0.id }, data: { pickingAt: new Date('2031-03-11T12:00:00Z'), shippingCostCents: 0, shippingCostIvaCents: 0, insuranceCostCents: 0 } });
      const m = await db.mkDirect({ prices: [50000] });
      await h.prisma.shipmentRequest.update({ where: { id: m.shipment.id }, data: { status: 'guia', labelSource: 'manual', trackingNumber: `M-${RUN}`, carrier: 'DHL', pickingAt: new Date('2031-03-12T12:00:00Z'), shippingCostCents: 0 } });
      const after = await pnl(...P);
      expect(after.shippingCostCents - before.shippingCostCents).toBe(6935);
      expect(after.shippingInsuranceCents - before.shippingInsuranceCents).toBe(2500);
      expect(after.shippingCostMissingCount - before.shippingCostMissingCount).toBe(1);
      const csv = await h.api('GET', `/admin/finance/export.csv?report=pnl&from=${P[0]}&to=${P[1]}`, { token: db.adminToken });
      const text = csv.text;
      const [head, line] = text.trim().split('\n');
      expect(head.split(',')).toEqual(['report', ...Object.keys(after)]);
      expect(line.split(',')).toEqual(['pnl', ...Object.values(after).map(String)]);
    });
  });

  async function adjustmentsNetBetween(gte: Date, lte: Date): Promise<number> {
    const rows = await h.prisma.shipmentCostAdjustment.findMany({ where: { chargedAt: { gte, lte } } });
    return rows.reduce((s, r) => s + r.amountCents - r.ivaCents, 0);
  }

  // ============================================================================ workQueue.shipping

  describe('`workQueue.shipping` (§19.13, PS-90)', () => {
    it('saldo 40000 < umbral 50000 ⇒ `lowBalance: true`; dos cargas ⇒ UNA llamada al doble; AG-7 abierto', async () => {
      await dial(h, 'skydropx_low_balance_cents', 50000);
      fake.balanceCents = 40000;
      const r1 = await dashboard(db.adminToken);
      const r2 = await dashboard(db.adminToken);
      expect(errCode(r1)).toBe('200');
      expect(r1.body.workQueue.shipping.lowBalance).toBe(true);
      expect(r2.body.workQueue.shipping.lowBalance).toBe(true);
      expect(balanceCalls()).toBe(1);
      expect(await h.prisma.spendAlert.findUnique({ where: { dedupKey: 'ag7:open' } })).not.toBeNull();
    });

    it('el operador recibe `lowBalance` y ⛔ ninguna cifra del saldo en su `workQueue`', async () => {
      await dial(h, 'skydropx_low_balance_cents', 50000);
      fake.balanceCents = 60000;
      const r = await dashboard(db.opToken);
      expect(errCode(r)).toBe('200');
      expect(r.body.workQueue.shipping.lowBalance).toBe(false);
      expect(Object.keys(r.body.workQueue.shipping).sort()).toEqual(['labelProcessing', 'lowBalance', 'withCarrierAlert']);
      expect(JSON.stringify(r.body.workQueue)).not.toMatch(/balanceCents|60000|thresholdCents/);
    });

    it('`shipping_provider = off` ⇒ `lowBalance: null` y CERO llamadas; proveedor que falla ⇒ `null`', async () => {
      await dial(h, 'shipping_provider', 'off');
      const r = await dashboard(db.adminToken);
      expect(r.body.workQueue.shipping.lowBalance).toBeNull();
      expect(balanceCalls()).toBe(0);
      await dial(h, 'shipping_provider', 'skydropx');
      fake.balanceSequence.push(new Error('boom'));
      const r2 = await dashboard(db.adminToken);
      expect(r2.body.workQueue.shipping.lowBalance).toBeNull();
    });

    it('`labelProcessing` = envíos con la guía en proceso (`labelProcessingSince ≠ null`)', async () => {
      const r = await dashboard(db.opToken);
      expect(r.body.workQueue.shipping.labelProcessing).toBe(await h.prisma.shipmentRequest.count({ where: { labelProcessingSince: { not: null } } }));
    });

    it('PS-171: `withCarrierAlert` = filas de `GET /admin/shipments` con `carrierAlert ≠ null` (un cuerpo, `carrierAlertActive`)', async () => {
      const countList = async () => {
        let n = 0;
        for (let page = 1; ; page += 1) {
          const r = await api('GET', `/admin/shipments?labelSource=skydropx&pageSize=100&page=${page}`, db.adminToken);
          expect(errCode(r)).toBe('200');
          n += r.body.data.filter((x: any) => x.carrierAlert != null).length;
          if (page * 100 >= r.body.total) return n;
        }
      };
      const wq = async () => (await dashboard(db.adminToken)).body.workQueue.shipping.withCarrierAlert as number;
      const before = { list: await countList(), wq: await wq() };
      expect(before.wq).toBe(before.list);
      const at = new Date(Date.now() - H);
      const set = async (id: string, data: Record<string, unknown>) => h.prisma.shipmentRequest.update({ where: { id }, data: { carrierStatusAt: at, ...data } });
      for (const st of CARRIER_STATUSES) {
        const s = await labeled();
        await set(s.id, { carrierStatus: st as CarrierStatus });
      }
      const delivered = await labeled();
      await set(delivered.id, { status: 'entregado', deliveredAt: new Date(), carrierStatus: 'exception' });
      const cancelled = await labeled();
      await set(cancelled.id, { status: 'cancelado', carrierStatus: 'delivery_attempt' });
      const ours = await labeled();
      await set(ours.id, { carrierStatus: 'canceled', providerCanceledAt: new Date(), providerCancelReason: 'prueba' });
      const unknown = await labeled();
      await set(unknown.id, { carrierStatus: 'exception' });
      await h.prisma.shipmentCarrierEvent.create({
        data: { shipmentRequestId: unknown.id, providerShipmentId: unknown.psid, providerEventKey: `unknown:estado_raro:${RUN}`, status: 'exception', detail: 'Estado no reconocido: estado_raro', occurredAt: at, observedAt: new Date() },
      });
      const after = { list: await countList(), wq: await wq() };
      expect(after.wq).toBe(after.list);
      // 5 estados de la lista + `canceled` por la paquetería + el desconocido; ni entregado, ni cancelado, ni nuestro `canceled`.
      expect(after.wq - before.wq).toBe(7);
    });
  });

  // ============================================================================ spendControl / S-GAS-3

  describe('`workQueue.spendControl` y S-GAS-3 (§19.29.9, §19.30.8)', () => {
    const mk = async (kind: SpendAlertKind, severity: SpendAlertSeverity, over: Record<string, unknown> = {}) => {
      const a = await h.prisma.spendAlert.create({
        data: {
          kind,
          severity,
          dedupKey: `d2f:${RUN}:${alertIds.length}`,
          facts: {},
          mailStatus: 'not_applicable',
          firstOccurredAt: new Date(),
          lastOccurredAt: new Date(),
          ...over,
        } as any,
      });
      alertIds.push(a.id);
      return a;
    };

    it('súper-admin: `unseen*` sin AG-7/11/12, sin silenciados ni vistos; S-GAS-3 da el MISMO número; operador ⇒ `null` en los dos', async () => {
      const sc = async () => (await dashboard(db.adminToken)).body.workQueue.spendControl;
      const s0 = await sc();
      await mk('label_cap_blocked', 'immediate');
      await mk('label_charged_unexplained', 'immediate');
      await mk('provider_balance_low', 'immediate');
      await mk('parcel_returned', 'immediate');
      await mk('label_cap_blocked', 'immediate', { muted: true });
      await mk('label_cap_blocked', 'immediate', { seenAt: new Date(), seenByUserId: db.adminId });
      await mk('label_costly_choice', 'digest');
      await mk('parcel_problem', 'digest');
      const s1 = await sc();
      expect(s1.unseenImmediate - s0.unseenImmediate).toBe(2);
      expect(s1.unseenDigest - s0.unseenDigest).toBe(1);
      const sumAdmin = await db.summary(db.adminToken);
      expect(sumAdmin.body.spendAlertsUnseenImmediate).toBe(s1.unseenImmediate);
      const op = await dashboard(db.opToken);
      expect(op.body.workQueue.spendControl).toBeNull();
      const sumOp = await db.summary(db.opToken);
      expect(sumOp.body.spendAlertsUnseenImmediate).toBeNull();
    });

    it('`labelSpend24h`: el MISMO predicado que TG-1, por persona con gasto; `capCents` del dial y `null` para el dueño', async () => {
      await dial(h, 'operator_label_cap_24h_cents', 1_000_000_000);
      await labeled();
      const sc = (await dashboard(db.adminToken)).body.workQueue.spendControl;
      const now = new Date();
      const op = sc.labelSpend24h.find((x: any) => x.userId === db.operatorId);
      expect(op).toBeDefined();
      expect(op.cents).toBe(await labelSpend24h(h.prisma, db.operatorId, now));
      expect(op.cents).toBeGreaterThan(0);
      for (const p of sc.labelSpend24h) {
        const u = await h.prisma.user.findUniqueOrThrow({ where: { id: p.userId }, select: { ...OWNER_SELECT, name: true } });
        expect(p.name).toBe(u.name);
        expect(p.capCents).toBe(isOwnerAccount(u) ? null : 1_000_000_000);
        expect(p.cents).toBeGreaterThan(0);
      }
      const cents = sc.labelSpend24h.map((x: any) => x.cents);
      expect(cents).toEqual([...cents].sort((x: number, y: number) => y - x));
    });
  });

  // ============================================================================ empaques

  describe('empaques (PS-110, §19.20.3, §19.22.3)', () => {
    const pkg = (code: string, over: Record<string, unknown> = {}) => ({ code, label: code, lengthCm: 30, widthCm: 20, heightCm: 10, weightKg: 1, providerPackageType: '4G', active: true, sortOrder: 0, ...over });

    it('operador: GET ⇒ 200 con activos e inactivos por `sortOrder`; PUT ⇒ 403', async () => {
      await h.prisma.shippingPackage.upsert({ where: { code: `off-${RUN}` }, update: { active: false, sortOrder: 99 }, create: { ...pkg(`off-${RUN}`, { active: false, sortOrder: 99 }) } });
      const r = await api('GET', '/admin/shipping/packages', db.opToken);
      expect(errCode(r)).toBe('200');
      expect(Object.keys(r.body)).toEqual(['packages']);
      const off = r.body.packages.find((p: any) => p.code === `off-${RUN}`);
      expect(off).toEqual(pkg(`off-${RUN}`, { active: false, sortOrder: 99 }));
      expect(r.body.packages.map((p: any) => p.sortOrder)).toEqual([...r.body.packages.map((p: any) => p.sortOrder)].sort((a: number, b: number) => a - b));
      expect(JSON.stringify(r.body)).not.toMatch(/"id"|createdAt|updatedAt/);
      expect(errCode(await api('PUT', '/admin/shipping/packages', db.opToken, { packages: [pkg('box')] }))).toBe('403:FORBIDDEN');
    });

    it('súper-admin: PUT reemplaza entero ⇒ 200 con la forma del GET; bitácora `shipping.packages_updated` antes/después; 400s', async () => {
      const before = (await api('GET', '/admin/shipping/packages', db.adminToken)).body.packages;
      const next = [pkg('box', { label: 'Caja', sortOrder: 2, weightKg: 5 }), pkg('envelope', { label: 'Sobre', sortOrder: 1, providerPackageType: '5H4' }), pkg('mini', { active: false, sortOrder: 3 })];
      const r = await api('PUT', '/admin/shipping/packages', db.adminToken, { packages: next });
      expect(errCode(r)).toBe('200');
      expect(r.body).toEqual({ packages: [next[1], next[0], next[2]] });
      expect((await api('GET', '/admin/shipping/packages', db.opToken)).body).toEqual(r.body);
      const log = await h.prisma.auditLog.findFirstOrThrow({ where: { action: 'shipping.packages_updated', actorUserId: db.adminId }, orderBy: { createdAt: 'desc' } });
      expect((log.before as any).packages).toEqual(before);
      expect((log.after as any).packages).toEqual(r.body.packages);
      const bad = await api('PUT', '/admin/shipping/packages', db.adminToken, { packages: [pkg('box', { weightKg: 0.5 })] });
      expect(errCode(bad)).toBe('400:VALIDATION_ERROR');
      expect(bad.body.error.details).toEqual({ field: 'weightKg', index: 0 });
      const none = await api('PUT', '/admin/shipping/packages', db.adminToken, { packages: [pkg('box', { active: false })] });
      expect(none.body.error.details).toEqual({ field: 'packages', reason: 'no_active_package' });
      // Un 400 no escribe nada.
      expect((await api('GET', '/admin/shipping/packages', db.opToken)).body).toEqual(r.body);
    });
  });

  describe('empaques — dos `PUT` a la vez (N = 10 rondas)', () => {
    const pkg = (code: string, over: Record<string, unknown> = {}) => ({ code, label: code, lengthCm: 30, widthCm: 20, heightCm: 10, weightKg: 1, providerPackageType: '4G', active: true, sortOrder: 0, ...over });
    it('el resultado es UNO de los dos cuerpos entero (⛔ mezcla) y la bitácora encadena: el `before` del segundo = el `after` del primero', async () => {
      const N = 10;
      let ok = 0;
      for (let round = 0; round < N; round += 1) {
        const A = [pkg(`a${round}`), pkg('shared', { label: `A${round}` })];
        const B = [pkg(`b${round}`), pkg('shared', { label: `B${round}` }), pkg(`b${round}x`, { active: false, sortOrder: 1 })];
        const since = new Date();
        const [ra, rb] = await Promise.all([
          api('PUT', '/admin/shipping/packages', db.adminToken, { packages: A }),
          api('PUT', '/admin/shipping/packages', db.adminToken, { packages: B }),
        ]);
        const final = (await api('GET', '/admin/shipping/packages', db.opToken)).body.packages.map((p: any) => `${p.code}:${p.label}`).sort();
        const asSet = (l: any[]) => l.map((p) => `${p.code}:${p.label}`).sort();
        const logs = await h.prisma.auditLog.findMany({ where: { action: 'shipping.packages_updated', createdAt: { gte: since } }, orderBy: { createdAt: 'asc' } });
        // `createdAt` es el inicio de CADA tx (`now()` de Postgres) y la segunda empezó antes de esperar el candado ⇒ el orden se
        // deduce de la cadena, no del reloj: una de las dos tiene por `before` el `after` de la otra, y ese `after` es el final.
        const j = (x: unknown) => JSON.stringify((x as any).packages);
        const chained =
          logs.length === 2 &&
          ((j(logs[1].before) === j(logs[0].after) && JSON.stringify(asSet((logs[1].after as any).packages)) === JSON.stringify(final)) ||
            (j(logs[0].before) === j(logs[1].after) && JSON.stringify(asSet((logs[0].after as any).packages)) === JSON.stringify(final)));
        const whole = JSON.stringify(final) === JSON.stringify(asSet(A)) || JSON.stringify(final) === JSON.stringify(asSet(B));
        if (errCode(ra) === '200' && errCode(rb) === '200' && whole && chained) ok += 1;
      }
      // eslint-disable-next-line no-console
      console.log(`[D2f PUT packages concurrente] ${ok}/${N} · N=${N}`);
      expect(ok).toBe(N);
    });
  });

  // ============================================================================ catálogos y saldo

  describe('catálogos y saldo (§19.13, §19.19.6, §19.22.3)', () => {
    it('`GET …/catalogs` (súper-admin): empaques, la Carta Porte configurada y plantillas SIN PII; operador ⇒ 403', async () => {
      const r = await api('GET', '/admin/shipping/catalogs', db.adminToken);
      expect(errCode(r)).toBe('200');
      expect(r.body).toEqual({
        packagings: [
          { code: '4G', name: 'Caja de cartón' },
          { code: '5H4', name: 'Saco (bolsa) de película de plástico' },
        ],
        consignmentNote: { code: '49101600', description: 'Coleccionables' },
        addressTemplates: [{ id: 'fake-template-verapaz', alias: 'Verapaz', addressType: 'from', isDefault: false, postalCode: '14210' }],
      });
      expect(errCode(await api('GET', '/admin/shipping/catalogs', db.opToken))).toBe('403:FORBIDDEN');
    });

    it('`GET …/catalogs/consignment-notes?description=` ⇒ `{consignmentNotes, hasMore}`; 2 letras ⇒ 400 {field}', async () => {
      const r = await api('GET', '/admin/shipping/catalogs/consignment-notes?description=naip', db.adminToken);
      expect(errCode(r)).toBe('200');
      expect(r.body).toEqual({ consignmentNotes: [{ code: '60141103', description: 'Naipes' }], hasMore: false });
      const bad = await api('GET', '/admin/shipping/catalogs/consignment-notes?description=na', db.adminToken);
      expect(errCode(bad)).toBe('400:VALIDATION_ERROR');
      expect(bad.body.error.details).toEqual({ field: 'description' });
      expect(errCode(await api('GET', '/admin/shipping/catalogs/consignment-notes?description=naip', db.opToken))).toBe('403:FORBIDDEN');
    });

    it('`GET …/balance` (súper-admin): en vivo (cada llamada lee), `no-store`, `observeBalance`; operador ⇒ 403; proveedor caído ⇒ 502', async () => {
      await dial(h, 'skydropx_low_balance_cents', 50000);
      fake.balanceCents = 45000;
      await h.prisma.spendAlert.deleteMany({ where: { dedupKey: { startsWith: 'ag7:' } } });
      const r = await api('GET', '/admin/shipping/balance', db.adminToken);
      expect(errCode(r)).toBe('200');
      expect(r.body).toEqual({ balanceCents: 45000, currency: 'MXN', lowBalance: true, thresholdCents: 50000, fetchedAt: expect.any(String) });
      expect(Date.parse(r.body.fetchedAt)).not.toBeNaN();
      const open = await h.prisma.spendAlert.findUniqueOrThrow({ where: { dedupKey: 'ag7:open' } });
      expect(String(r.headers['cache-control'])).toMatch(/no-store/);
      fake.balanceCents = 80000;
      const r2 = await api('GET', '/admin/shipping/balance', db.adminToken);
      expect(r2.body.lowBalance).toBe(false);
      expect(balanceCalls()).toBe(2);
      // `observeBalance` en o sobre el umbral ⇒ el aviso abierto se resuelve (histéresis, AG-7 (i)).
      expect(await h.prisma.spendAlert.findUnique({ where: { dedupKey: 'ag7:open' } })).toBeNull();
      expect((await h.prisma.spendAlert.findUniqueOrThrow({ where: { id: open.id } })).resolvedAt).not.toBeNull();
      expect(errCode(await api('GET', '/admin/shipping/balance', db.opToken))).toBe('403:FORBIDDEN');
      fake.balanceSequence.push(ShippingProviderError.error('balance', 500));
      expect(errCode(await api('GET', '/admin/shipping/balance', db.adminToken))).toBe('502:SHIPPING_PROVIDER_ERROR');
    });
  });
});
