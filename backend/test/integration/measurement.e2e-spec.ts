/**
 * Fase 2 de medición contra Postgres REAL y la app Nest completa (API_CONTRACT §MKT.H; ARCHITECTURE §14). Sin red a
 * Google/Meta: el puerto HTTP de la medición es un DOBLE que cuenta y responde, y `fetch` global se vigila.
 *
 *  C-B1  `off`: checkout con `measurement` completo ⇒ consentimiento y `firstUtm*` NULL, 0 filas de contexto y de cola;
 *        `banner-response` ⇒ 204 sin escribir; el pago no encola; el drenador no llama a la red.
 *  C-B2  🔒💰 con el encolado LANZANDO, el webhook liquida igual (200, orden `settled`, pieza `in_custody`).
 *  C-B4  consentimiento: `analytics=false` ⇒ sin `first_utm_*` y `client_id` distinto; `ads=false` ⇒ 0 filas `meta_capi`.
 *  C-B5  el mismo `payment_intent.succeeded` 2 veces (dos `event.id`) ⇒ 1 fila por destino; `eventId = p_<Order.id>`.
 *  C-B8  purga a los 7 días (cola y contexto) en el mismo job.
 *  C-B9  `utmMedium` fuera de los cuatro ⇒ NULL; la celda con NULL no se duplica; 31.ª petición en una hora ⇒ 429.
 *  §13.4.4  retención de 12 meses del registro de accesos del Panel: una fila de 13 meses y otra de 11 ⇒ queda la de 11.
 */
import { E2EHarness } from './helpers/e2e-app';
import { E2E_FOLIOS, E2E_USERS } from '../../prisma/e2e-fixtures';
import { MeasurementService } from '../../src/modules/measurement/measurement.service';
import { MeasurementDrainService } from '../../src/modules/measurement/measurement-drain.service';
import { MEASUREMENT_HTTP, type MeasurementHttp } from '../../src/modules/measurement/measurement-http';
import { MarketingAccessLogService } from '../../src/modules/marketing/marketing-access-log.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

const RUN = Date.now().toString(36);
const PREFIX = `E2E-MKT2-${RUN}-`;
const FBP = 'fb.1.1712345678901.1234567890';
const GA = '1234567890.1712345678';
const ENV_ON: Record<string, string> = {
  MEASUREMENT_MODE: 'on',
  GA4_MEASUREMENT_ID: 'G-ABC123XYZ9',
  GA4_MP_API_SECRET: 'mpSecret_abc-123',
  META_PIXEL_ID: '123456789012345',
  META_CAPI_TOKEN: 'EAAGtokenFAKEforTESTS1234567890abcdef',
};
const FULL = {
  consent: { analytics: true, ads: true },
  noticeVersion: '2026-11.1',
  firstUtm: { source: 'instagram', medium: 'paid', campaign: 'nov', content: 'reel-1' },
  gaClientId: GA,
  fbp: FBP,
};

type World = { h: E2EHarness; http: jest.Mocked<MeasurementHttp>; token: string; userId: string; template: { cardId: string; locationId: string | null } };

async function boot(env: Record<string, string | undefined>): Promise<World> {
  const http = { postJson: jest.fn(async (_u: string, _b: unknown, _t: number): Promise<number | null> => 204) } as jest.Mocked<MeasurementHttp>;
  const h = await E2EHarness.create((b) =>
    b
      .overrideProvider(MeasurementService)
      .useFactory({
        factory: (prisma: PrismaService, config: ConfigService) =>
          new MeasurementService(prisma, { get: (k: string) => (k in env ? env[k] : config.get<string>(k)) } as ConfigService),
        inject: [PrismaService, ConfigService],
      })
      .overrideProvider(MEASUREMENT_HTTP)
      .useValue(http),
  );
  const seed = await h.prisma.user.findUniqueOrThrow({ where: { email: E2E_USERS.customer.email } });
  const email = `mkt2.${env.MEASUREMENT_MODE ?? 'off'}.${RUN}@e2e.local`;
  const u = await h.prisma.user.upsert({
    where: { email },
    create: { email, passwordHash: seed.passwordHash, name: 'E2E MKT2', role: 'customer', locale: 'es', phone: seed.phone, emailVerified: true },
    update: { emailVerified: true, status: 'active' },
  });
  const token = await h.login(email, E2E_USERS.customer.password);
  const template = await h.prisma.inventoryItem.findUniqueOrThrow({ where: { folio: E2E_FOLIOS.listedCharizard } });
  return { h, http, token, userId: u.id, template };
}

