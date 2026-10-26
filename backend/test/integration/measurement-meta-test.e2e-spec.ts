/**
 * Evento de prueba de Meta contra Postgres REAL y la app Nest completa (API_CONTRACT §MKT.H.12; ARCHITECTURE §14.10
 * D-MKT2-10). ⛔ Sin red a Meta: `MEASUREMENT_HTTP` es la implementación REAL (`makeFetchMeasurementHttp`) sobre un `fetch`
 * FALSO; y el `fetch` global se vigila (cualquier llamada ⇒ rojo).
 *
 *  Acceso  sin sesión ⇒ 401; `vault_operator` CON `marketing_read` ⇒ 403 (sin llamar ni auditar); `super_admin` ⇒ 200 `no-store`.
 *  Forma   body array ⇒ 400; clave de más / forma / ausente ⇒ 422 `details.field` sin el valor; ninguno cuenta ni audita.
 *  C-B13   el doble devuelve el token en `error.message` y `messages` ⇒ ni en la respuesta, ni en `AuditLog`, ni en el log.
 *  C-B14   `MEASUREMENT_MODE=off` y `on` con el bloqueo de encendido abierto ⇒ envía; sin token ⇒ 409 y 0 llamadas;
 *          6.º en la hora ⇒ 429 + `Retry-After`; 4 previos + 2 en paralelo ⇒ exactamente un 429 (N=10, se exige 10/10).
 */
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Permission } from '@prisma/client';
import { E2EHarness } from './helpers/e2e-app';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { AuditService } from '../../src/modules/audit/audit.service';
import { MEASUREMENT_HTTP, makeFetchMeasurementHttp } from '../../src/modules/measurement/measurement-http';
import { META_GRAPH_API_VERSION } from '../../src/modules/measurement/measurement.config';
import { META_TEST_EVENT_ACTION, MetaTestEventService } from '../../src/modules/measurement/meta-test-event.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CAPI_TOKEN, PIXEL, SECRET_ENV_NAMES } from '../helpers/measurement-fixtures';

const PATH = '/admin/measurement/meta-test-event';
const ENV_META = { META_PIXEL_ID: PIXEL, [SECRET_ENV_NAMES.capiToken]: CAPI_TOKEN };
const RACE_N = 10;

/** El doble de Meta: responde con el token citado; `delayMs` ensancha la ventana de la carrera. */
function metaDouble(opts: { status?: number; delayMs?: number } = {}) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetchImpl = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    const status = opts.status ?? 400;
    const json =
      status < 300
        ? { events_received: 1, messages: [], fbtrace_id: 'AokTrace' }
        : {
            error: {
              message: `Invalid OAuth access token - Cannot parse access token: ${CAPI_TOKEN}`,
              type: 'OAuthException',
              code: 190,
              error_subcode: 463,
              fbtrace_id: 'AerrTrace',
            },
            messages: [`see https://graph.facebook.com/x?access_token=${CAPI_TOKEN}`],
          };
    return new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } });
  });
  return { calls, fetchImpl, http: makeFetchMeasurementHttp(fetchImpl) };
}

async function boot(env: Record<string, string | undefined>, double: ReturnType<typeof metaDouble>): Promise<E2EHarness> {
  return E2EHarness.create((b) =>
    b
      .overrideProvider(MEASUREMENT_HTTP)
      .useValue(double.http)
      .overrideProvider(MetaTestEventService)
      .useFactory({
        factory: (prisma: PrismaService, audit: AuditService, config: ConfigService) =>
          new MetaTestEventService(prisma, audit, double.http, { get: (k: string) => (k in env ? env[k] : config.get<string>(k)) } as ConfigService),
        inject: [PrismaService, AuditService, ConfigService],
      }),
  );
}

const clearAudit = (h: E2EHarness) => h.prisma.auditLog.deleteMany({ where: { action: META_TEST_EVENT_ACTION } });
const countAudit = (h: E2EHarness) => h.prisma.auditLog.count({ where: { action: META_TEST_EVENT_ACTION } });

let globalFetch: jest.SpyInstance;
beforeAll(() => {
  globalFetch = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    throw new Error('red real prohibida en esta suite');
  });
});
afterAll(() => globalFetch.mockRestore());
afterEach(() => expect(globalFetch).not.toHaveBeenCalled());

