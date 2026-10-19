/**
 * C-B3 (nunca datos personales; claves EXACTAS por nivel) y C-B4 (consentimiento en el cuerpo) — API_CONTRACT §MKT.H.5/.11.
 *
 * Se arma el cuerpo como lo arma el drenador AL ENVIAR (mismo camino: `MeasurementDrainService.run` con un doble HTTP que
 * captura), desde una orden y una solicitud con PII conocida (`PII`). El doble de Prisma devuelve la fila ENTERA aunque se
 * pida `select`: si el código copiara la fila, la PII llegaría al cuerpo.
 * Canario C-B3: añadir `em` (hasheado) a `user_data` ⇒ rojo por claves exactas.
 */
import { MeasurementService } from '../src/modules/measurement/measurement.service';
import { MeasurementDrainService } from '../src/modules/measurement/measurement-drain.service';
import type { MeasurementHttp } from '../src/modules/measurement/measurement-http';
import { CAPI_TOKEN, FBC, FBP, GA4_SECRET, GA_CLIENT, PII, fakeConfig, fullEnv } from './helpers/measurement-fixtures';
import { measurementPrismaDouble } from './helpers/measurement-prisma-double';

const NOW = new Date('2026-10-18T18:00:00.000Z');
const SETTLED = new Date('2026-10-18T17:59:00.000Z');

const order = (over: Record<string, unknown> = {}) => ({
  id: 'ord-uuid-1',
  orderNumber: PII.orderNumber,
  guestEmail: PII.guestEmail,
  userId: null,
  shippingAddressSnapshot: { name: PII.name, line1: PII.line1, postalCode: PII.postalCode, phone: PII.phone },
  billingSnapshot: { rfc: 'XAXX010101000', phone: PII.phone },
  totalCents: 123456,
  shippingFeeCents: 9900,
  settledAt: SETTLED,
  measurementConsentAnalytics: true,
  measurementConsentAds: true,
  measurementNoticeVersion: 'v1',
  firstUtmSource: 'instagram',
  firstUtmMedium: 'bio',
  firstUtmCampaign: 'nov',
  firstUtmContent: 'reel-1',
  items: [
    { cardSnapshot: { cardId: 'card-1', name: 'Charizard ex', setName: '151', number: '199', productType: 'raw' }, unitPriceCents: 100000 },
    {
      cardSnapshot: { cardId: 'card-2', name: 'ETB Prismatic', number: '1', productType: 'sealed', sealedProductId: 'sp-9' },
      unitPriceCents: 13556,
    },
  ],
  accessoryLines: [{ id: 'al-1', accessoryId: 'acc-1', metaDeckId: null, deckName: null, quantity: 2, unitPriceCents: 5000, snapshot: { name: 'Fundas' } }],
  ...over,
});

const sellRequest = (over: Record<string, unknown> = {}) => ({
  id: 'sr-uuid-1',
  userId: 'u1',
  clabeSnapshotEnc: PII.clabe,
  pickupAddressSnapshot: { line1: PII.line1, postalCode: PII.postalCode, phone: PII.phone },
  quotedTotalCents: 250000,
  createdAt: new Date('2026-10-18T17:00:00.000Z'),
  measurementConsentAnalytics: true,
  measurementConsentAds: true,
  firstUtmSource: 'instagram',
  firstUtmMedium: 'story',
  firstUtmCampaign: null,
  firstUtmContent: null,
  ...over,
});

