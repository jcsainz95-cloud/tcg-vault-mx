/**
 * sdx-d2c-fake-purchase.e2e-spec.ts — 💰🔒 PS-166 (d) (API_CONTRACT §M4-SHIP.19.31.5): la compra de punta a punta con el
 * cableado REAL del módulo, como corre la pila E2E. Propiedad: backend.
 *
 * ⛔ Aquí NO se sustituye `LABEL_SPEND_KEY` ni `SHIPPING_PROVIDER_SELECTION`: la app arranca con
 * `SHIPPING_PROVIDER_ADAPTER=fake` y la llave del doble en el entorno del PROCESO, que es exactamente lo que exporta
 * `scripts/stack-native.sh` (§19.31.5 (4)). Lo que se demuestra:
 *  - con la llave: el dueño compra (`200 labeled`), UNA `purchase` en el doble, `GET …/label.pdf` `200 application/pdf` con
 *    `label_printed` y ⛔ CERO `fetch`; el doble por defecto compra «éxito con número» (§19.31.5 (6));
 *  - sin la llave (leída en CADA llamada): `409 {missing:['allow_spend']}` y `labelOptions.canPurchase:false`.
 * ⛔ `SKYDROPX_ALLOW_SPEND` no se pone en ningún sitio (PS-99); el adaptador real no se construye (`fake`).
 * Mutación que la pone roja: `fetch` del `labelUrl` del doble en `label.pdf` ⇒ el espía ve una llamada (y el veto de red
 * de `forbid-skydropx-network` no aplica a `fake.invalid`, así que el rojo es de ESTA aserción).
 */
import { ApiResponse, E2EHarness } from './helpers/e2e-app';
import { R, ShipPrepDb } from './helpers/ship-prep-db';
import { buyBody, errCode, purchaseOn, ready, restoreDials } from './helpers/label-db';
import { FakeShippingProvider } from '../../src/modules/shipping-provider/fake-shipping-provider';
import { SHIPPING_PROVIDER_SELECTION } from '../../src/modules/shipping-provider/shipping-provider.module';
import { ShippingProviderSelection } from '../../src/modules/shipping-provider/shipping-provider.factory';

const RUN = `d2cf${Date.now().toString(36)}`;
const FAKE_KEY = 'SHIPPING_FAKE_PURCHASE';