describe('§MKT.H.12 · acceso, forma, C-B13 y 409/429 (modo off, bloqueo abierto)', () => {
  const double = metaDouble();
  let h: E2EHarness;
  let admin: string;
  let operator: string;
  let operatorId: string;

  beforeAll(async () => {
    h = await boot({ MEASUREMENT_MODE: 'off', ...ENV_META }, double);
    admin = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    operator = await h.login(E2E_USERS.operator.email, E2E_USERS.operator.password);
    operatorId = (await h.prisma.user.findUniqueOrThrow({ where: { email: E2E_USERS.operator.email }, select: { id: true } })).id;
    await h.prisma.userPermission.upsert({
      where: { userId_permission: { userId: operatorId, permission: Permission.marketing_read } },
      create: { userId: operatorId, permission: Permission.marketing_read },
      update: {},
    });
  });
  afterAll(async () => {
    await clearAudit(h);
    await h.prisma.userPermission.deleteMany({ where: { userId: operatorId, permission: Permission.marketing_read } });
    await h.close();
  });
  beforeEach(async () => {
    await clearAudit(h);
    double.calls.length = 0;
  });

  it('sin sesión ⇒ 401; vault_operator con marketing_read ⇒ 403; ninguno llama ni audita', async () => {
    expect((await h.api('POST', PATH, { json: { testEventCode: 'TEST123' } })).status).toBe(401);
    const r = await h.api('POST', PATH, { token: operator, json: { testEventCode: 'TEST123' } });
    expect([r.status, r.body?.error?.code]).toEqual([403, 'FORBIDDEN']);
    expect(double.calls).toHaveLength(0);
    expect(await countAudit(h)).toBe(0);
  });

  it('body array ⇒ 400; forma, ausente o clave de más ⇒ 422 sin el valor; no cuentan ni auditan', async () => {
    expect((await h.api('POST', PATH, { token: admin, json: ['TEST123'] })).status).toBe(400);
    for (const json of [{}, { testEventCode: 'XSS<b>9' }, { testEventCode: 'TEST123', extra: true }, { testEventCode: 12345 }]) {
      const r = await h.api('POST', PATH, { token: admin, json });
      expect([r.status, r.body?.error?.code, r.body?.error?.details]).toEqual([422, 'VALIDATION_ERROR', { field: 'testEventCode' }]);
      expect(r.text).not.toContain('XSS');
    }
    expect(double.calls).toHaveLength(0);
    expect(await countAudit(h)).toBe(0);
  });

  it('C-B13 + C-B14 (off): envía con `off`; 200 no-store con el diagnóstico; el token no está en respuesta, bitácora ni log', async () => {
    const logs: string[] = [];
    const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((lvl) =>
      jest.spyOn(Logger.prototype, lvl).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(' '))),
    );
    const r = await h.api('POST', PATH, { token: admin, json: { testEventCode: ' TEST4321 ' } });
    spies.forEach((s) => s.mockRestore());
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.body).toMatchObject({
      status: 'rejected',
      httpStatus: 400,
      metaVersion: META_GRAPH_API_VERSION,
      pixelId: PIXEL,
      testEventCode: 'TEST4321',
      eventName: 'PageView',
      eventsReceived: null,
      fbtraceId: 'AerrTrace',
      metaError: { code: 190, subcode: 463, type: 'OAuthException' },
    });
    expect(double.calls).toHaveLength(1);
    expect(double.calls[0].url).toBe(`https://graph.facebook.com/${META_GRAPH_API_VERSION}/${PIXEL}/events`);
    expect(double.calls[0].body.access_token).toBe(CAPI_TOKEN);
    expect((double.calls[0].body.data as { event_id: string }[])[0].event_id).toBe(r.body.eventId);
    const rows = await h.prisma.auditLog.findMany({ where: { action: META_TEST_EVENT_ACTION } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entityType: 'MeasurementTestEvent', entityId: r.body.eventId, actorRole: 'super_admin' });
    expect(rows[0].after).toEqual({
      status: 'rejected',
      httpStatus: 400,
      metaVersion: META_GRAPH_API_VERSION,
      testEventCode: 'TEST4321',
      eventsReceived: null,
      fbtraceId: 'AerrTrace',
      metaErrorCode: 190,
    });
    for (const [where, text] of [['respuesta', r.text], ['bitácora', JSON.stringify(rows)], ['log', logs.join('\n')]] as const) {
      expect([where, text.includes(CAPI_TOKEN)]).toEqual([where, false]);
    }
    expect(logs.filter((l) => l.startsWith('MEASUREMENT_META_TEST'))).toEqual([`MEASUREMENT_META_TEST status=rejected http=400 version=${META_GRAPH_API_VERSION}`]);
    expect(logs.join('\n')).not.toContain('graph.facebook.com');
  });

  it('C-B14: 5 envíos ⇒ 200; el 6.º en la hora ⇒ 429 RATE_LIMITED + Retry-After = details.retryAfterSeconds; no llama ni audita', async () => {
    for (let i = 0; i < 5; i += 1) expect((await h.api('POST', PATH, { token: admin, json: { testEventCode: `TEST10${i}` } })).status).toBe(200);
    const r = await h.api('POST', PATH, { token: admin, json: { testEventCode: 'TEST106' } });
    expect([r.status, r.body?.error?.code]).toEqual([429, 'RATE_LIMITED']);
    const s = r.body.error.details.retryAfterSeconds;
    expect(s).toBeGreaterThan(3500);
    expect(s).toBeLessThanOrEqual(3600);
    expect(r.headers['retry-after']).toBe(String(s));
    expect(double.calls).toHaveLength(5);
    expect(await countAudit(h)).toBe(5);
  });

  it('C-B14: filas de hace más de 60 min no cuentan', async () => {
    const old = new Date(Date.now() - 61 * 60_000);
    await h.prisma.auditLog.createMany({ data: Array.from({ length: 5 }, () => ({ action: META_TEST_EVENT_ACTION, createdAt: old })) });
    expect((await h.api('POST', PATH, { token: admin, json: { testEventCode: 'TEST200' } })).status).toBe(200);
  });

  it(`C-B14: 4 previos + 2 en paralelo ⇒ exactamente un 429 (N=${RACE_N}, ${RACE_N}/${RACE_N})`, async () => {
    // Doble con retraso: sin el candado, los dos contarían 4 antes de que ninguno escriba su fila.
    const slow = metaDouble({ status: 200, delayMs: 150 });
    const h2 = await boot({ MEASUREMENT_MODE: 'off', ...ENV_META }, slow);
    const tok = await h2.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    const outcomes: string[] = [];
    try {
      for (let n = 0; n < RACE_N; n += 1) {
        await clearAudit(h2);
        await h2.prisma.auditLog.createMany({ data: Array.from({ length: 4 }, () => ({ action: META_TEST_EVENT_ACTION })) });
        const [a, b] = await Promise.all([
          h2.api('POST', PATH, { token: tok, json: { testEventCode: 'TEST301' } }),
          h2.api('POST', PATH, { token: tok, json: { testEventCode: 'TEST302' } }),
        ]);
        outcomes.push([a.status, b.status].sort().join('+') + `/${await countAudit(h2)}`);
      }
    } finally {
      await clearAudit(h2);
      await h2.close();
    }
    // eslint-disable-next-line no-console
    console.log(`C-B14 carrera: ${outcomes.filter((o) => o === '200+429/5').length}/${RACE_N} ⇒ ${outcomes.join(' ')}`);
    expect(outcomes).toEqual(Array.from({ length: RACE_N }, () => '200+429/5'));
  });
});