let seq = 0;
async function piece(w: World) {
  return w.h.prisma.inventoryItem.create({
    data: {
      folio: `${PREFIX}${(seq += 1)}`,
      cardId: w.template.cardId,
      productType: 'raw',
      rawCondition: 'NM',
      finish: 'normal',
      ownerType: 'platform',
      status: 'listed',
      acquisitionType: 'compra',
      acquisitionCostCents: 70000,
      locationId: w.template.locationId,
    },
  });
}

async function checkout(w: World, measurement?: unknown) {
  const it = await piece(w);
  const res = await w.h.api('POST', '/checkout/session', {
    token: w.token,
    json: { inventoryItemIds: [it.id], ...(measurement !== undefined ? { measurement } : {}) },
  });
  expect(res.status).toBe(201);
  return { orderId: res.body.orderId as string, pi: res.body.stripe.paymentIntentId as string, total: res.body.breakdown.totalCents as number, itemId: it.id };
}

const pay = (w: World, o: { pi: string; total: number }) =>
  w.h.sendStripeWebhook({
    type: 'payment_intent.succeeded',
    data: { object: { id: o.pi, object: 'payment_intent', amount: o.total, amount_received: o.total, currency: 'mxn' } },
  });

async function cleanup(w: World | undefined) {
  if (!w) return;
  const items = await w.h.prisma.inventoryItem.findMany({ where: { folio: { startsWith: PREFIX } }, select: { id: true } });
  const ids = items.map((i) => i.id);
  const orders = await w.h.prisma.order.findMany({ where: { items: { some: { inventoryItemId: { in: ids } } } }, select: { id: true } });
  const oids = orders.map((o) => o.id);
  await w.h.prisma.measurementOutbox.deleteMany({ where: { subjectId: { in: oids } } });
  await w.h.prisma.measurementContext.deleteMany({ where: { orderId: { in: oids } } });
  await w.h.prisma.vaultPlacementItem.deleteMany({ where: { orderItem: { orderId: { in: oids } } } });
  await w.h.prisma.vaultPlacement.deleteMany({ where: { orderId: { in: oids } } });
  await w.h.prisma.auditLog.deleteMany({ where: { entityId: { in: oids } } });
  await w.h.prisma.order.deleteMany({ where: { id: { in: oids } } });
  await w.h.prisma.inventoryMovement.deleteMany({ where: { itemId: { in: ids } } });
  await w.h.prisma.inventoryItem.deleteMany({ where: { id: { in: ids } } });
  await w.h.close();
}

const counterRows = (w: World) => w.h.prisma.marketingBannerConsentCounter.findMany({ where: { weekStart: { gte: new Date('2026-01-01') } } });