async function capture(opts: { order?: Record<string, unknown>; lead?: Record<string, unknown>; ctx?: Record<string, unknown> }) {
  const subject = opts.order ? { orderId: 'ord-uuid-1' } : { sellRequestId: 'sr-uuid-1' };
  const kind = opts.order ? 'purchase' : 'generate_lead';
  const eventId = opts.order ? 'p_ord-uuid-1' : 'l_sr-uuid-1';
  const subjectId = opts.order ? 'ord-uuid-1' : 'sr-uuid-1';
  const d = measurementPrismaDouble({
    orders: opts.order ? [opts.order] : [],
    sellRequests: opts.lead ? [opts.lead] : [],
    contexts: opts.ctx ? [{ ...subject, ...opts.ctx }] : [],
    outbox: [
      { kind, destination: 'ga4_mp', subjectId, eventId },
      { kind, destination: 'meta_capi', subjectId, eventId },
    ] as never,
  });
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  const http: MeasurementHttp = {
    postJson: jest.fn(async (url: string, body: unknown) => {
      sent.push({ url, body: body as Record<string, unknown> });
      return 204;
    }),
  };
  const svc = new MeasurementService(d.prisma as never, fakeConfig(fullEnv()));
  const drain = new MeasurementDrainService(d.prisma as never, svc, http);
  await drain.run(NOW);
  const ga4 = sent.find((s) => s.url.startsWith('https://www.google-analytics.com/'))!;
  const meta = sent.find((s) => s.url.startsWith('https://graph.facebook.com/'))!;
  return { ga4, meta, sent };
}

const keys = (o: unknown) => Object.keys(o as object).sort();
const FORBIDDEN_ANY_LEVEL = ['user_id', 'user_data', 'ip_override', 'user_agent', 'user_location', 'user_properties'];

/** Todas las claves de un objeto en cualquier nivel. */
function allKeys(o: unknown, acc: string[] = []): string[] {
  if (Array.isArray(o)) o.forEach((x) => allKeys(x, acc));
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) acc.push(k), allKeys(v, acc);
  return acc;
}

