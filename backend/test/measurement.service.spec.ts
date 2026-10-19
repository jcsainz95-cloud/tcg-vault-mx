/**
 * `MeasurementService` — C-B1 (off), C-B4 (qué destino se encola según consentimiento), C-B5 (idempotencia y `event_id`),
 * C-B7 (destino deshabilitado ⇒ 0 filas). API_CONTRACT §MKT.H.6/.11; tabla de ARCHITECTURE §14.6.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';
import { MeasurementService } from '../src/modules/measurement/measurement.service';
import { FBC, FBP, GA_CLIENT, fakeConfig, fullEnv, type Env } from './helpers/measurement-fixtures';
import { measurementPrismaDouble } from './helpers/measurement-prisma-double';

const NOW = new Date('2026-10-18T18:00:00.000Z');

function world(env: Env, consent: { a: boolean | null; m: boolean | null }, ctx: Record<string, unknown> | null) {
  const d = measurementPrismaDouble({
    orders: [{ id: 'o1', measurementConsentAnalytics: consent.a, measurementConsentAds: consent.m }],
    sellRequests: [{ id: 's1', measurementConsentAnalytics: consent.a, measurementConsentAds: consent.m }],
    contexts: ctx ? [{ orderId: 'o1', ...ctx }, { sellRequestId: 's1', ...ctx }] : [],
  });
  return { d, svc: new MeasurementService(d.prisma as never, fakeConfig(env)) };
}

describe('C-B1 · con MEASUREMENT_MODE off no se escribe nada', () => {
  it.each([[undefined], [''], ['ON']])('modo %p: prepare ⇒ nada; saveContext/enqueue ⇒ 0 escrituras y 0 lecturas', async (mode) => {
    const { d, svc } = world(fullEnv({ MEASUREMENT_MODE: mode }), { a: true, m: true }, { fbp: FBP });
    const full = { consent: { analytics: true, ads: true }, noticeVersion: 'v1', firstUtm: { source: 'ig' }, gaClientId: GA_CLIENT, fbp: FBP };
    expect(svc.prepare(full, NOW)).toEqual({ columns: {}, context: null });
    await svc.saveContext({ orderId: 'o1' }, { fbp: FBP }, NOW);
    expect(await svc.enqueuePurchase('o1', NOW)).toBe(0);
    expect(await svc.enqueueLead('s1', NOW)).toBe(0);
    expect(d.prisma.measurementContext.createMany).not.toHaveBeenCalled();
    expect(d.prisma.measurementOutbox.createMany).not.toHaveBeenCalled();
    expect(d.prisma.order.findUnique).not.toHaveBeenCalled();
    expect(d.outbox).toHaveLength(0);
  });
});

describe('C-B4 · destinos por consentimiento (tabla §14.6)', () => {
  const dests = (d: ReturnType<typeof world>['d']) => d.outbox.map((r) => r.destination).sort();
  it.each<[string, { a: boolean | null; m: boolean | null }, Record<string, unknown> | null, string[]]>([
    ['consentimiento NULL (modo off al crear) ⇒ nada', { a: null, m: null }, { fbp: FBP }, []],
    ['todo denegado ⇒ solo GA4 (client_id aleatorio)', { a: false, m: false }, null, ['ga4_mp']],
    ['solo analítica ⇒ solo GA4', { a: true, m: false }, { gaClientId: GA_CLIENT }, ['ga4_mp']],
    ['ads=false aunque haya fbp ⇒ 0 filas meta', { a: true, m: false }, { fbp: FBP, fbc: FBC }, ['ga4_mp']],
    ['ads=true SIN fbp ni fbc ⇒ 0 filas meta', { a: true, m: true }, { gaClientId: GA_CLIENT }, ['ga4_mp']],
    ['ads=true con fbp ⇒ GA4 + Meta', { a: false, m: true }, { fbp: FBP }, ['ga4_mp', 'meta_capi']],
    ['ads=true con fbc ⇒ GA4 + Meta', { a: true, m: true }, { fbc: FBC }, ['ga4_mp', 'meta_capi']],
  ])('%s', async (_n, consent, ctx, expected) => {
    const p = world(fullEnv(), consent, ctx);
    await p.svc.enqueuePurchase('o1', NOW);
    expect(dests(p.d)).toEqual(expected);
    const l = world(fullEnv(), consent, ctx);
    await l.svc.enqueueLead('s1', NOW);
    expect(dests(l.d)).toEqual(expected);
  });
});

describe('C-B7 · destino deshabilitado ⇒ 0 filas de ese destino', () => {
  it('on sin META_CAPI_TOKEN y con publicidad + fbp ⇒ solo ga4_mp', async () => {
    const { d, svc } = world(fullEnv({ META_CAPI_TOKEN: undefined }), { a: true, m: true }, { fbp: FBP });
    await svc.enqueuePurchase('o1', NOW);
    expect(d.outbox.map((r) => r.destination)).toEqual(['ga4_mp']);
  });
  it('on sin GA4 ni Meta ⇒ 0 filas (y no lanza)', async () => {
    const { d, svc } = world(fullEnv({ GA4_MP_API_SECRET: undefined, META_PIXEL_ID: undefined }), { a: true, m: true }, { fbp: FBP });
    expect(await svc.enqueuePurchase('o1', NOW)).toBe(0);
    expect(d.outbox).toHaveLength(0);
  });
});

describe('C-B5 · idempotencia: una fila por destino y `event_id` determinista', () => {
  it('encolar la misma compra dos veces ⇒ 1 fila por destino; eventId = p_<Order.id>; caduca a los 7 días', async () => {
    const { d, svc } = world(fullEnv(), { a: true, m: true }, { fbp: FBP });
    await svc.enqueuePurchase('o1', NOW);
    await svc.enqueuePurchase('o1', NOW);
    expect(d.outbox).toHaveLength(2);
    expect(new Set(d.outbox.map((r) => r.eventId))).toEqual(new Set(['p_o1']));
    expect(d.outbox.every((r) => r.expiresAt.getTime() === NOW.getTime() + 7 * 24 * 3600 * 1000)).toBe(true);
    expect(d.prisma.measurementOutbox.createMany.mock.calls.every((c) => c[0].skipDuplicates === true)).toBe(true);
  });
  it('solicitud: eventId = l_<SellRequest.id>, kind generate_lead', async () => {
    const { d, svc } = world(fullEnv(), { a: true, m: false }, null);
    await svc.enqueueLead('s1', NOW);
    expect(d.outbox.map((r) => [r.kind, r.destination, r.eventId, r.subjectId])).toEqual([['generate_lead', 'ga4_mp', 'l_s1', 's1']]);
  });
});

describe('§MKT.H.2 · saveContext es best-effort', () => {
  it('si la BD falla, no lanza y no registra valores', async () => {
    const { d, svc } = world(fullEnv(), { a: true, m: true }, null);
    d.prisma.measurementContext.createMany.mockRejectedValueOnce(new Error(`dup ${FBP}`));
    await expect(svc.saveContext({ orderId: 'o1' }, { fbp: FBP }, NOW)).resolves.toBeUndefined();
  });
});

describe('v1.105 §MKT.H.13 · MeasurementContext sin `sourcePath` (cierra MKT-F2-2)', () => {
  it('el modelo generado y el SQL de m86 no tienen la columna; saveContext no la escribe', async () => {
    const model = Prisma.dmmf.datamodel.models.find((m) => m.name === 'MeasurementContext')!;
    expect(model.fields.map((f) => f.name)).not.toContain('sourcePath');
    const sql = readFileSync(join(__dirname, '../prisma/migrations/20261106120000_m86_mkt_measurement/migration.sql'), 'utf8');
    expect(sql).not.toMatch(/sourcePath/);
    const { d, svc } = world(fullEnv(), { a: true, m: true }, null);
    await svc.saveContext({ orderId: 'o1' }, { fbp: FBP }, NOW);
    expect(Object.keys(d.prisma.measurementContext.createMany.mock.calls[0][0].data[0]).sort()).toEqual(['expiresAt', 'fbc', 'fbp', 'gaClientId', 'orderId']);
  });
});
