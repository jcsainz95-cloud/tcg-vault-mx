/**
 * sdx-b2-timeline.e2e-spec.ts — errata v1.80.12.16, B-2 (API_CONTRACT §M4-SHIP.19.35.2/.3): la línea de tiempo pública contra
 * Postgres REAL, app Nest completa por HTTP, proveedor DOBLE (⛔ nunca la red: PS-99), llave de compra SUSTITUIDA. Propiedad: backend.
 *
 *  - PS-89 corregida (§19.35.2): `created → picked_up → last_mile → delivery_attempt → delivered_to_branch → delivered` con
 *    `shippedAt` puesto ⇒ `timeline` de **7**, en orden de `at`.
 *  - PS-89 ampliada (§19.35.3 (2)): guía Skydropx con `created`, `in_transit` y `PATCH …/status {to:'entregado'}` ⇒ última
 *    entrada `delivered` con `at = deliveredAt`; cero `AV-17`. Con `delivered` del transportista (y `deliveredAt` puesto por él)
 *    ⇒ **una** `delivered`, la del evento.
 */
import { createLabelWorld, buyBody, dial, errCode, purchaseOn, ready, restoreDials, LabelWorld } from './helpers/label-db';
import { R } from './helpers/ship-prep-db';
import { OrderAccessTokenService } from '../../src/modules/orders/order-access-token.service';

const RUN = `b2tl${Date.now().toString(36)}`;
const H = 3_600_000;
const D = 24 * H;