describe('C-B3 · compra: ningún dato personal y claves EXACTAS por nivel', () => {
  it('GA4 MP y CAPI: JSON.stringify no contiene correo, teléfono, dirección, CP, nombre, CLABE ni orderNumber', async () => {
    const { ga4, meta } = await capture({ order: order(), ctx: { gaClientId: GA_CLIENT, fbp: FBP, fbc: FBC } });
    for (const body of [ga4.body, meta.body]) {
      const s = JSON.stringify(body);
      for (const v of Object.values(PII)) expect({ v, found: s.includes(v) }).toEqual({ v, found: false });
      expect(s).not.toContain('XAXX010101000');
    }
  });

  it('GA4 MP: claves exactas en cada nivel y ninguna prohibida', async () => {
    const { ga4 } = await capture({ order: order(), ctx: { gaClientId: GA_CLIENT } });
    const b = ga4.body as { events: { params: { items: unknown[] } }[]; consent: unknown };
    expect(keys(b)).toEqual(['client_id', 'consent', 'events', 'non_personalized_ads']);
    expect(b.consent).toEqual({ ad_user_data: 'DENIED', ad_personalization: 'DENIED' });
    expect(keys(b.events[0])).toEqual(['name', 'params']);
    expect(keys(b.events[0].params)).toEqual(
      ['currency', 'first_utm_campaign', 'first_utm_content', 'first_utm_medium', 'first_utm_source', 'items', 'shipping_cents', 'source', 'transaction_id', 'value'],
    );
    for (const it of b.events[0].params.items) expect(keys(it)).toEqual(['item_category', 'item_id', 'item_name', 'price', 'quantity']);
    for (const k of FORBIDDEN_ANY_LEVEL) expect(allKeys(b)).not.toContain(k);
    expect(b).toMatchObject({
      client_id: GA_CLIENT,
      non_personalized_ads: true,
      events: [{ name: 'purchase', params: { transaction_id: 'ord-uuid-1', value: 1234.56, currency: 'MXN', shipping_cents: 9900, source: 'server' } }],
    });
    expect(b.events[0].params.items).toEqual([
      { item_id: 'c_card-1', item_name: 'Charizard ex · 151', item_category: 'card', price: 1000, quantity: 1 },
      { item_id: 's_sp-9', item_name: 'ETB Prismatic', item_category: 'sealed', price: 135.56, quantity: 1 },
      { item_id: 'a_acc-1', item_name: 'Fundas', item_category: 'accessory', price: 50, quantity: 2 },
    ]);
  });

  it('CAPI: claves exactas; user_data SOLO fbp/fbc (sin em, ph, ip, agente); event_id = p_<Order.id>; token en el cuerpo', async () => {
    const { meta } = await capture({ order: order(), ctx: { fbp: FBP, fbc: FBC } });
    const b = meta.body as { data: Record<string, unknown>[]; access_token: string };
    expect(keys(b)).toEqual(['access_token', 'data']);
    expect(b.access_token).toBe(CAPI_TOKEN);
    expect(b.data).toHaveLength(1);
    const e = b.data[0];
    expect(keys(e)).toEqual(['action_source', 'custom_data', 'event_id', 'event_name', 'event_source_url', 'event_time', 'user_data']);
    expect(keys(e.user_data)).toEqual(['fbc', 'fbp']);
    expect(keys(e.custom_data)).toEqual(['content_ids', 'content_type', 'currency', 'num_items', 'value']);
    expect(e).toMatchObject({
      event_name: 'Purchase',
      event_id: 'p_ord-uuid-1',
      action_source: 'website',
      event_time: Math.floor(SETTLED.getTime() / 1000),
      event_source_url: 'https://tcghunt.mx/checkout',
      user_data: { fbp: FBP, fbc: FBC },
      custom_data: { currency: 'MXN', value: 1234.56, content_ids: ['c_card-1', 's_sp-9', 'a_acc-1'], content_type: 'product', num_items: 4 },
    });
    expect(meta.url).toMatch(/^https:\/\/graph\.facebook\.com\/v\d+\.\d+\/123456789012345\/events$/);
  });

  it('solicitud de venta: generate_lead / Lead sin CLABE ni dirección; claves exactas; event_id = l_<SellRequest.id>', async () => {
    const { ga4, meta } = await capture({ lead: sellRequest(), ctx: { gaClientId: GA_CLIENT, fbp: FBP } });
    for (const body of [ga4.body, meta.body]) {
      const s = JSON.stringify(body);
      for (const v of Object.values(PII)) expect({ v, found: s.includes(v) }).toEqual({ v, found: false });
    }
    const g = ga4.body as { events: { name: string; params: Record<string, unknown> }[] };
    expect(g.events[0].name).toBe('generate_lead');
    expect(keys(g.events[0].params)).toEqual(['currency', 'first_utm_medium', 'first_utm_source', 'quote_id', 'source', 'value']);
    expect(g.events[0].params).toMatchObject({ quote_id: 'sr-uuid-1', value: 2500, currency: 'MXN' });
    const m = (meta.body as { data: Record<string, unknown>[] }).data[0];
    expect(m).toMatchObject({ event_name: 'Lead', event_id: 'l_sr-uuid-1', user_data: { fbp: FBP }, custom_data: { currency: 'MXN', value: 2500 } });
    expect(keys(m.user_data)).toEqual(['fbp']);
    expect(keys(m.custom_data)).toEqual(['currency', 'value']);
  });

  it('el api_secret de GA4 va SOLO en la query de la URL (nunca en el cuerpo)', async () => {
    const { ga4 } = await capture({ order: order(), ctx: { gaClientId: GA_CLIENT } });
    expect(new URL(ga4.url).searchParams.get('api_secret')).toBe(GA4_SECRET);
    expect(JSON.stringify(ga4.body)).not.toContain(GA4_SECRET);
  });
});

describe('C-B4 · el consentimiento manda en el cuerpo', () => {
  it('analytics=false ⇒ MP sin first_utm_* y client_id DISTINTO del gaClientId enviado (aleatorio por evento)', async () => {
    const o = order({ measurementConsentAnalytics: false });
    const a = await capture({ order: o, ctx: { gaClientId: GA_CLIENT } });
    const b = await capture({ order: o, ctx: { gaClientId: GA_CLIENT } });
    const pa = a.ga4.body as { client_id: string; events: { params: Record<string, unknown> }[] };
    const pb = b.ga4.body as { client_id: string };
    expect(Object.keys(pa.events[0].params).filter((k) => k.startsWith('first_utm_'))).toEqual([]);
    expect(pa.client_id).not.toBe(GA_CLIENT);
    expect(pa.client_id).toMatch(/^\d{1,10}\.\d{1,10}$/);
    expect(pb.client_id).not.toBe(pa.client_id);
  });
});
