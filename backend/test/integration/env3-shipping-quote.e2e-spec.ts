/**
 * env3-shipping-quote.e2e-spec.ts — §ENV3 contra Postgres y Redis REALES. Skydropx es un DOBLE (fixtures MEDIDOS 2026-11-19): ⛔ cero red.
 * Cubre las pruebas de gate de DECISIONES §ENV3 punto 14: cliente no fija peso/costo; quoteId manipulado/caducado ⇒ 409; doble clic ⇒ 1 pedido;
 * timeout ⇒ respaldo y cobro = mostrado; zona extendida sin doble cobro; pedido ≥ MX$4,000 sin cotizar; código de envío gratis; throttle.
 */
import { randomUUID } from 'crypto';
import { E2EHarness } from './helpers/e2e-app';
import { SHIPPING_PROVIDER_PORT } from '../../src/modules/shipping-provider/shipping-provider.port';
import { MTY_ENVELOPE, TODOS_SANTOS } from '../../src/modules/shipping-quote/fixtures';
import { PiiCryptoService } from '../../src/common/crypto/pii-crypto.service';
import { signShipQuote } from '../../src/modules/shipping-quote/ship-quote-token';
import { E2E_USERS, E2E_FOLIOS } from '../../prisma/e2e-fixtures';
import { SHIP_QUOTE_CACHE, MemoryShipQuoteCache } from '../../src/modules/shipping-quote/ship-quote-cache';

const RUN = Date.now().toString(36);
const ADDRESS = (cp: string) => ({ line1: 'Av. Reforma 100', neighborhood: 'Centro', city: 'Monterrey', state: 'Nuevo León', postalCode: cp, country: 'MX', phone: '5512345678', recipientName: 'Juan Pérez' });

