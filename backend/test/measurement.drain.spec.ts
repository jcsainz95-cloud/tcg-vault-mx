/**
 * Drenador `measurement-drain` — C-B1 (off ⇒ 0 peticiones salientes), C-B6 (logs sin secretos ni cuerpo), C-B8 (purga) y la
 * escalera de reintentos (API_CONTRACT §MKT.H.6/.11).
 *
 * El candado clave del encargo: «modo off ⇒ 0 peticiones salientes a hosts de Google/Meta y 0 filas en outbox». Aquí la mitad
 * de red: con filas en la cola y `off`, ni el doble HTTP ni `fetch` global se llaman. Canario: leer el modo con `!== 'off'`.
 */
import { Logger } from '@nestjs/common';
import { MeasurementService } from '../src/modules/measurement/measurement.service';
import { DRAIN_BATCH, DRAIN_BUDGET_MS, DRAIN_TIMEOUT_MS, MeasurementDrainService, RETRY_LADDER_MS } from '../src/modules/measurement/measurement-drain.service';
import type { MeasurementHttp } from '../src/modules/measurement/measurement-http';
import { CAPI_TOKEN, FBC, FBP, GA4_SECRET, GA_CLIENT, PIXEL, fakeConfig, fullEnv, type Env } from './helpers/measurement-fixtures';
import { measurementPrismaDouble } from './helpers/measurement-prisma-double';

const NOW = new Date('2026-10-18T18:00:00.000Z');
const order = {
  id: 'o1',
  totalCents: 1000,
  shippingFeeCents: 0,
  settledAt: NOW,
  measurementConsentAnalytics: true,
  measurementConsentAds: true,
  firstUtmSource: 'ig',
  firstUtmMedium: null,
  firstUtmCampaign: null,
  firstUtmContent: null,
  items: [{ cardSnapshot: { cardId: 'c1', name: 'Pikachu', productType: 'raw' }, unitPriceCents: 1000 }],
  accessoryLines: [],
};

function world(env: Env, statuses: (number | null)[] = [204, 204]) {
  const d = measurementPrismaDouble({
    orders: [order],
    contexts: [{ orderId: 'o1', gaClientId: GA_CLIENT, fbp: FBP, fbc: FBC }],
    outbox: [
      { kind: 'purchase', destination: 'ga4_mp', subjectId: 'o1', eventId: 'p_o1' },
      { kind: 'purchase', destination: 'meta_capi', subjectId: 'o1', eventId: 'p_o1' },
    ] as never,
  });
  const queue = [...statuses];
  const http: MeasurementHttp = { postJson: jest.fn(async () => (queue.length ? queue.shift()! : 204)) };
  const svc = new MeasurementService(d.prisma as never, fakeConfig(env));
  return { d, http, drain: new MeasurementDrainService(d.prisma as never, svc, http) };
}