describe('B-2 (§19.35.2/.3) — PS-89: 7 con `shipped`; `entregado` a mano ⇒ `delivered` en `deliveredAt`; nunca dos', () => {
  let w: LabelWorld;
  const iso = (ms: number) => new Date(ms).toISOString();
  const api = (method: string, path: string, json?: unknown): Promise<R> => w.h.api(method, path, { token: w.db.opToken, ...(json === undefined ? {} : { json }) });
  const row = (id: string) => w.h.prisma.shipmentRequest.findUniqueOrThrow({ where: { id } });
  const pickRate = (q: any) => q.rates.find((r: any) => r.deliveryKind !== 'branch' && r.marginCents >= 0 && !r.hidden) ?? q.rates[0];
  const refresh = (id: string) => {
    w.clock.advance(1000);
    return api('POST', `/admin/shipments/${id}/refresh-tracking`, {});
  };
  /** Pedido directo de INVITADO con guía de Skydropx comprada por el doble `ageMs` antes de «ahora». */
  const labeled = async (ageMs = 10 * D) => {
    const back = w.clock.now().getTime();
    w.clock.set(new Date(back - ageMs));
    const d = await w.db.mkDirect({ prices: [50000, 30000] });
    await ready(w.db, d.shipment.id);
    const q = await api('POST', `/admin/shipments/${d.shipment.id}/quote`, {});
    expect(q.status).toBe(200);
    w.clock.advance(1);
    const b = await api('POST', `/admin/shipments/${d.shipment.id}/label`, buyBody(q.body, pickRate(q.body)));
    expect(errCode(b)).toBe('200');
    w.clock.set(new Date(back));
    const s = await row(d.shipment.id);
    return { id: s.id, psid: s.providerShipmentId as string, orderId: d.order.id };
  };
  const timelineOf = async (orderId: string) => {
    const { clear } = await w.h.app.get(OrderAccessTokenService).issue(orderId, { rotate: false });
    const r = await w.h.api('POST', '/orders/guest/track', { json: { token: clear } });
    expect(r.status).toBe(200);
    return r.body.shipping.timeline as { kind: string; at: string; branchName?: string }[];
  };

  beforeAll(async () => {
    w = await createLabelWorld(RUN);
    await purchaseOn(w.h, 'operators');
    await dial(w.h, 'operator_label_cap_24h_cents', 1_000_000_000);
  });

  afterAll(async () => {
    if (w) {
      await w.h.prisma.spendAlert.deleteMany({ where: { OR: [{ shipmentRequestId: { in: w.db.shipments } }, { subjectUserId: { in: [w.db.operatorId, w.db.adminId] } }, { dedupKey: { startsWith: 'ag7:' } }] } });
      await w.h.prisma.shipmentCarrierEvent.deleteMany({ where: { shipmentRequestId: { in: w.db.shipments } } });
      await restoreDials(w.h);
      await w.db.cleanup();
      await w.h.close();
    }
  });

  beforeEach(async () => {
    w.fake.calls.length = 0;
    w.fake.purchaseOutcomes.length = 0;
    w.fake.forgetQuotations();
    w.clock.set(new Date());
    w.notices.calls.length = 0;
  });

  it('PS-89 (§19.35.2): la secuencia completa con `shippedAt` puesto ⇒ 7 entradas, los 7 `kind`, en orden de `at`', async () => {
    const s = await labeled();
    const t = w.clock.now().getTime();
    const SEQ = ['created', 'picked_up', 'last_mile', 'delivery_attempt', 'delivered_to_branch', 'delivered'] as const;
    SEQ.forEach((st, i) => w.fake.pushEvent(s.psid, st, iso(t - (9 - i) * D), st === 'delivered_to_branch' ? { branchName: 'Sucursal Norte' } : {}));
    await refresh(s.id);
    const r = await row(s.id);
    expect(r.shippedAt).not.toBeNull();
    expect(r.deliveredAt).not.toBeNull();
    const tl = await timelineOf(s.orderId);
    expect(tl).toHaveLength(7);
    expect([...tl.map((e) => e.kind)].sort()).toEqual(['at_branch', 'delivered', 'delivery_attempt', 'in_transit', 'label_created', 'out_for_delivery', 'shipped']);
    const ats = tl.map((e) => Date.parse(e.at));
    expect(ats).toEqual([...ats].sort((a, b) => a - b));
    // La `delivered` es la del transportista (⛔ no la `deliveredAt` de la tienda, que es «ahora»).
    expect(tl.filter((e) => e.kind === 'delivered')).toEqual([{ kind: 'delivered', at: iso(t - 4 * D) }]);
    expect(tl.find((e) => e.kind === 'shipped')).toEqual({ kind: 'shipped', at: r.shippedAt!.toISOString() });
  });

  it('PS-89 ampliada (§19.35.3 (2)): `created`, `in_transit` y `entregado` A MANO ⇒ última `delivered` con `at = deliveredAt`; cero AV-17', async () => {
    const s = await labeled();
    const t = w.clock.now().getTime();
    w.fake.pushEvent(s.psid, 'created', iso(t - 3 * D));
    w.fake.pushEvent(s.psid, 'in_transit', iso(t - 2 * D));
    // `shippedAt` sale del reloj inyectado de la guía y `deliveredAt` del `PATCH` (reloj del sistema): el sondeo va 1 min por
    // DETRÁS para que la salida quede antes de la entrega, como en producción (un solo reloj).
    w.clock.set(new Date(Date.now() - 60_000));
    await refresh(s.id);
    expect((await row(s.id)).status).toBe('enviado');
    const p = await api('PATCH', `/admin/shipments/${s.id}/status`, { to: 'entregado' });
    expect(errCode(p)).toBe('200');
    const r = await row(s.id);
    expect(r.status).toBe('entregado');
    expect(r.deliveredAt).not.toBeNull();
    const tl = await timelineOf(s.orderId);
    expect(tl[tl.length - 1]).toEqual({ kind: 'delivered', at: r.deliveredAt!.toISOString() });
    expect(tl.filter((e) => e.kind === 'delivered')).toHaveLength(1);
    expect(tl.map((e) => e.kind)).toEqual(expect.arrayContaining(['label_created', 'shipped', 'in_transit', 'delivered']));
    expect(w.notices.of(s.id, 'AV-17')).toHaveLength(0);
  });

  it('⛔ nunca dos: `delivered` del transportista (que pone `deliveredAt` ≈ ahora) ⇒ UNA `delivered`, con la fecha del EVENTO', async () => {
    const s = await labeled();
    const t = w.clock.now().getTime();
    w.fake.pushEvent(s.psid, 'in_transit', iso(t - 2 * D));
    await refresh(s.id);
    w.fake.pushEvent(s.psid, 'delivered', iso(t - D));
    await refresh(s.id);
    const r = await row(s.id);
    expect(r.status).toBe('entregado');
    expect(r.deliveredAt!.getTime()).toBeGreaterThan(t - H);
    const tl = await timelineOf(s.orderId);
    expect(tl.filter((e) => e.kind === 'delivered')).toEqual([{ kind: 'delivered', at: iso(t - D) }]);
  });
});