describe('💰🔒 PS-166 (d) — la compra con el doble y el cableado real (pila E2E)', () => {
  let h: E2EHarness;
  let db: ShipPrepDb;
  let sel: ShippingProviderSelection;
  let fake: FakeShippingProvider;
  const saved: Record<string, string | undefined> = {};
  let fetchSpy: jest.SpyInstance;

  const setEnv = (k: string, v: string | undefined) => {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  };
  const pickRate = (q: any) => q.rates.find((r: any) => r.deliveryKind !== 'branch' && r.marginCents >= 0 && !r.hidden) ?? q.rates[0];

  beforeAll(async () => {
    for (const k of ['SHIPPING_PROVIDER_ADAPTER', FAKE_KEY, 'SKYDROPX_ALLOW_SPEND', 'SKYDROPX_URL_HOSTS']) saved[k] = process.env[k];
    expect(process.env.SKYDROPX_ALLOW_SPEND).toBeUndefined(); // PS-99: nadie la pone
    setEnv('SKYDROPX_URL_HOSTS', undefined);
    process.env.SHIPPING_PROVIDER_ADAPTER = 'fake';
    process.env[FAKE_KEY] = 'true';
    h = await E2EHarness.create(); // ⛔ sin sustituciones de proveedor: el cableado del módulo
    sel = h.app.get<ShippingProviderSelection>(SHIPPING_PROVIDER_SELECTION);
    db = new ShipPrepDb(h, RUN);
    await db.init();
    await purchaseOn(h, 'super_admin_only');
    await h.prisma.user.updateMany({ where: { isOwner: true }, data: { isOwner: false } });
    await h.prisma.user.update({ where: { id: db.adminId }, data: { isOwner: true } });
  });

  afterAll(async () => {
    await h?.prisma.user.updateMany({ where: { isOwner: true }, data: { isOwner: false } });
    await h?.prisma.spendAlert.deleteMany({ where: { OR: [{ shipmentRequestId: { in: db.shipments } }, { dedupKey: { startsWith: 'ag7:' } }] } });
    if (h) await restoreDials(h);
    await db?.cleanup();
    await h?.close();
    for (const [k, v] of Object.entries(saved)) setEnv(k, v);
  });

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => fetchSpy.mockRestore());

  const readyQuoted = async () => {
    const d = await db.mkDirect({ prices: [50000, 30000] });
    await ready(db, d.shipment.id);
    const q: R = await h.api('POST', `/admin/shipments/${d.shipment.id}/quote`, { token: db.adminToken, json: {} });
    expect(q.status).toBe(200);
    return { id: d.shipment.id, q: q.body, rate: pickRate(q.body) };
  };

  it("la selección es la del arranque: kind 'fake', el doble, labelUrl por defecto en un host admitido", () => {
    expect(sel.kind).toBe('fake');
    expect(sel.port).toBeInstanceOf(FakeShippingProvider);
    fake = sel.port as FakeShippingProvider;
    expect(sel.urlHosts).toEqual(['fake.invalid']);
    expect(fake.defaultLabelUrl).toBe('https://fake.invalid/labels/fake.pdf');
  });

  it('con la llave: el dueño compra ⇒ 200 labeled con número; UNA purchase; label.pdf 200 application/pdf + label_printed; CERO fetch', async () => {
    const s = await readyQuoted();
    const det0: R = await h.api('GET', `/admin/shipments/${s.id}`, { token: db.adminToken });
    expect(det0.body.labelOptions).toEqual(expect.objectContaining({ canPurchase: true, purchase: 'super_admin_only', provider: 'skydropx' }));
    fake.calls.length = 0;
    const r: R = await h.api('POST', `/admin/shipments/${s.id}/label`, { token: db.adminToken, json: buyBody(s.q, s.rate) });
    expect(errCode(r)).toBe('200');
    expect(r.body.outcome).toBe('labeled');
    // §19.31.5 (6): el defecto del doble es «éxito con número» (determinista).
    expect(r.body.label.trackingNumber).toMatch(/^FAKE[0-9A-F]{8}\d{6}$/);
    expect(r.body.label.labelAvailable).toBe(true);
    expect(fake.callsOf('purchase')).toHaveLength(1);
    const p: ApiResponse = await h.api('GET', `/admin/shipments/${s.id}/label.pdf`, { token: db.opToken });
    expect(p.status).toBe(200);
    expect(p.headers['content-type']).toMatch(/^application\/pdf/);
    expect(p.text.startsWith('%PDF-')).toBe(true);
    expect(await h.prisma.auditLog.count({ where: { entityId: s.id, action: 'shipment.label_printed' } })).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sin la llave (leída en CADA llamada) ⇒ 409 {missing:['allow_spend']} y canPurchase:false; cero purchase", async () => {
    const s = await readyQuoted();
    delete process.env[FAKE_KEY];
    try {
      fake.calls.length = 0;
      const r: R = await h.api('POST', `/admin/shipments/${s.id}/label`, { token: db.adminToken, json: buyBody(s.q, s.rate) });
      expect(errCode(r)).toBe('409:SHIPPING_PROVIDER_NOT_CONFIGURED');
      expect(r.body.error.details).toEqual({ missing: ['allow_spend'] });
      const det: R = await h.api('GET', `/admin/shipments/${s.id}`, { token: db.adminToken });
      expect(det.body.labelOptions.canPurchase).toBe(false);
      expect(fake.callsOf('purchase')).toHaveLength(0);
    } finally {
      process.env[FAKE_KEY] = 'true';
    }
    expect(fake.callsOf('purchase')).toHaveLength(0);
  });
});