describe('C-B1 · MEASUREMENT_MODE apagado (ausente) — Postgres real', () => {
  let w: World;
  let fetchSpy: jest.SpyInstance;
  beforeAll(async () => {
    w = await boot({ MEASUREMENT_MODE: undefined });
    await w.h.prisma.marketingBannerConsentCounter.deleteMany({});
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });
  afterAll(async () => {
    fetchSpy?.mockRestore();
    await cleanup(w);
  });

  it('checkout con measurement completo ⇒ consentimiento y firstUtm* NULL, 0 contexto; pagar ⇒ 0 filas de cola; drenar ⇒ 0 red', async () => {
    const o = await checkout(w, FULL);
    const row = await w.h.prisma.order.findUniqueOrThrow({ where: { id: o.orderId } });
    expect([row.measurementConsentAnalytics, row.measurementConsentAds, row.measurementNoticeVersion]).toEqual([null, null, null]);
    expect([row.firstUtmSource, row.firstUtmMedium, row.firstUtmCampaign, row.firstUtmContent, row.firstUtmLandedAt]).toEqual([null, null, null, null, null]);
    expect(await w.h.prisma.measurementContext.count({ where: { orderId: o.orderId } })).toBe(0);
    expect((await pay(w, o)).status).toBe(200);
    expect((await w.h.prisma.order.findUniqueOrThrow({ where: { id: o.orderId } })).status).toBe('settled');
    expect(await w.h.prisma.measurementOutbox.count({ where: { subjectId: o.orderId } })).toBe(0);
    // Aunque haya una fila (sembrada a mano), el drenador apagado no sale a la red.
    await w.h.prisma.measurementOutbox.create({
      data: { kind: 'purchase', destination: 'ga4_mp', subjectId: o.orderId, eventId: `p_${o.orderId}`, expiresAt: new Date(Date.now() + 86_400_000) },
    });
    await w.h.app.get(MeasurementDrainService).run();
    expect(w.http.postJson).not.toHaveBeenCalled();
    expect(fetchSpy.mock.calls.filter(([u]) => /google|facebook/.test(String(u)))).toEqual([]);
  });

  it('banner-response ⇒ 204 sin escribir (con off)', async () => {
    const res = await w.h.api('POST', '/measurement/banner-response', { json: { response: 'accept', utmMedium: 'bio' } });
    expect(res.status).toBe(204);
    expect(await counterRows(w)).toEqual([]);
  });

  it('banner-response sin forma ⇒ 400 VALIDATION_ERROR (también con off)', async () => {
    const res = await w.h.api('POST', '/measurement/banner-response', { json: { response: 'quizá' } });
    expect(res.status).toBe(400);
    expect(res.body.error?.code ?? res.body.code).toBe('VALIDATION_ERROR');
  });

  it('C-B9 · la 31.ª petición en una hora desde la misma IP ⇒ 429 (throttler real)', async () => {
    const prev = process.env.E2E_ENABLE_THROTTLER;
    process.env.E2E_ENABLE_THROTTLER = 'true';
    try {
      const ip = `10.86.${Math.floor(Math.random() * 200)}.7`;
      const codes: number[] = [];
      for (let i = 0; i < 31; i += 1) {
        const r = await w.h.api('POST', '/measurement/banner-response', { json: { response: 'no_response' }, headers: { 'x-forwarded-for': ip } });
        codes.push(r.status);
      }
      expect(codes.slice(0, 30).every((c) => c === 204)).toBe(true);
      expect(codes[30]).toBe(429);
    } finally {
      if (prev === undefined) delete process.env.E2E_ENABLE_THROTTLER;
      else process.env.E2E_ENABLE_THROTTLER = prev;
    }
  });
});