describe('C-B1 · off ⇒ el drenador NO sale a la red', () => {
  let fetchSpy: jest.SpyInstance;
  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('red prohibida en esta prueba');
    });
  });
  afterEach(() => fetchSpy.mockRestore());

  it.each([[undefined], [''], ['ON'], ['true']])('modo %p con 2 filas en cola ⇒ 0 llamadas al puerto HTTP y 0 a fetch; filas intactas', async (mode) => {
    const w = world(fullEnv({ MEASUREMENT_MODE: mode }));
    const r = await w.drain.run(NOW);
    expect(w.http.postJson).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(r.sent).toBe(0);
    expect(w.d.outbox).toHaveLength(2);
  });

  it('también con el puerto por defecto (fetch real): off ⇒ fetch nunca se llama', async () => {
    const d = measurementPrismaDouble({ orders: [order], outbox: [{ kind: 'purchase', destination: 'ga4_mp', subjectId: 'o1', eventId: 'p_o1' }] as never });
    const svc = new MeasurementService(d.prisma as never, fakeConfig(fullEnv({ MEASUREMENT_MODE: 'off' })));
    await new MeasurementDrainService(d.prisma as never, svc).run(NOW);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('on (control): sí envía las dos y borra las filas', async () => {
    const w = world(fullEnv());
    const r = await w.drain.run(NOW);
    expect(w.http.postJson).toHaveBeenCalledTimes(2);
    expect(r.sent).toBe(2);
    expect(w.d.outbox).toHaveLength(0);
  });

  it('on con un destino deshabilitado ⇒ su fila espera (no sale) y caduca', async () => {
    const w = world(fullEnv({ META_CAPI_TOKEN: undefined }));
    await w.drain.run(NOW);
    expect(w.http.postJson).toHaveBeenCalledTimes(1);
    expect((w.http.postJson as jest.Mock).mock.calls[0][0]).toMatch(/^https:\/\/www\.google-analytics\.com\//);
    expect(w.d.outbox.map((r) => r.destination)).toEqual(['meta_capi']);
  });
});

describe('TL-MKT2-R2 · un destino apagado NO bloquea la cola de los demás', () => {
  it('60 filas meta_capi (destino apagado, más antiguas) + 1 ga4_mp ⇒ la de GA4 sale en esta corrida', async () => {
    const old = new Date(NOW.getTime() - 3_600_000);
    const outbox = [
      ...Array.from({ length: 60 }, (_, i) => ({ kind: 'purchase', destination: 'meta_capi', subjectId: 'o1', eventId: `p_m${i}`, nextAttemptAt: old })),
      { kind: 'purchase', destination: 'ga4_mp', subjectId: 'o1', eventId: 'p_o1', nextAttemptAt: NOW },
    ];
    const d = measurementPrismaDouble({ orders: [order], contexts: [{ orderId: 'o1', gaClientId: GA_CLIENT, fbp: FBP, fbc: FBC }], outbox: outbox as never });
    const http: MeasurementHttp = { postJson: jest.fn(async () => 204) };
    const svc = new MeasurementService(d.prisma as never, fakeConfig(fullEnv({ META_CAPI_TOKEN: undefined })));
    const r = await new MeasurementDrainService(d.prisma as never, svc, http).run(NOW);
    expect(http.postJson).toHaveBeenCalledTimes(1);
    expect((http.postJson as jest.Mock).mock.calls[0][0]).toMatch(/^https:\/\/www\.google-analytics\.com\//);
    expect(r.sent).toBe(1);
    expect(d.outbox.filter((x) => x.destination === 'meta_capi')).toHaveLength(60);
    expect(d.prisma.measurementOutbox.findMany.mock.calls[0][0].where.destination).toEqual({ in: ['ga4_mp'] });
  });

  it('ambos destinos apagados (modo on) ⇒ ni siquiera se lee el lote', async () => {
    const w = world(fullEnv({ META_CAPI_TOKEN: undefined, GA4_MP_API_SECRET: undefined }));
    await w.drain.run(NOW);
    expect(w.d.prisma.measurementOutbox.findMany).not.toHaveBeenCalled();
    expect(w.http.postJson).not.toHaveBeenCalled();
  });
});

describe('TL-MKT2-D2 · presupuesto de tiempo por corrida (el worker tcg-daily es compartido)', () => {
  it('50 filas cuyo envío agota el timeout (5 s c/u) ⇒ la corrida no pasa de DRAIN_BUDGET_MS; el resto queda sin reclamar para la siguiente', async () => {
    const outbox = Array.from({ length: DRAIN_BATCH }, (_, i) => ({ kind: 'purchase', destination: 'ga4_mp', subjectId: 'o1', eventId: `p_${i}` }));
    const d = measurementPrismaDouble({ orders: [order], contexts: [{ orderId: 'o1', gaClientId: GA_CLIENT }], outbox: outbox as never });
    let t = 0;
    const http: MeasurementHttp = { postJson: jest.fn(async () => ((t += DRAIN_TIMEOUT_MS), null)) };
    const svc = new MeasurementService(d.prisma as never, fakeConfig(fullEnv()));
    const drain = new MeasurementDrainService(d.prisma as never, svc, http);
    drain.clock = () => t;
    const r = await drain.run(NOW);
    const started = Math.floor(DRAIN_BUDGET_MS / DRAIN_TIMEOUT_MS);
    expect(t).toBeLessThanOrEqual(DRAIN_BUDGET_MS);
    expect(http.postJson).toHaveBeenCalledTimes(started);
    expect([r.retried, r.deferred]).toEqual([started, DRAIN_BATCH - started]);
    // Las aplazadas no se reclamaron: siguen elegibles YA (nextAttemptAt intacto), y la corrida siguiente las toma.
    expect(d.outbox.filter((x) => x.nextAttemptAt.getTime() <= NOW.getTime())).toHaveLength(DRAIN_BATCH - started);
    t = 0;
    const r2 = await drain.run(NOW);
    expect(r2.retried).toBe(started);
  });

  it('control: envíos rápidos ⇒ el lote entero sale en una corrida (deferred 0)', async () => {
    const w = world(fullEnv());
    w.drain.clock = () => 0;
    const r = await w.drain.run(NOW);
    expect([r.sent, r.deferred]).toEqual([2, 0]);
  });
});

describe('§MKT.H.6 · respuesta ⇒ qué pasa con la fila', () => {
  it('5xx / red / 429 ⇒ attempts+1 y escalera 1 min, 5 min, 30 min, 2 h, 12 h; otro 4xx ⇒ se borra', async () => {
    const w = world(fullEnv(), [500, 400]);
    await w.drain.run(NOW);
    expect(w.d.outbox).toHaveLength(1);
    const row = w.d.outbox[0];
    expect([row.destination, row.attempts, row.lastStatus]).toEqual(['ga4_mp', 1, 500]);
    expect(row.nextAttemptAt.getTime()).toBe(NOW.getTime() + 60_000);
    const ladder: number[] = [];
    for (let k = 2; k <= 6; k += 1) {
      const at = new Date(row.nextAttemptAt.getTime());
      (w.http.postJson as jest.Mock).mockResolvedValueOnce(k % 2 ? null : 429);
      await w.drain.run(at);
      ladder.push(row.nextAttemptAt.getTime() - at.getTime());
      expect(row.attempts).toBe(k);
    }
    expect(ladder).toEqual([RETRY_LADDER_MS[1], RETRY_LADDER_MS[2], RETRY_LADDER_MS[3], RETRY_LADDER_MS[4], RETRY_LADDER_MS[4]]);
  });

  it('una fila cuyo sujeto ya no existe se borra sin salir a la red', async () => {
    const w = world(fullEnv());
    w.d.orders.clear();
    await w.drain.run(NOW);
    expect(w.http.postJson).not.toHaveBeenCalled();
    expect(w.d.outbox).toHaveLength(0);
  });

  it('una fila ya reclamada por otra instancia (CAS de nextAttemptAt) no se envía dos veces', async () => {
    const w = world(fullEnv());
    const orig = w.d.prisma.measurementOutbox.updateMany.getMockImplementation()!;
    w.d.prisma.measurementOutbox.updateMany.mockImplementationOnce(async () => ({ count: 0 })).mockImplementation(orig);
    const r = await w.drain.run(NOW);
    expect(w.http.postJson).toHaveBeenCalledTimes(1);
    expect(r.skipped).toBe(1);
  });
});

describe('C-B6 · logs: ni token, ni api_secret, ni fbp/fbc/gaClientId, ni cuerpo, ni URL', () => {
  it('un envío que falla con 500 y otro con 400 ⇒ ninguna línea de log contiene un secreto o un fragmento del cuerpo', async () => {
    const lines: string[] = [];
    const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((lvl) =>
      jest.spyOn(Logger.prototype, lvl).mockImplementation((...a: unknown[]) => void lines.push(a.map(String).join(' '))),
    );
    try {
      const w = world(fullEnv(), [500, 400]);
      await w.drain.run(NOW);
      expect(lines.length).toBeGreaterThanOrEqual(2);
      const all = lines.join('\n');
      for (const v of [CAPI_TOKEN, GA4_SECRET, FBP, FBC, GA_CLIENT, PIXEL, 'google-analytics.com', 'graph.facebook.com', 'Pikachu', 'transaction_id', 'access_token', 'p_o1']) {
        expect({ v, found: all.includes(v) }).toEqual({ v, found: false });
      }
      expect(all).toMatch(/destination=ga4_mp kind=purchase status=500 attempts=1 row=/);
      expect(all).toMatch(/destination=meta_capi kind=purchase status=400 attempts=0 row=/);
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });
});

describe('C-B8 · purga a los 7 días y filas enviadas borradas', () => {
  it('filas de cola y de contexto con expiresAt ≤ now ⇒ borradas (también con el modo apagado); las vigentes se quedan', async () => {
    const past = new Date(NOW.getTime() - 1);
    const d = measurementPrismaDouble({
      contexts: [
        { orderId: 'old', expiresAt: past },
        { orderId: 'edge', expiresAt: NOW },
        { orderId: 'new', expiresAt: new Date(NOW.getTime() + 1) },
      ],
      outbox: [
        { kind: 'purchase', destination: 'ga4_mp', subjectId: 'old', eventId: 'p_old', expiresAt: past },
        { kind: 'purchase', destination: 'ga4_mp', subjectId: 'new', eventId: 'p_new', expiresAt: new Date(NOW.getTime() + 1), nextAttemptAt: new Date(NOW.getTime() + 60_000) },
      ] as never,
    });
    const svc = new MeasurementService(d.prisma as never, fakeConfig(fullEnv({ MEASUREMENT_MODE: 'off' })));
    const r = await new MeasurementDrainService(d.prisma as never, svc, { postJson: jest.fn() }).run(NOW);
    expect([r.purgedOutbox, r.purgedContext]).toEqual([1, 2]);
    expect(d.outbox.map((x) => x.subjectId)).toEqual(['new']);
    expect(d.contexts.map((x) => x.orderId)).toEqual(['new']);
  });
});
