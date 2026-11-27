/**
 * §ORIGEN-VISITA (docs/API_CONTRACT_ORIGEN.md CV-1, CV-4, CV-5, CV-7, CV-8) contra Postgres REAL y la app Nest completa.
 *
 *  CV-1  checkout con cuenta, SIN medición ni cookies: `visitOrigin` utm ⇒ `visitUtm*` escritos, `firstUtm*` NULL.
 *  CV-2  (parcial: solo la cara servidor) referrer del enum ⇒ `visitReferrer`; sin utm ⇒ sin `visitUtm*`.
 *  CV-4  payloads inválidos ⇒ 201, misma forma de respuesta, campos inválidos NULL, el resto vale.
 *  CV-5  con medición `on` y consentimiento ⇒ se guardan AMBOS (`firstUtm*` y `visit*`) sin pisarse.
 *  CV-7  reintento: reusar la orden conserva lo ya escrito (otro `visitOrigin` NO sobrescribe).
 *  CV-8  checkout de invitado y solicitud de buylist escriben igual.
 *  Aislamiento: ningún `visit*` en `MeasurementContext` ni en la cola de medición.
 */
import { E2EHarness } from './helpers/e2e-app';
import { E2E_FOLIOS, E2E_USERS } from '../../prisma/e2e-fixtures';
import { seedE2E } from '../../prisma/seed-e2e';
import { MeasurementService } from '../../src/modules/measurement/measurement.service';
import { MEASUREMENT_HTTP, type MeasurementHttp } from '../../src/modules/measurement/measurement-http';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

const RUN = Date.now().toString(36);
const PREFIX = `E2E-OV-${RUN}-`;
const SET_ID = `e2e-ov-set-${RUN}`;
const CARD_ID = `e2e-ov-card-${RUN}`;
const ADDRESS = {
  line1: 'Av. Reforma 100', neighborhood: 'Juárez', city: 'Ciudad de México', state: 'CDMX', postalCode: '06600', country: 'MX',
  phone: '5512345678', recipientName: 'Juan Pérez López',
};
const NULL_VISIT = { visitUtmSource: null, visitUtmMedium: null, visitUtmCampaign: null, visitUtmContent: null, visitReferrer: null };
const VISIT_SELECT = { visitUtmSource: true, visitUtmMedium: true, visitUtmCampaign: true, visitUtmContent: true, visitReferrer: true } as const;

type Env = Record<string, string | undefined>;
async function boot(env: Env) {
  const http = { postJson: jest.fn(async (): Promise<number | null> => 204), postMetaDiagnostic: jest.fn() } as unknown as MeasurementHttp;
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
  await seedE2E(h.prisma);
  const seed = await h.prisma.user.findUniqueOrThrow({ where: { email: E2E_USERS.customer.email } });
  const email = `ov.${RUN}.${Math.random().toString(36).slice(2, 7)}@e2e.local`;
  const u = await h.prisma.user.create({
    data: { email, passwordHash: seed.passwordHash, name: 'E2E OV', role: 'customer', locale: 'es', phone: seed.phone, emailVerified: true },
  });
  const token = await h.login(email, E2E_USERS.customer.password);
  const template = await h.prisma.inventoryItem.findUniqueOrThrow({ where: { folio: E2E_FOLIOS.listedCharizard } });
  return { h, token, userId: u.id, email, template };
}
type World = Awaited<ReturnType<typeof boot>>;

let seq = 0;
const piece = (w: World) =>
  w.h.prisma.inventoryItem.create({
    data: {
      folio: `${PREFIX}${(seq += 1)}`, cardId: w.template.cardId, productType: 'raw', rawCondition: 'NM', finish: 'normal', ownerType: 'platform',
      status: 'listed', acquisitionType: 'compra', acquisitionCostCents: 70000, locationId: w.template.locationId,
    },
  });