describe('Fase 2 encendida (con dobles HTTP) — Postgres real', () => {
  let w: World;
  beforeAll(async () => {
    w = await boot(ENV_ON);
    await w.h.prisma.marketingBannerConsentCounter.deleteMany({});
  });
  afterAll(async () => cleanup(w));
  beforeEach(() => w.http.postJson.mockClear());

  it('checkout con consentimiento ⇒ columnas en la misma fila y contexto post-commit', async () => {
    const o = await checkout(w, FULL);
    const row = await w.h.prisma.order.findUniqueOrThrow({ where: { id: o.orderId } });
    expect(row).toMatchObject({
      measurementConsentAnalytics: true,
      measurementConsentAds: true,
      measurementNoticeVersion: '2026-11.1',
      firstUtmSource: 'instagram',
      firstUtmMedium: 'paid',
    });
    expect(await w.h.prisma.measurementContext.findUniqueOrThrow({ where: { orderId: o.orderId } })).toMatchObject({ gaClientId: GA, fbp: FBP });
  });

  it('C-B2 · measurement basura ⇒ misma respuesta (201) y columnas NULL', async () => {
    const o = await checkout(w, { consent: 'sí', fbp: 12 });
    const row = await w.h.prisma.order.findUniqueOrThrow({ where: { id: o.orderId } });
    expect(row.measurementConsentAnalytics).toBeNull();
  });

  it('C-B5 · el mismo succeeded entregado 2 veces (dos event.id) ⇒ 1 fila por destino, eventId p_<Order.id>; drenar ⇒ 2 envíos', async () => {
    const o = await checkout(w, FULL);
    expect((await pay(w, o)).status).toBe(200);
    expect((await pay(w, o)).status).toBe(200);
    const rows = await w.h.prisma.measurementOutbox.findMany({ where: { subjectId: o.orderId }, orderBy: { destination: 'asc' } });
    expect(rows.map((r) => [r.destination, r.eventId, r.kind])).toEqual([
      ['ga4_mp', `p_${o.orderId}`, 'purchase'],
      ['meta_capi', `p_${o.orderId}`, 'purchase'],
    ]);
    // Reentrega con el webhook directo (mismo event.id lo absorbe la idempotencia de Stripe; aquí, la del outbox):
    await w.h.app.get(MeasurementService).enqueuePurchase(o.orderId);
    expect(await w.h.prisma.measurementOutbox.count({ where: { subjectId: o.orderId } })).toBe(2);

    await w.h.app.get(MeasurementDrainService).run();
    const urls = w.http.postJson.mock.calls.map((c) => String(c[0]));
    expect(urls.filter((u) => u.startsWith('https://www.google-analytics.com/mp/collect'))).toHaveLength(1);
    expect(urls.filter((u) => u.startsWith('https://graph.facebook.com/'))).toHaveLength(1);
    expect(await w.h.prisma.measurementOutbox.count({ where: { subjectId: o.orderId } })).toBe(0);
  });

  it('C-B4 · analytics=false y ads=false ⇒ solo ga4_mp, sin first_utm_* y con client_id aleatorio', async () => {
    const o = await checkout(w, { ...FULL, consent: { analytics: false, ads: false } });
    await pay(w, o);
    const rows = await w.h.prisma.measurementOutbox.findMany({ where: { subjectId: o.orderId } });
    expect(rows.map((r) => r.destination)).toEqual(['ga4_mp']);
    await w.h.app.get(MeasurementDrainService).run();
    const call = w.http.postJson.mock.calls.find((c) => String(c[0]).includes('google-analytics'))!;
    const body = call[1] as { client_id: string; events: { params: Record<string, unknown> }[] };
    expect(body.client_id).not.toBe(GA);
    expect(Object.keys(body.events[0].params).filter((k) => k.startsWith('first_utm'))).toEqual([]);
  });

  it('🔒💰 C-B2 · con el encolado LANZANDO, el webhook responde 200 y liquida (orden settled, pieza in_custody)', async () => {
    const o = await checkout(w, FULL);
    const spy = jest.spyOn(w.h.app.get(MeasurementService), 'enqueuePurchase').mockRejectedValue(new Error('BD de medición caída'));
    try {
      expect((await pay(w, o)).status).toBe(200);
    } finally {
      spy.mockRestore();
    }
    expect((await w.h.prisma.order.findUniqueOrThrow({ where: { id: o.orderId } })).status).toBe('settled');
    expect((await w.h.prisma.inventoryItem.findUniqueOrThrow({ where: { id: o.itemId } })).status).toBe('in_custody');
    expect(await w.h.prisma.measurementOutbox.count({ where: { subjectId: o.orderId } })).toBe(0);
  });

  it('generate_lead: solicitud con consentimiento ⇒ fila l_<SellRequest.id> (encolado de servidor)', async () => {
    const sr = await w.h.prisma.sellRequest.create({
      data: { userId: w.userId, status: 'cotizada', quotedTotalCents: 12345, measurementConsentAnalytics: true, measurementConsentAds: false },
    });
    try {
      await w.h.app.get(MeasurementService).enqueueLead(sr.id);
      const rows = await w.h.prisma.measurementOutbox.findMany({ where: { subjectId: sr.id } });
      expect(rows.map((r) => [r.kind, r.destination, r.eventId])).toEqual([['generate_lead', 'ga4_mp', `l_${sr.id}`]]);
    } finally {
      await w.h.prisma.measurementOutbox.deleteMany({ where: { subjectId: sr.id } });
      await w.h.prisma.sellRequest.delete({ where: { id: sr.id } });
    }
  });

  it('C-B8 · purga: cola y contexto con expiresAt vencido ⇒ borrados; los vigentes se quedan', async () => {
    const past = new Date(Date.now() - 1000);
    const future = new Date(Date.now() + 86_400_000);
    const later = new Date(Date.now() + 3_600_000);
    await w.h.prisma.measurementOutbox.createMany({
      data: [
        { kind: 'purchase', destination: 'ga4_mp', subjectId: `${PREFIX}old`, eventId: `p_${PREFIX}old`, expiresAt: past },
        { kind: 'purchase', destination: 'ga4_mp', subjectId: `${PREFIX}new`, eventId: `p_${PREFIX}new`, expiresAt: future, nextAttemptAt: later },
      ],
    });
    await w.h.prisma.measurementContext.createMany({
      data: [
        { orderId: `${PREFIX}old`, expiresAt: past },
        { orderId: `${PREFIX}new`, expiresAt: future },
      ],
    });
    await w.h.app.get(MeasurementDrainService).run();
    expect((await w.h.prisma.measurementOutbox.findMany({ where: { subjectId: { startsWith: PREFIX } } })).map((r) => r.subjectId)).toEqual([`${PREFIX}new`]);
    expect((await w.h.prisma.measurementContext.findMany({ where: { orderId: { startsWith: PREFIX } } })).map((r) => r.orderId)).toEqual([`${PREFIX}new`]);
    await w.h.prisma.measurementOutbox.deleteMany({ where: { subjectId: { startsWith: PREFIX } } });
    await w.h.prisma.measurementContext.deleteMany({ where: { orderId: { startsWith: PREFIX } } });
  });

  it('C-B9 · banner-response on: utmMedium fuera de los cuatro ⇒ NULL; dos respuestas en la misma celda NULL ⇒ UNA fila con count 2; el UA no se guarda', async () => {
    const ua = { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Instagram 300' };
    for (const utmMedium of ['newsletter', undefined]) {
      const r = await w.h.api('POST', '/measurement/banner-response', { json: { response: 'custom', ...(utmMedium ? { utmMedium } : {}) }, headers: ua });
      expect(r.status).toBe(204);
    }
    expect((await w.h.api('POST', '/measurement/banner-response', { json: { response: 'accept', utmMedium: 'story' }, headers: ua })).status).toBe(204);
    const rows = await counterRows(w);
    const custom = rows.filter((r) => r.response === 'custom');
    expect(custom.map((r) => [r.utmMedium, r.device, r.count])).toEqual([[null, 'móvil', 2]]);
    expect(rows.filter((r) => r.response === 'accept').map((r) => [r.utmMedium, r.device, r.count])).toEqual([['story', 'móvil', 1]]);
    expect(JSON.stringify(rows)).not.toContain('iPhone');
  });

  it('§13.4.4 · retención del registro de accesos: una fila de 13 meses y otra de 11 ⇒ queda solo la de 11', async () => {
    const now = new Date();
    const monthsAgo = (m: number) => {
      const d = new Date(now.getTime());
      d.setUTCMonth(d.getUTCMonth() - m);
      return d;
    };
    const screen = `rt-${RUN}`;
    await w.h.prisma.marketingAccessLog.createMany({
      data: [
        { screen, at: monthsAgo(13), format: 'json' },
        { screen, at: monthsAgo(11), format: 'json' },
      ],
    });
    await w.h.app.get(MarketingAccessLogService).purgeExpired(now);
    const left = await w.h.prisma.marketingAccessLog.findMany({ where: { screen } });
    expect(left.map((r) => r.at.toISOString())).toEqual([monthsAgo(11).toISOString()]);
    await w.h.prisma.marketingAccessLog.deleteMany({ where: { screen } });
  });

  it('el planificador enruta measurement-drain y marketing-access-log-retention (mismo camino que el cron)', async () => {
    const { SchedulerService } = await import('../../src/jobs/scheduler.service');
    const sched = w.h.app.get(SchedulerService);
    await expect(sched.process({ name: 'measurement-drain' })).resolves.toMatchObject({ sent: expect.any(Number) });
    await expect(sched.process({ name: 'marketing-access-log-retention' })).resolves.toEqual(expect.any(Number));
  });
});