describe('§MKT.H.12 · C-B14 con `on` + bloqueo abierto, y sin token', () => {
  it('`MEASUREMENT_MODE=on` con MKT-F2-3 abierto (modo efectivo off) ⇒ envía y responde accepted', async () => {
    const double = metaDouble({ status: 200 });
    const h = await boot({ MEASUREMENT_MODE: 'on', ...ENV_META }, double);
    try {
      await clearAudit(h);
      const admin = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
      const r = await h.api('POST', PATH, { token: admin, json: { testEventCode: 'TEST555' } });
      expect([r.status, r.body.status, r.body.eventsReceived, r.body.fbtraceId]).toEqual([200, 'accepted', 1, 'AokTrace']);
      expect(double.calls).toHaveLength(1);
    } finally {
      await clearAudit(h);
      await h.close();
    }
  });

  it('sin META_CAPI_TOKEN ⇒ 409 MEASUREMENT_META_NOT_CONFIGURED {reason}, 0 llamadas, 0 filas', async () => {
    const double = metaDouble({ status: 200 });
    const h = await boot({ MEASUREMENT_MODE: 'off', META_PIXEL_ID: PIXEL, [SECRET_ENV_NAMES.capiToken]: undefined }, double);
    try {
      await clearAudit(h);
      const admin = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
      const r = await h.api('POST', PATH, { token: admin, json: { testEventCode: 'TEST556' } });
      expect([r.status, r.body?.error?.code, r.body?.error?.details]).toEqual([409, 'MEASUREMENT_META_NOT_CONFIGURED', { reason: 'missing_config' }]);
      expect(double.calls).toHaveLength(0);
      expect(await countAudit(h)).toBe(0);
    } finally {
      await h.close();
    }
  });
});