async function cleanup(w: World | undefined) {
  if (!w) return;
  const items = await w.h.prisma.inventoryItem.findMany({ where: { folio: { startsWith: PREFIX } }, select: { id: true } });
  const ids = items.map((i) => i.id);
  const orders = await w.h.prisma.order.findMany({ where: { items: { some: { inventoryItemId: { in: ids } } } }, select: { id: true } });
  const oids = orders.map((o) => o.id);
  await w.h.prisma.measurementOutbox.deleteMany({ where: { subjectId: { in: oids } } });
  await w.h.prisma.measurementContext.deleteMany({ where: { orderId: { in: oids } } });
  await w.h.prisma.auditLog.deleteMany({ where: { entityId: { in: oids } } });
  await w.h.prisma.order.deleteMany({ where: { id: { in: oids } } });
  await w.h.prisma.inventoryMovement.deleteMany({ where: { itemId: { in: ids } } });
  await w.h.prisma.inventoryItem.deleteMany({ where: { id: { in: ids } } });
  await w.h.close();
}

const session = async (w: World, extra: Record<string, unknown>, ids?: string[]) => {
  const itemIds = ids ?? [(await piece(w)).id];
  const res = await w.h.api('POST', '/checkout/session', { token: w.token, json: { inventoryItemIds: itemIds, ...extra } });
  return { res, itemIds };
};
const orderOf = (w: World, id: string) => w.h.prisma.order.findUniqueOrThrow({ where: { id } });