describe('E2E §ENV3 — envío por CP y carrito', () => {
  let h: E2EHarness;
  let rates = MTY_ENVELOPE;
  let calls = 0;
  let delayMs = 0;
  const port = {
    quote: async () => {
      calls += 1;
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      return { providerQuotationId: 'q', completed: true, rates, excluded: {}, insuranceEcho: { ok: true }, raw: null };
    },
  };
  const ids: string[] = [];
  const set = (key: string, value: unknown) =>
    h.prisma.configSetting.upsert({ where: { key }, create: { key, valueJson: value as never }, update: { valueJson: value as never } });
  const mkItem = async () => {
    const t = await h.prisma.inventoryItem.findUnique({ where: { folio: E2E_FOLIOS.listedCharizard } });
    const it = await h.prisma.inventoryItem.create({
      data: { folio: `E2E-ENV3-${RUN}-${ids.length}`, cardId: t!.cardId, productType: 'raw', rawCondition: 'NM', finish: 'normal', ownerType: 'platform', status: 'listed', acquisitionType: 'compra', acquisitionCostCents: 70000, locationId: t!.locationId } as never,
    });
    ids.push(it.id);
    return it.id;
  };
  const session = (itemIds: string[], cp: string, quoteId?: string, extra: object = {}) =>
    h.api('POST', '/checkout/guest/session', {
      json: { inventoryItemIds: itemIds, email: `env3.${RUN}.${randomUUID().slice(0, 6)}@example.com`, shippingAddress: ADDRESS(cp), acceptedTerms: true, fulfillmentMode: 'direct_ship', ...(quoteId ? { shippingQuoteId: quoteId } : {}), ...extra },
      headers: { 'x-forwarded-for': `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
    });

  beforeAll(async () => {
    h = await E2EHarness.create((b) => b.overrideProvider(SHIPPING_PROVIDER_PORT).useValue(port).overrideProvider(SHIP_QUOTE_CACHE).useValue(new MemoryShipQuoteCache()));
    await set('ship_v3_enabled', 'on');
    await set('skydropx_origin_address_template_id', 'tpl-test');
    await h.prisma.postalCode.upsert({ where: { postalCode_neighborhood: { postalCode: '64000', neighborhood: 'Centro' } }, create: { postalCode: '64000', neighborhood: 'Centro', municipality: 'Monterrey', state: 'Nuevo León' }, update: {} });
    await h.prisma.postalCode.upsert({ where: { postalCode_neighborhood: { postalCode: '23300', neighborhood: 'Centro' } }, create: { postalCode: '23300', neighborhood: 'Centro', municipality: 'Todos Santos', state: 'Baja California Sur' }, update: {} });
  });
  afterAll(async () => {
    await set('ship_v3_enabled', 'off');
    await h?.close();
  });
  beforeEach(() => {
    rates = MTY_ENVELOPE;
    calls = 0;
    delayMs = 0;
  });

  it('POST /checkout/shipping-quote ⇒ {quoteId, shippingFeeCents, service, etaDays, expiresAt}; el cliente no puede mandar peso ni costo', async () => {
    const a = await mkItem();
    const res = await h.api('POST', '/checkout/shipping-quote', { json: { cp: '64000', items: [{ inventoryItemId: a }], weightKg: 0, costCents: 1, shippingFeeCents: 1 } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ shippingFeeCents: 17700, service: 'FedEx Standard Overnight', etaDays: 1 });
    expect(typeof res.body.quoteId).toBe('string');
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('cobro = mostrado: la sesión cobra exactamente lo cotizado y congela el snapshot; el quote con shippingQuoteId muestra el mismo total', async () => {
    const a = await mkItem();
    const q = (await h.api('POST', '/checkout/shipping-quote', { json: { cp: '64000', items: [{ inventoryItemId: a }] } })).body;
    const view = await h.api('POST', '/checkout/guest/quote', { json: { inventoryItemIds: [a], shippingAddress: ADDRESS('64000'), shippingQuoteId: q.quoteId } });
    expect(view.body.breakdown.shippingFeeCents).toBe(q.shippingFeeCents);
    const s = await session([a], '64000', q.quoteId);
    expect(s.status).toBe(201);
    expect(s.body.breakdown.shippingFeeCents).toBe(q.shippingFeeCents);
    expect(s.body.breakdown.totalCents).toBe(view.body.breakdown.totalCents);
    const order = await h.prisma.order.findUnique({ where: { id: s.body.orderId } });
    expect(order!.shippingFeeCents).toBe(17700);
    expect(order!.shippingQuoteSnapshot).toMatchObject({ serviceCode: 'standard_overnight', costQuotedCents: 15686, marginCents: 2000, source: 'live', profile: { package: 'envelope', boxes: 1 } });
  });

  it('sin quoteId, manipulado o de otro CP ⇒ 409 SHIPPING_QUOTE_STALE con details.newQuote; NO se crea pedido', async () => {
    const a = await mkItem();
    const q = (await h.api('POST', '/checkout/shipping-quote', { json: { cp: '64000', items: [{ inventoryItemId: a }] } })).body;
    const before = await h.prisma.order.count({ where: { items: { some: { inventoryItemId: a } } } });
    for (const [quoteId, cp] of [[undefined, '64000'], [q.quoteId + 'x', '64000'], [q.quoteId.replace(/^./, (c: string) => (c === 'A' ? 'B' : 'A')), '64000'], [q.quoteId, '06600']] as const) {
      const r = await session([a], cp, quoteId);
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('SHIPPING_QUOTE_STALE');
      expect(r.body.error.details.newQuote).toMatchObject({ shippingFeeCents: expect.any(Number), quoteId: expect.any(String) });
    }
    expect(await h.prisma.order.count({ where: { items: { some: { inventoryItemId: a } } } })).toBe(before);
  });

  it('el carrito cambió de perfil ⇒ 409 con cobro nuevo y el reintento con ESE quoteId cobra exactamente lo que el 409 mostró', async () => {
    const a = await mkItem();
    const q = (await h.api('POST', '/checkout/shipping-quote', { json: { cp: '64000', items: [{ inventoryItemId: a }] } })).body;
    // otro CP con el mismo carrito = otro hash/CP ⇒ stale
    const r = await session([a], '66000', q.quoteId);
    expect(r.status).toBe(409);
    const fresh = r.body.error.details.newQuote;
    const again = await session([a], '66000', fresh.quoteId);
    expect(again.status).toBe(201);
    expect(again.body.breakdown.shippingFeeCents).toBe(fresh.shippingFeeCents);
  });

  it('quoteId CADUCADO (firma buena, exp vencido) ⇒ 409; sin pedido', async () => {
    const a = await mkItem();
    const pii = h.app.get(PiiCryptoService);
    const good = (await h.api('POST', '/checkout/shipping-quote', { json: { cp: '64000', items: [{ inventoryItemId: a }] } })).body;
    const payload = JSON.parse(Buffer.from(good.quoteId.split('.')[0], 'base64url').toString());
    const old = signShipQuote(pii, { ...payload, iat: payload.iat - 4000, exp: payload.iat - 1000 });
    const r = await session([a], '64000', old);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('SHIPPING_QUOTE_STALE');
    // y una cifra reescrita con la firma vieja ⇒ también 409 (infalsificable)
    const forged = Buffer.from(JSON.stringify({ ...payload, fee: 100 })).toString('base64url') + '.' + good.quoteId.split('.')[1];
    expect((await session([a], '64000', forged)).status).toBe(409);
  });

  it('doble clic: dos sesiones simultáneas con el mismo quoteId y token de reintento ⇒ un solo pedido vivo por pieza', async () => {
    const a = await mkItem();
    const q = (await h.api('POST', '/checkout/shipping-quote', { json: { cp: '64000', items: [{ inventoryItemId: a }] } })).body;
    const email = `dbl.${RUN}@example.com`;
    const call = () => h.api('POST', '/checkout/guest/session', { json: { inventoryItemIds: [a], email, shippingAddress: ADDRESS('64000'), acceptedTerms: true, shippingQuoteId: q.quoteId }, headers: { 'x-forwarded-for': '10.9.9.9' } });
    const [r1, r2] = await Promise.all([call(), call()]);
    expect([r1.status, r2.status].filter((s) => s === 201).length).toBe(1);
    expect(await h.prisma.order.count({ where: { items: { some: { inventoryItemId: a } }, status: 'pending' } })).toBe(1);
  });

  it('timeout de Skydropx ⇒ respaldo por tabla (p75 + seguro + MX$20) y la sesión cobra lo mostrado', async () => {
    await set('ship_quote_timeout_ms', 500);
    delayMs = 1500;
    const a = await mkItem();
    await h.prisma.postalCode.upsert({ where: { postalCode_neighborhood: { postalCode: '64001', neighborhood: 'Centro' } }, create: { postalCode: '64001', neighborhood: 'Centro', municipality: 'Monterrey', state: 'Nuevo León' }, update: {} });
    const q = (await h.api('POST', '/checkout/shipping-quote', { json: { cp: '64001', items: [{ inventoryItemId: a }] } })).body;
    await set('ship_quote_timeout_ms', 6000);
    const row = await h.prisma.shippingZoneRate.findUnique({ where: { prefix2_profileKey_serviceCode: { prefix2: '64', profileKey: 'envelope:1', serviceCode: 'standard_overnight' } } });
    expect(row).not.toBeNull();
    const s = await session([a], '64001', q.quoteId);
    expect(s.status).toBe(201);
    expect(s.body.breakdown.shippingFeeCents).toBe(q.shippingFeeCents);
    const order = await h.prisma.order.findUnique({ where: { id: s.body.orderId } });
    expect(order!.shippingQuoteSnapshot).toMatchObject({ source: 'table', serviceCode: 'standard_overnight' });
    expect(q.shippingFeeCents).toBe(Math.ceil((row!.costCents + 2500 + 2000) / 100) * 100); // tabla: p75 + seguro del escalón MX$2,500 (MX$25) + MX$20
    await new Promise((r) => setTimeout(r, 1700)); // la llamada en segundo plano termina antes de cerrar
  });

  it('zona extendida (23300): el costo cotizado ya la trae y NO se cobra doble', async () => {
    rates = TODOS_SANTOS;
    const a = await mkItem();
    const q = (await h.api('POST', '/checkout/shipping-quote', { json: { cp: '23300', items: [{ inventoryItemId: a }] } })).body;
    expect(q.shippingFeeCents).toBe(Math.ceil((41001 + 1500 + 2000) / 100) * 100);
  });

  it('pedido ≥ MX$4,000: cobro 0 sin llamar a Skydropx', async () => {
    await set('direct_ship_free_from_cents', 1000); // el umbral baja bajo el precio de la pieza (el precio sale del catálogo, no se fija aquí)
    const a = await mkItem();
    const q = await h.api('POST', '/checkout/shipping-quote', { json: { cp: '10000', items: [{ inventoryItemId: a }] } });
    expect(q.status).toBe(200);
    expect(q.body.shippingFeeCents).toBe(0);
    expect(calls).toBe(0);
    const s = await session([a], '10000', q.body.quoteId);
    expect(s.status).toBe(201);
    expect(s.body.breakdown.shippingFeeCents).toBe(0);
    await set('direct_ship_free_from_cents', 400000);
  });

  it('código de envío gratis (§DSC): la cotización se muestra sin código y la sesión cobra 0; el pedido conserva lo cotizado y lo exonerado', async () => {
    const admin = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    const code = `ENV3FREE${RUN}`.toUpperCase();
    const made = await h.api('POST', '/admin/discount-codes', { token: admin, json: { code, kind: 'free_shipping' } });
    expect(made.status).toBe(201);
    const a = await mkItem();
    const q = (await h.api('POST', '/checkout/shipping-quote', { json: { cp: '64000', items: [{ inventoryItemId: a }] } })).body;
    expect(q.shippingFeeCents).toBe(17700);
    const s = await session([a], '64000', q.quoteId, { discountCode: code });
    expect(s.status).toBe(201);
    expect(s.body.breakdown.shippingFeeCents).toBe(0);
    const order = await h.prisma.order.findUnique({ where: { id: s.body.orderId } });
    expect(order!.shippingWaivedCents).toBe(17700);
    expect(order!.shippingQuoteSnapshot).toMatchObject({ costQuotedCents: 15686 });
  });

  it('items inválidos ⇒ 400; CP malo ⇒ 400 (el throttle 20/min se mide en test/env3.shipping-quote-throttle.spec.ts: el guard global se apaga bajo test)', async () => {
    expect((await h.api('POST', '/checkout/shipping-quote', { json: { cp: '640', items: [{ inventoryItemId: randomUUID() }] } })).status).toBe(400);
    expect((await h.api('POST', '/checkout/shipping-quote', { json: { cp: '64000', items: [{ weightKg: 1 }] } })).status).toBe(400);
  });
});