describe('§ORIGEN-VISITA · medición apagada (sin cookies ni banner) — Postgres real', () => {
  let w: World;
  beforeAll(async () => {
    w = await boot({ MEASUREMENT_MODE: undefined });
  });
  afterAll(() => cleanup(w));

  it('CV-1 · utm de la visita ⇒ visitUtm* escritos; firstUtm* y consentimiento NULL; sin contexto de medición', async () => {
    const { res } = await session(w, { visitOrigin: { utmSource: 'Instagram', utmMedium: 'social', utmCampaign: 'otono-26', utmContent: 'reel.1' } });
    expect(res.status).toBe(201);
    const o = await orderOf(w, res.body.orderId);
    expect(o).toMatchObject({
      visitUtmSource: 'instagram', visitUtmMedium: 'social', visitUtmCampaign: 'otono-26', visitUtmContent: 'reel.1', visitReferrer: null,
      firstUtmSource: null, firstUtmMedium: null, measurementConsentAnalytics: null,
    });
    expect(await w.h.prisma.measurementContext.count({ where: { orderId: o.id } })).toBe(0);
    expect(await w.h.prisma.measurementOutbox.count({ where: { subjectId: o.id } })).toBe(0);
  });

  it('CV-2 (servidor) · solo referrer del enum ⇒ visitReferrer y sin visitUtm*; `directo` se guarda (≠ NULL)', async () => {
    for (const referrer of ['gemini', 'directo', 'otro']) {
      const { res } = await session(w, { visitOrigin: { referrer } });
      expect(res.status).toBe(201);
      expect(await w.h.prisma.order.findUniqueOrThrow({ where: { id: res.body.orderId }, select: VISIT_SELECT })).toEqual({ ...NULL_VISIT, visitReferrer: referrer });
    }
  });

  it('sin visitOrigin ⇒ todo NULL (NULL = sin dato, no `directo`)', async () => {
    const { res } = await session(w, {});
    expect(res.status).toBe(201);
    expect(await w.h.prisma.order.findUniqueOrThrow({ where: { id: res.body.orderId }, select: VISIT_SELECT })).toEqual(NULL_VISIT);
  });

  it.each([
    ['arreglo', [{ utmSource: 'instagram' }]],
    ['cadena', 'instagram'],
    ['número', 7],
    ['utm con @, 200 caracteres y referrer fuera del enum', { utmSource: 'juan@correo.com', utmMedium: 'x'.repeat(200), referrer: 'evil.com' }],
    ['tipos raros', { utmSource: 5, utmMedium: { a: 1 }, utmCampaign: ['x'], referrer: 3 }],
  ])('CV-4 · %s ⇒ 201, misma forma de respuesta que sin él, campos NULL', async (_n, visitOrigin) => {
    const base = await session(w, {});
    const { res } = await session(w, { visitOrigin });
    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(Object.keys(base.res.body).sort());
    expect(await w.h.prisma.order.findUniqueOrThrow({ where: { id: res.body.orderId }, select: VISIT_SELECT })).toEqual(NULL_VISIT);
  });

  it('CV-4 · mezcla: lo inválido se descarta campo a campo y lo válido vale', async () => {
    const { res } = await session(w, { visitOrigin: { utmSource: 'juan@correo.com', utmMedium: 'social', referrer: 'evil.com', gclid: 'zzz', url: 'https://x.mx/?a=1' } });
    expect(res.status).toBe(201);
    expect(await w.h.prisma.order.findUniqueOrThrow({ where: { id: res.body.orderId }, select: VISIT_SELECT })).toEqual({ ...NULL_VISIT, visitUtmMedium: 'social' });
  });

  it('CV-7 · reintento con las mismas piezas ⇒ 200 reused, UNA orden, y el origen escrito no se sobrescribe', async () => {
    const first = await session(w, { visitOrigin: { utmSource: 'instagram', utmMedium: 'social' } });
    expect(first.res.status).toBe(201);
    const again = await session(w, { visitOrigin: { utmSource: 'facebook', referrer: 'google' } }, first.itemIds);
    expect(again.res.status).toBe(200);
    expect(again.res.body.orderId).toBe(first.res.body.orderId);
    expect(await w.h.prisma.order.findUniqueOrThrow({ where: { id: first.res.body.orderId }, select: VISIT_SELECT })).toEqual({
      ...NULL_VISIT, visitUtmSource: 'instagram', visitUtmMedium: 'social',
    });
  });

  it('CV-8 · checkout de invitado escribe igual', async () => {
    const it = await piece(w);
    const res = await w.h.api('POST', '/checkout/guest/session', {
      json: {
        inventoryItemIds: [it.id], email: `invitado.ov.${RUN}@example.com`, shippingAddress: ADDRESS, acceptedTerms: true, locale: 'es',
        visitOrigin: { utmSource: 'instagram', utmMedium: 'social', referrer: 'evil.com' },
      },
    });
    expect(res.status).toBe(201);
    expect(await w.h.prisma.order.findUniqueOrThrow({ where: { id: res.body.orderId }, select: { ...VISIT_SELECT, firstUtmSource: true } })).toEqual({
      ...NULL_VISIT, visitUtmSource: 'instagram', visitUtmMedium: 'social', firstUtmSource: null,
    });
  });

  it('CV-8 · solicitud de buylist escribe igual y un visitOrigin roto no cambia la respuesta', async () => {
    await w.h.prisma.cardSet.create({ data: { id: SET_ID, externalId: SET_ID, name: 'E2E OV' } });
    await w.h.prisma.card.create({
      data: { id: CARD_ID, externalId: CARD_ID, setId: SET_ID, name: 'OV carta', number: '1', rarity: 'Rare Holo', availableFinishes: ['normal'] },
    });
    await w.h.prisma.priceReference.create({
      data: {
        cardId: CARD_ID, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', source: 'manual', priceMxnCents: 100_000,
        capturedDate: new Date('2026-09-27T00:00:00.000Z'), isManualOverride: true, refKind: 'market',
      },
    });
    const address = await w.h.prisma.address.findFirstOrThrow({ where: { user: { email: E2E_USERS.customer.email } } });
    const adr = await w.h.prisma.address.create({
      data: { userId: w.userId, recipientName: address.recipientName, line1: address.line1, neighborhood: address.neighborhood, city: address.city, state: address.state, postalCode: address.postalCode, country: address.country, phone: address.phone },
    });
    const body = (extra: Record<string, unknown>) => ({ items: [{ cardId: CARD_ID, productType: 'raw', rawCondition: 'NM' }], clabe: '012345678901234567', addressId: adr.id, ...extra });
    const ok = await w.h.api('POST', '/buylist/requests', { token: w.token, json: body({ visitOrigin: { utmSource: 'instagram', utmMedium: 'social' } }) });
    expect(ok.status).toBe(201);
    expect(await w.h.prisma.sellRequest.findUniqueOrThrow({ where: { id: ok.body.sellRequestId }, select: { ...VISIT_SELECT, firstUtmSource: true } })).toEqual({
      ...NULL_VISIT, visitUtmSource: 'instagram', visitUtmMedium: 'social', firstUtmSource: null,
    });
    const rota = await w.h.api('POST', '/buylist/requests', { token: w.token, json: body({ visitOrigin: [1, 2, 3] }) });
    expect(rota.status).toBe(201);
    expect(Object.keys(rota.body).sort()).toEqual(Object.keys(ok.body).sort());
    expect(await w.h.prisma.sellRequest.findUniqueOrThrow({ where: { id: rota.body.sellRequestId }, select: VISIT_SELECT })).toEqual(NULL_VISIT);
    await w.h.prisma.sellRequest.deleteMany({ where: { items: { some: { cardId: CARD_ID } } } });
    await w.h.prisma.priceReference.deleteMany({ where: { cardId: CARD_ID } });
    await w.h.prisma.card.deleteMany({ where: { id: CARD_ID } });
    await w.h.prisma.cardSet.deleteMany({ where: { id: SET_ID } });
    await w.h.prisma.address.deleteMany({ where: { id: adr.id } });
  });
});

describe('§ORIGEN-VISITA · medición encendida con consentimiento (CV-5) — Postgres real', () => {
  let w: World;
  beforeAll(async () => {
    w = await boot({ MEASUREMENT_MODE: 'on', GA4_MEASUREMENT_ID: 'G-ABC123XYZ9', META_PIXEL_ID: '123456789012345' });
  });
  afterAll(() => cleanup(w));

  it('CV-5 · con th_first_utm aceptado se guardan AMBOS sin pisarse; visit* no entra al contexto de medición', async () => {
    const { res } = await session(w, {
      measurement: {
        consent: { analytics: true, ads: false }, noticeVersion: '2026-11.1',
        firstUtm: { source: 'tiktok', medium: 'bio', campaign: 'nov', content: 'reel-1' },
      },
      visitOrigin: { utmSource: 'instagram', utmMedium: 'social' },
    });
    expect(res.status).toBe(201);
    const o = await orderOf(w, res.body.orderId);
    expect(o).toMatchObject({ firstUtmSource: 'tiktok', firstUtmMedium: 'bio', visitUtmSource: 'instagram', visitUtmMedium: 'social', measurementConsentAnalytics: true });
    const ctx = await w.h.prisma.measurementContext.findMany({ where: { orderId: o.id } });
    expect(JSON.stringify(ctx)).not.toMatch(/visit|instagram/i);
    expect(JSON.stringify(await w.h.prisma.measurementOutbox.findMany({ where: { subjectId: o.id } }))).not.toMatch(/visit/i);
  });

  it('con medición `on` pero SIN consentimiento el origen de visita se guarda igual (independiente del banner)', async () => {
    const { res } = await session(w, { measurement: { consent: { analytics: false, ads: false }, noticeVersion: '2026-11.1' }, visitOrigin: { referrer: 'chatgpt' } });
    expect(res.status).toBe(201);
    expect(await w.h.prisma.order.findUniqueOrThrow({ where: { id: res.body.orderId }, select: { ...VISIT_SELECT, firstUtmSource: true } })).toEqual({
      ...NULL_VISIT, visitReferrer: 'chatgpt', firstUtmSource: null,
    });
  });
});
